FROM python:3.11-slim

# ARG para habilitar Docling (pesado, com OCR e ML)
# Para ativar: docker compose build --build-arg ENABLE_DOCLING=true docling
ARG ENABLE_DOCLING=false

# Dependências base do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Dependências extras para Docling (só se ativado)
RUN if [ "$ENABLE_DOCLING" = "true" ]; then \
    apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-por \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app

# Instalar dependências base (leve e rápido)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Instalar Docling se ativado (pesado ~5min)
COPY requirements.docling.txt .
RUN if [ "$ENABLE_DOCLING" = "true" ]; then \
    pip install --no-cache-dir -r requirements.docling.txt; \
    fi

COPY . .

# Variável de ambiente para o service saber se Docling está disponível
ENV DOCLING_ENABLED=$ENABLE_DOCLING

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
