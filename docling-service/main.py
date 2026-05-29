"""
Docling Document Processing Microservice
Serviço modular de parsing de documentos para RAG.

Endpoints:
  POST /parse           — Parse de documento (PDF, DOCX, PPTX, XLSX, HTML, MD, TXT, CSV)
  POST /parse/simple    — Parse simplificado (texto puro, sem estrutura)
  GET  /health          — Health check
  GET  /formats         — Lista formatos suportados

Cada parser retorna uma lista de DocumentElements tipados:
  - title, heading, paragraph, list_item, table, code, page_break, image_description
"""

import os
import io
import hashlib
import logging
import time
import traceback
from enum import Enum
from typing import Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("docling-service")

# Verificar se Docling está disponível
DOCLING_AVAILABLE = False
try:
    from docling.document_converter import DocumentConverter
    DOCLING_AVAILABLE = True
    logger.info("✅ Docling disponível — PDFs serão processados com OCR e layout analysis")
except ImportError:
    logger.info("ℹ️  Docling não instalado — PDFs serão processados com parser básico (pypdf)")
    logger.info("   Para ativar: docker compose build --build-arg ENABLE_DOCLING=true docling")

app = FastAPI(
    title="Docling Document Service",
    description="Microserviço modular de parsing de documentos para RAG",
    version="1.0.0",
)


# ============================================
# Types
# ============================================

class ElementType(str, Enum):
    TITLE = "title"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE = "table"
    CODE = "code"
    PAGE_BREAK = "page_break"
    IMAGE_DESCRIPTION = "image_description"
    HEADER = "header"
    FOOTER = "footer"


class DocumentElement(BaseModel):
    type: ElementType
    text: str
    level: Optional[int] = None        # Para headings (1-6)
    page: Optional[int] = None         # Número da página (PDFs)
    section: Optional[str] = None      # Heading pai mais próximo
    metadata: Optional[dict] = None


class ParseResult(BaseModel):
    success: bool
    filename: str
    format: str
    elements: list[DocumentElement]
    page_count: Optional[int] = None
    word_count: int
    char_count: int
    title: Optional[str] = None
    language: Optional[str] = None
    parsing_method: str               # 'docling' | 'mammoth' | 'basic' | 'openpyxl'
    parse_time_ms: int
    error: Optional[str] = None


# ============================================
# Format Registry (modular)
# ============================================

SUPPORTED_FORMATS = {
    # PDF
    "pdf": {"parser": "docling", "mime": ["application/pdf"]},
    # Word
    "docx": {"parser": "mammoth", "mime": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]},
    "doc": {"parser": "mammoth", "mime": ["application/msword"]},
    # Spreadsheets
    "xlsx": {"parser": "openpyxl", "mime": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]},
    "xls": {"parser": "openpyxl", "mime": ["application/vnd.ms-excel"]},
    "csv": {"parser": "basic_csv", "mime": ["text/csv"]},
    # Presentations
    "pptx": {"parser": "pptx", "mime": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"]},
    # Text
    "txt": {"parser": "basic_text", "mime": ["text/plain"]},
    "md": {"parser": "markdown", "mime": ["text/markdown"]},
    "html": {"parser": "html", "mime": ["text/html"]},
    "htm": {"parser": "html", "mime": ["text/html"]},
    # JSON
    "json": {"parser": "basic_json", "mime": ["application/json"]},
}


def detect_format(filename: str, content_type: str = "") -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in SUPPORTED_FORMATS:
        return ext
    # Fallback por MIME type
    for fmt, info in SUPPORTED_FORMATS.items():
        if content_type in info["mime"]:
            return fmt
    return "txt"  # Default para texto


# ============================================
# Parsers Modulares
# ============================================

def parse_pdf(content: bytes, filename: str) -> ParseResult:
    """Parse PDF — usa Docling se disponível, senão pypdf"""
    if not DOCLING_AVAILABLE:
        return parse_pdf_basic(content, filename)
    
    start = time.time()
    elements: list[DocumentElement] = []
    page_count = None
    title = None
    
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat
        import tempfile
        
        # Salvar em arquivo temporário (Docling precisa de path)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        
        try:
            # Configurar pipeline com OCR
            pipeline_options = PdfPipelineOptions()
            pipeline_options.do_ocr = True
            pipeline_options.do_table_structure = True
            
            converter = DocumentConverter(
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
                }
            )
            
            result = converter.convert(tmp_path)
            doc = result.document
            
            # Extrair título
            title = doc.name or filename
            
            # Converter DoclingDocument para nossos elements
            current_section = None
            current_page = 1
            
            for item in doc.iterate_items():
                element_obj, _level = item if isinstance(item, tuple) else (item, 0)
                
                text = ""
                element_type = ElementType.PARAGRAPH
                level = None
                page = current_page
                
                # Extrair texto do item
                if hasattr(element_obj, 'text'):
                    text = str(element_obj.text).strip()
                elif hasattr(element_obj, 'export_to_markdown'):
                    text = element_obj.export_to_markdown().strip()
                
                if not text:
                    continue
                
                # Determinar tipo baseado no label do Docling
                label = ""
                if hasattr(element_obj, 'label'):
                    label = str(element_obj.label).lower()
                
                if 'title' in label or 'heading' in label:
                    element_type = ElementType.HEADING
                    level = _level if _level > 0 else 1
                    current_section = text
                elif 'table' in label:
                    element_type = ElementType.TABLE
                    # Exportar tabela como markdown
                    if hasattr(element_obj, 'export_to_markdown'):
                        text = element_obj.export_to_markdown()
                elif 'list' in label:
                    element_type = ElementType.LIST_ITEM
                elif 'code' in label:
                    element_type = ElementType.CODE
                elif 'caption' in label or 'figure' in label:
                    element_type = ElementType.IMAGE_DESCRIPTION
                elif 'header' in label:
                    element_type = ElementType.HEADER
                    continue  # Skip headers/footers de página
                elif 'footer' in label:
                    element_type = ElementType.FOOTER
                    continue  # Skip headers/footers de página
                elif 'page' in label:
                    current_page += 1
                    continue
                
                # Extrair página do item se disponível
                if hasattr(element_obj, 'prov') and element_obj.prov:
                    for prov in element_obj.prov:
                        if hasattr(prov, 'page_no'):
                            page = prov.page_no
                            current_page = page
                            break
                
                elements.append(DocumentElement(
                    type=element_type,
                    text=text,
                    level=level,
                    page=page,
                    section=current_section,
                ))
            
            # Contar páginas
            if hasattr(doc, 'pages'):
                page_count = len(doc.pages) if doc.pages else None
            if not page_count:
                page_count = current_page
                
        finally:
            os.unlink(tmp_path)
            
    except ImportError:
        logger.warning("Docling not available, falling back to basic PDF parsing")
        return parse_pdf_basic(content, filename)
    except Exception as e:
        logger.error(f"Docling PDF parse failed: {e}\n{traceback.format_exc()}")
        # Fallback para parser básico
        return parse_pdf_basic(content, filename)
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True,
        filename=filename,
        format="pdf",
        elements=elements,
        page_count=page_count,
        word_count=len(full_text.split()),
        char_count=len(full_text),
        title=title,
        parsing_method="docling",
        parse_time_ms=ms,
    )


def parse_pdf_basic(content: bytes, filename: str) -> ParseResult:
    """Fallback: Parse PDF básico sem Docling (usando pypdf)"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        page_count = len(reader.pages)
        
        current_section = None
        for page_num, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            if not text.strip():
                continue
            
            # Heurística para detectar headings em PDF
            lines = text.split("\n")
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                element_type = ElementType.PARAGRAPH
                level = None
                
                # Heurísticas para heading:
                # 1. Linha curta + ALL CAPS
                # 2. Linha curta que começa com número (1., 1.1, Capítulo)
                # 3. Linha <= 80 chars seguida de conteúdo
                is_heading = False
                if len(line) <= 100:
                    if line.isupper() and len(line) > 3:
                        is_heading = True
                        level = 1
                    elif line[0].isdigit() and ('.' in line[:5] or line.lower().startswith('cap')):
                        is_heading = True
                        level = 2
                    elif len(line) <= 60 and not line.endswith(('.', ',', ';', ':', '!', '?')):
                        # Linhas curtas sem pontuação final são provavelmente headings
                        if line[0].isupper():
                            is_heading = True
                            level = 2
                
                if is_heading:
                    element_type = ElementType.HEADING
                    current_section = line
                
                elements.append(DocumentElement(
                    type=element_type,
                    text=line,
                    level=level,
                    page=page_num,
                    section=current_section,
                ))
    except Exception as e:
        logger.error(f"Basic PDF parse failed: {e}")
        return ParseResult(
            success=False, filename=filename, format="pdf", elements=[],
            word_count=0, char_count=0, parsing_method="basic_pdf",
            parse_time_ms=int((time.time() - start) * 1000), error=str(e),
        )
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True, filename=filename, format="pdf", elements=elements,
        page_count=page_count, word_count=len(full_text.split()),
        char_count=len(full_text), parsing_method="basic_pdf",
        parse_time_ms=ms,
    )


def parse_docx(content: bytes, filename: str) -> ParseResult:
    """Parse DOCX usando mammoth (converte para HTML, depois extrai elementos)"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    try:
        import mammoth
        from bs4 import BeautifulSoup
        
        result = mammoth.convert_to_html(io.BytesIO(content))
        html = result.value
        
        soup = BeautifulSoup(html, "html.parser")
        current_section = None
        title = None
        
        for tag in soup.find_all(True):
            text = tag.get_text(strip=True)
            if not text:
                continue
            
            # Ignorar tags dentro de outras tags processadas
            if tag.parent and tag.parent.name in ['li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre']:
                continue
            
            element_type = ElementType.PARAGRAPH
            level = None
            
            if tag.name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                element_type = ElementType.HEADING
                level = int(tag.name[1])
                current_section = text
                if level == 1 and not title:
                    title = text
            elif tag.name == 'li':
                element_type = ElementType.LIST_ITEM
            elif tag.name == 'table':
                element_type = ElementType.TABLE
                # Converter tabela para markdown
                rows = []
                for tr in tag.find_all('tr'):
                    cells = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
                    rows.append(" | ".join(cells))
                if rows:
                    # Adicionar separador após header
                    header = rows[0]
                    separator = " | ".join(["---"] * len(rows[0].split(" | ")))
                    text = header + "\n" + separator + "\n" + "\n".join(rows[1:])
            elif tag.name == 'pre' or tag.name == 'code':
                element_type = ElementType.CODE
            elif tag.name == 'p':
                element_type = ElementType.PARAGRAPH
            else:
                continue  # Skip divs, spans, etc. que não são conteúdo direto
            
            elements.append(DocumentElement(
                type=element_type,
                text=text,
                level=level,
                section=current_section,
            ))
    except Exception as e:
        logger.error(f"DOCX parse failed: {e}")
        return ParseResult(
            success=False, filename=filename, format="docx", elements=[],
            word_count=0, char_count=0, parsing_method="mammoth",
            parse_time_ms=int((time.time() - start) * 1000), error=str(e),
        )
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True, filename=filename, format="docx", elements=elements,
        word_count=len(full_text.split()), char_count=len(full_text),
        title=title, parsing_method="mammoth", parse_time_ms=ms,
    )


def parse_xlsx(content: bytes, filename: str) -> ParseResult:
    """Parse XLSX usando openpyxl — cada sheet vira uma seção"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    try:
        from openpyxl import load_workbook
        
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            # Sheet name = heading
            elements.append(DocumentElement(
                type=ElementType.HEADING,
                text=sheet_name,
                level=1,
                section=sheet_name,
            ))
            
            # Converter sheet para tabela markdown
            rows = []
            for row in ws.iter_rows(values_only=True):
                cells = [str(cell) if cell is not None else "" for cell in row]
                if any(cells):  # Skip linhas vazias
                    rows.append(" | ".join(cells))
            
            if rows:
                # Primeira linha como header
                header = rows[0]
                separator = " | ".join(["---"] * len(rows[0].split(" | ")))
                table_text = header + "\n" + separator
                if len(rows) > 1:
                    table_text += "\n" + "\n".join(rows[1:])
                
                elements.append(DocumentElement(
                    type=ElementType.TABLE,
                    text=table_text,
                    section=sheet_name,
                ))
        
        wb.close()
    except Exception as e:
        logger.error(f"XLSX parse failed: {e}")
        return ParseResult(
            success=False, filename=filename, format="xlsx", elements=[],
            word_count=0, char_count=0, parsing_method="openpyxl",
            parse_time_ms=int((time.time() - start) * 1000), error=str(e),
        )
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True, filename=filename, format="xlsx", elements=elements,
        word_count=len(full_text.split()), char_count=len(full_text),
        parsing_method="openpyxl", parse_time_ms=ms,
    )


def parse_pptx(content: bytes, filename: str) -> ParseResult:
    """Parse PPTX usando python-pptx — cada slide vira seção"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    try:
        from pptx import Presentation
        
        prs = Presentation(io.BytesIO(content))
        title = None
        
        for slide_num, slide in enumerate(prs.slides, 1):
            slide_title = None
            
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        text = para.text.strip()
                        if not text:
                            continue
                        
                        # Primeiro texto do slide pode ser título
                        if shape.shape_type and str(shape.shape_type) == "TITLE (15)":
                            element_type = ElementType.HEADING
                            level = 1 if slide_num == 1 else 2
                            slide_title = text
                            if slide_num == 1 and not title:
                                title = text
                        elif not slide_title:
                            element_type = ElementType.HEADING
                            level = 2
                            slide_title = text
                        else:
                            element_type = ElementType.PARAGRAPH
                            level = None
                        
                        elements.append(DocumentElement(
                            type=element_type,
                            text=text,
                            level=level,
                            page=slide_num,
                            section=slide_title or f"Slide {slide_num}",
                        ))
                
                if shape.has_table:
                    table = shape.table
                    rows = []
                    for row in table.rows:
                        cells = [cell.text.strip() for cell in row.cells]
                        rows.append(" | ".join(cells))
                    if rows:
                        header = rows[0]
                        separator = " | ".join(["---"] * len(rows[0].split(" | ")))
                        table_text = header + "\n" + separator
                        if len(rows) > 1:
                            table_text += "\n" + "\n".join(rows[1:])
                        elements.append(DocumentElement(
                            type=ElementType.TABLE,
                            text=table_text,
                            page=slide_num,
                            section=slide_title or f"Slide {slide_num}",
                        ))
    except Exception as e:
        logger.error(f"PPTX parse failed: {e}")
        return ParseResult(
            success=False, filename=filename, format="pptx", elements=[],
            word_count=0, char_count=0, parsing_method="pptx",
            parse_time_ms=int((time.time() - start) * 1000), error=str(e),
        )
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True, filename=filename, format="pptx", elements=elements,
        word_count=len(full_text.split()), char_count=len(full_text),
        title=title, parsing_method="pptx", parse_time_ms=ms,
    )


def parse_html(content: bytes, filename: str) -> ParseResult:
    """Parse HTML com BeautifulSoup — extrai elementos tipados"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    try:
        from bs4 import BeautifulSoup
        
        text_content = content.decode("utf-8", errors="replace")
        soup = BeautifulSoup(text_content, "html.parser")
        
        # Remover scripts, styles, nav, footer, aside
        for tag in soup.find_all(['script', 'style', 'nav', 'footer', 'aside', 'header', 'noscript']):
            tag.decompose()
        
        title = None
        title_tag = soup.find('title')
        if title_tag:
            title = title_tag.get_text(strip=True)
        
        current_section = None
        body = soup.find('body') or soup
        
        for tag in body.find_all(True):
            text = tag.get_text(strip=True)
            if not text or len(text) < 3:
                continue
            
            if tag.parent and tag.parent.name in ['li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'blockquote']:
                continue
            
            element_type = ElementType.PARAGRAPH
            level = None
            
            if tag.name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                element_type = ElementType.HEADING
                level = int(tag.name[1])
                current_section = text
                if level == 1 and not title:
                    title = text
            elif tag.name == 'li':
                element_type = ElementType.LIST_ITEM
            elif tag.name == 'table':
                element_type = ElementType.TABLE
                rows = []
                for tr in tag.find_all('tr'):
                    cells = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
                    rows.append(" | ".join(cells))
                if rows:
                    header = rows[0]
                    separator = " | ".join(["---"] * len(rows[0].split(" | ")))
                    text = header + "\n" + separator
                    if len(rows) > 1:
                        text += "\n" + "\n".join(rows[1:])
            elif tag.name in ['pre', 'code']:
                element_type = ElementType.CODE
            elif tag.name == 'p':
                element_type = ElementType.PARAGRAPH
            elif tag.name == 'blockquote':
                element_type = ElementType.PARAGRAPH
            else:
                continue
            
            elements.append(DocumentElement(
                type=element_type,
                text=text,
                level=level,
                section=current_section,
            ))
    except Exception as e:
        logger.error(f"HTML parse failed: {e}")
        return ParseResult(
            success=False, filename=filename, format="html", elements=[],
            word_count=0, char_count=0, parsing_method="html",
            parse_time_ms=int((time.time() - start) * 1000), error=str(e),
        )
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True, filename=filename, format="html", elements=elements,
        word_count=len(full_text.split()), char_count=len(full_text),
        title=title, parsing_method="html", parse_time_ms=ms,
    )


def parse_markdown(content: bytes, filename: str) -> ParseResult:
    """Parse Markdown — detecta headings, listas, code blocks, tabelas"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    text_content = content.decode("utf-8", errors="replace")
    current_section = None
    title = None
    in_code_block = False
    code_block_lines: list[str] = []
    in_table = False
    table_lines: list[str] = []
    
    for line in text_content.split("\n"):
        stripped = line.strip()
        
        # Code blocks
        if stripped.startswith("```"):
            if in_code_block:
                code_text = "\n".join(code_block_lines)
                if code_text.strip():
                    elements.append(DocumentElement(
                        type=ElementType.CODE, text=code_text, section=current_section,
                    ))
                code_block_lines = []
                in_code_block = False
            else:
                in_code_block = True
            continue
        
        if in_code_block:
            code_block_lines.append(line)
            continue
        
        # Tables
        if "|" in stripped and stripped.startswith("|"):
            if not in_table:
                in_table = True
                table_lines = []
            table_lines.append(stripped)
            continue
        elif in_table:
            table_text = "\n".join(table_lines)
            elements.append(DocumentElement(
                type=ElementType.TABLE, text=table_text, section=current_section,
            ))
            table_lines = []
            in_table = False
        
        # Headings
        if stripped.startswith("#"):
            level = len(stripped.split(" ")[0])  # Count #s
            if 1 <= level <= 6:
                heading_text = stripped.lstrip("#").strip()
                if heading_text:
                    elements.append(DocumentElement(
                        type=ElementType.HEADING, text=heading_text,
                        level=level, section=current_section,
                    ))
                    current_section = heading_text
                    if level == 1 and not title:
                        title = heading_text
                continue
        
        # List items
        if stripped.startswith(("- ", "* ", "+ ")) or (len(stripped) > 2 and stripped[0].isdigit() and stripped[1] in '.):'):
            elements.append(DocumentElement(
                type=ElementType.LIST_ITEM, text=stripped.lstrip("-*+ 0123456789.)"),
                section=current_section,
            ))
            continue
        
        # Normal paragraph
        if stripped:
            elements.append(DocumentElement(
                type=ElementType.PARAGRAPH, text=stripped, section=current_section,
            ))
    
    # Flush remaining table
    if in_table and table_lines:
        elements.append(DocumentElement(
            type=ElementType.TABLE, text="\n".join(table_lines), section=current_section,
        ))
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True, filename=filename, format="md", elements=elements,
        word_count=len(full_text.split()), char_count=len(full_text),
        title=title, parsing_method="markdown", parse_time_ms=ms,
    )


def parse_csv(content: bytes, filename: str) -> ParseResult:
    """Parse CSV — header + rows como tabela"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    text_content = content.decode("utf-8", errors="replace")
    lines = [l.strip() for l in text_content.split("\n") if l.strip()]
    
    if lines:
        elements.append(DocumentElement(
            type=ElementType.HEADING, text=filename.rsplit(".", 1)[0],
            level=1, section=filename,
        ))
        
        # Converter para tabela markdown
        header = lines[0]
        separator = " | ".join(["---"] * len(header.split(",")))
        table_text = " | ".join(header.split(",")) + "\n" + separator
        for line in lines[1:]:
            table_text += "\n" + " | ".join(line.split(","))
        
        elements.append(DocumentElement(
            type=ElementType.TABLE, text=table_text, section=filename,
        ))
    
    ms = int((time.time() - start) * 1000)
    full_text = "\n".join(e.text for e in elements)
    
    return ParseResult(
        success=True, filename=filename, format="csv", elements=elements,
        word_count=len(full_text.split()), char_count=len(full_text),
        parsing_method="basic_csv", parse_time_ms=ms,
    )


def parse_text(content: bytes, filename: str) -> ParseResult:
    """Parse texto puro — cada parágrafo vira um elemento"""
    start = time.time()
    elements: list[DocumentElement] = []
    
    text_content = content.decode("utf-8", errors="replace")
    paragraphs = text_content.split("\n\n")
    
    for para in paragraphs:
        text = para.strip()
        if text:
            elements.append(DocumentElement(
                type=ElementType.PARAGRAPH, text=text,
            ))
    
    ms = int((time.time() - start) * 1000)
    
    return ParseResult(
        success=True, filename=filename, format="txt", elements=elements,
        word_count=len(text_content.split()), char_count=len(text_content),
        parsing_method="basic_text", parse_time_ms=ms,
    )


def parse_json(content: bytes, filename: str) -> ParseResult:
    """Parse JSON — flatten para texto"""
    import json as json_lib
    start = time.time()
    
    text_content = content.decode("utf-8", errors="replace")
    try:
        data = json_lib.loads(text_content)
        formatted = json_lib.dumps(data, indent=2, ensure_ascii=False)
    except:
        formatted = text_content
    
    elements = [DocumentElement(type=ElementType.CODE, text=formatted)]
    ms = int((time.time() - start) * 1000)
    
    return ParseResult(
        success=True, filename=filename, format="json", elements=elements,
        word_count=len(formatted.split()), char_count=len(formatted),
        parsing_method="basic_json", parse_time_ms=ms,
    )


# Parser dispatcher
PARSER_MAP = {
    "docling": parse_pdf,
    "basic_pdf": parse_pdf_basic,
    "mammoth": parse_docx,
    "openpyxl": parse_xlsx,
    "pptx": parse_pptx,
    "html": parse_html,
    "markdown": parse_markdown,
    "basic_csv": parse_csv,
    "basic_text": parse_text,
    "basic_json": parse_json,
}


# ============================================
# Endpoints
# ============================================

@app.post("/parse", response_model=ParseResult)
async def parse_document(
    file: UploadFile = File(...),
    force_parser: Optional[str] = Form(None),
):
    """Parse documento e retorna elementos tipados com estrutura"""
    content = await file.read()
    filename = file.filename or "unknown"
    
    fmt = detect_format(filename, file.content_type or "")
    parser_name = force_parser or SUPPORTED_FORMATS.get(fmt, {}).get("parser", "basic_text")
    parser_fn = PARSER_MAP.get(parser_name, parse_text)
    
    logger.info(f"Parsing {filename} ({fmt}) with {parser_name} ({len(content)} bytes)")
    
    result = parser_fn(content, filename)
    return result


@app.post("/parse/simple")
async def parse_simple(
    file: UploadFile = File(...),
):
    """Parse simplificado — retorna texto puro sem elementos tipados"""
    content = await file.read()
    filename = file.filename or "unknown"
    
    fmt = detect_format(filename, file.content_type or "")
    parser_name = SUPPORTED_FORMATS.get(fmt, {}).get("parser", "basic_text")
    parser_fn = PARSER_MAP.get(parser_name, parse_text)
    
    result = parser_fn(content, filename)
    
    # Combinar elementos em texto puro
    full_text = ""
    for elem in result.elements:
        if elem.type == ElementType.HEADING:
            prefix = "#" * (elem.level or 1) + " "
            full_text += f"\n\n{prefix}{elem.text}\n\n"
        elif elem.type == ElementType.TABLE:
            full_text += f"\n\n{elem.text}\n\n"
        elif elem.type == ElementType.CODE:
            full_text += f"\n\n```\n{elem.text}\n```\n\n"
        elif elem.type == ElementType.LIST_ITEM:
            full_text += f"- {elem.text}\n"
        else:
            full_text += f"{elem.text}\n\n"
    
    return {
        "text": full_text.strip(),
        "title": result.title,
        "page_count": result.page_count,
        "word_count": result.word_count,
        "parsing_method": result.parsing_method,
        "parse_time_ms": result.parse_time_ms,
    }


@app.get("/health")
async def health():
    """Health check"""
    return {
        "status": "ok",
        "docling_available": DOCLING_AVAILABLE,
        "pdf_parser": "docling" if DOCLING_AVAILABLE else "pypdf",
        "parsers": list(PARSER_MAP.keys()),
    }


@app.get("/formats")
async def formats():
    """Lista formatos suportados"""
    return {
        "formats": {
            fmt: {
                "parser": info["parser"],
                "mime_types": info["mime"],
            }
            for fmt, info in SUPPORTED_FORMATS.items()
        }
    }
