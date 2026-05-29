import { useState, useCallback, useMemo } from 'react'
import {
  X, List, MousePointerClick, BarChart3, QrCode, Plus, Trash2,
  Send, AlertCircle, Link2, Phone, Copy, LayoutGrid, ChevronRight,
  Smartphone, Image as ImageIcon,
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */

type InteractiveType = 'buttons' | 'list' | 'poll' | 'pix' | 'carousel'
type ButtonType = 'reply' | 'url' | 'copy' | 'call'

interface ButtonItem {
  id: string; text: string; buttonType: ButtonType
  url?: string; copyCode?: string; phoneNumber?: string
}

interface ListRow { id: string; title: string; description: string }
interface ListSection { title: string; rows: ListRow[] }

interface CarouselCardButton {
  type: 'REPLY' | 'URL' | 'CALL' | 'COPY'; displayText: string
  id?: string; url?: string; phoneNumber?: string; copyCode?: string
}

interface CarouselCard {
  header: { title: string; imageUrl?: string }
  body: { text: string }; footer: string; buttons: CarouselCardButton[]
}

interface InteractivePayload {
  type: InteractiveType; text?: string; buttons?: ButtonItem[]
  footer?: string; header?: string; imageUrl?: string; videoUrl?: string
  buttonText?: string
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description: string }> }>
  question?: string; options?: string[]; selectableCount?: number
  pixKey?: string; pixKeyType?: string; merchantName?: string
  headerTitle?: string; bodyText?: string; footerText?: string
  body?: string; cards?: CarouselCard[]
}

interface InteractiveComposerProps {
  onSend: (payload: InteractivePayload) => Promise<void>
  onClose: () => void
  sending?: boolean
  channelType?: string
}

const TABS: Array<{ type: InteractiveType; label: string; icon: any }> = [
  { type: 'buttons', label: 'Botões', icon: MousePointerClick },
  { type: 'list', label: 'Lista', icon: List },
  { type: 'poll', label: 'Enquete', icon: BarChart3 },
  { type: 'pix', label: 'PIX', icon: QrCode },
  { type: 'carousel', label: 'Carrossel', icon: LayoutGrid },
]

const BTN_TYPE_LABELS: Record<ButtonType, { label: string; icon: any }> = {
  reply: { label: 'Resposta', icon: MousePointerClick },
  url: { label: 'Link', icon: Link2 },
  copy: { label: 'Copiar', icon: Copy },
  call: { label: 'Ligar', icon: Phone },
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function InteractiveComposer({ onSend, onClose, sending }: InteractiveComposerProps) {
  const [activeTab, setActiveTab] = useState<InteractiveType>('buttons')
  const [errors, setErrors] = useState<string[]>([])
  const [showValidation, setShowValidation] = useState(false)

  // ── Buttons state ──
  const [btnText, setBtnText] = useState('')
  const [btnHeader, setBtnHeader] = useState('')
  const [btnFooter, setBtnFooter] = useState('')
  const [btnImageUrl, setBtnImageUrl] = useState('')
  const [buttons, setButtons] = useState<ButtonItem[]>([
    { id: 'btn_1', text: '', buttonType: 'reply' },
  ])

  // ── List state ──
  const [listText, setListText] = useState('')
  const [listHeader, setListHeader] = useState('')
  const [listFooter, setListFooter] = useState('')
  const [listButtonText, setListButtonText] = useState('Menu')
  const [sections, setSections] = useState<ListSection[]>([
    { title: 'Opções', rows: [{ id: 'row_1', title: '', description: '' }] },
  ])

  // ── Poll state ──
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const [pollSelectableCount, setPollSelectableCount] = useState(1)

  // ── PIX state ──
  const [pixKey, setPixKey] = useState('')
  const [pixKeyType, setPixKeyType] = useState('cpf')
  const [pixMerchantName, setPixMerchantName] = useState('')
  const [pixHeaderTitle, setPixHeaderTitle] = useState('')
  const [pixBodyText, setPixBodyText] = useState('')
  const [pixFooterText, setPixFooterText] = useState('')

  // ── Carousel state ──
  const [carouselBody, setCarouselBody] = useState('')
  const [carouselFooter, setCarouselFooter] = useState('')
  const [cards, setCards] = useState<CarouselCard[]>([
    { header: { title: '', imageUrl: '' }, body: { text: '' }, footer: '', buttons: [{ type: 'REPLY', displayText: '', id: 'cb_1' }] },
  ])

  /* ─── Validation ─── */
  const validate = useCallback((): string[] => {
    const e: string[] = []
    if (activeTab === 'buttons') {
      if (!btnText.trim()) e.push('Texto da mensagem obrigatório')
      const valid = buttons.filter(b => b.text.trim())
      if (!valid.length) e.push('Pelo menos 1 botão com texto')
      const types = new Set(valid.map(b => b.buttonType))
      if (types.has('reply') && types.size > 1) e.push('Reply não pode misturar com url/copy/call')
      valid.forEach((b, i) => {
        if (b.text.length > 20) e.push(`Botão ${i + 1}: máx 20 chars`)
        if (b.buttonType === 'url' && !b.url?.trim()) e.push(`Botão ${i + 1}: URL obrigatória`)
        if (b.buttonType === 'copy' && !b.copyCode?.trim()) e.push(`Botão ${i + 1}: texto para copiar obrigatório`)
        if (b.buttonType === 'call' && !b.phoneNumber?.trim()) e.push(`Botão ${i + 1}: telefone obrigatório`)
      })
    }
    if (activeTab === 'list') {
      if (!listText.trim()) e.push('Texto obrigatório')
      if (!listButtonText.trim()) e.push('Texto do botão obrigatório')
      sections.forEach((s, si) => {
        if (!s.title.trim()) e.push(`Seção ${si + 1}: título obrigatório`)
        if (!s.rows.filter(r => r.title.trim()).length) e.push(`Seção ${si + 1}: pelo menos 1 item`)
      })
    }
    if (activeTab === 'poll') {
      if (!pollQuestion.trim()) e.push('Pergunta obrigatória')
      if (pollOptions.filter(o => o.trim()).length < 2) e.push('Mínimo 2 opções')
    }
    if (activeTab === 'pix') {
      if (!pixKey.trim()) e.push('Chave PIX obrigatória')
      if (!pixMerchantName.trim()) e.push('Nome do beneficiário obrigatório')
    }
    if (activeTab === 'carousel') {
      if (!carouselBody.trim()) e.push('Texto principal obrigatório')
      if (!cards.length) e.push('Mínimo 1 card')
      cards.forEach((c, i) => {
        if (!c.body.text.trim()) e.push(`Card ${i + 1}: texto obrigatório`)
        if (!c.buttons.filter(b => b.displayText.trim()).length) e.push(`Card ${i + 1}: pelo menos 1 botão`)
      })
    }
    return e
  }, [activeTab, btnText, buttons, listText, listButtonText, sections, pollQuestion, pollOptions, pixKey, pixMerchantName, carouselBody, cards])

  /* ─── Build payload ─── */
  const buildPayload = useCallback((): InteractivePayload | null => {
    const errs = validate()
    setShowValidation(true)
    if (errs.length) { setErrors(errs); return null }
    setErrors([])
    switch (activeTab) {
      case 'buttons':
        return {
          type: 'buttons', text: btnText.trim(),
          buttons: buttons.filter(b => b.text.trim()).map((b, i) => ({
            id: b.id || `btn_${i + 1}`, text: b.text.trim(), buttonType: b.buttonType,
            ...(b.buttonType === 'url' ? { url: b.url?.trim() } : {}),
            ...(b.buttonType === 'copy' ? { copyCode: b.copyCode?.trim() } : {}),
            ...(b.buttonType === 'call' ? { phoneNumber: b.phoneNumber?.trim() } : {}),
          })),
          ...(btnHeader.trim() ? { header: btnHeader.trim() } : {}),
          ...(btnFooter.trim() ? { footer: btnFooter.trim() } : {}),
          ...(btnImageUrl.trim() ? { imageUrl: btnImageUrl.trim() } : {}),
        }
      case 'list':
        return {
          type: 'list', text: listText.trim(), buttonText: listButtonText.trim() || 'Menu',
          sections: sections.map(s => ({
            title: s.title.trim(),
            rows: s.rows.filter(r => r.title.trim()).map((r, i) => ({
              id: r.id || `row_${i + 1}`, title: r.title.trim(), description: r.description?.trim() || '',
            })),
          })).filter(s => s.rows.length > 0),
          ...(listHeader.trim() ? { header: listHeader.trim() } : {}),
          ...(listFooter.trim() ? { footer: listFooter.trim() } : {}),
        }
      case 'poll':
        return {
          type: 'poll', question: pollQuestion.trim(),
          options: pollOptions.filter(o => o.trim()), selectableCount: pollSelectableCount,
        }
      case 'pix':
        return {
          type: 'pix', pixKey: pixKey.trim(), pixKeyType, merchantName: pixMerchantName.trim(),
          ...(pixHeaderTitle.trim() ? { headerTitle: pixHeaderTitle.trim() } : {}),
          ...(pixBodyText.trim() ? { bodyText: pixBodyText.trim() } : {}),
          ...(pixFooterText.trim() ? { footerText: pixFooterText.trim() } : {}),
        }
      case 'carousel': {
        return {
          type: 'carousel', body: carouselBody.trim(),
          ...(carouselFooter.trim() ? { footer: carouselFooter.trim() } : {}),
          cards: cards.map(c => {
            const hdr: { title: string; imageUrl?: string } = { title: c.header.title.trim() }
            if (c.header.imageUrl?.trim()) hdr.imageUrl = c.header.imageUrl.trim()
            const cardObj: CarouselCard = {
              header: hdr, body: { text: c.body.text.trim() }, footer: c.footer.trim(),
              buttons: c.buttons.filter(b => b.displayText.trim()).map((b, i) => ({
                type: b.type, displayText: b.displayText.trim(),
                ...(b.type === 'REPLY' ? { id: b.id || `cb_${i}` } : {}),
                ...(b.type === 'URL' && b.url ? { url: b.url.trim() } : {}),
                ...(b.type === 'CALL' && b.phoneNumber ? { phoneNumber: b.phoneNumber.trim() } : {}),
                ...(b.type === 'COPY' && b.copyCode ? { copyCode: b.copyCode.trim() } : {}),
              })),
            }
            return cardObj
          }),
        }
      }
    }
  }, [activeTab, validate, btnText, buttons, btnHeader, btnFooter, btnImageUrl,
      listText, listButtonText, sections, listHeader, listFooter,
      pollQuestion, pollOptions, pollSelectableCount,
      pixKey, pixKeyType, pixMerchantName, pixHeaderTitle, pixBodyText, pixFooterText,
      carouselBody, carouselFooter, cards])

  const handleSend = async () => { const p = buildPayload(); if (p) await onSend(p) }

  /* ─── Helpers ─── */
  const addButton = () => { if (buttons.length < 3) setButtons([...buttons, { id: `btn_${Date.now()}`, text: '', buttonType: 'reply' }]) }
  const rmButton = (i: number) => { if (buttons.length > 1) setButtons(buttons.filter((_, j) => j !== i)) }
  const setBtn = (i: number, f: keyof ButtonItem, v: string) => { const b = [...buttons]; b[i] = { ...b[i], [f]: v }; setButtons(b) }

  const addSection = () => setSections([...sections, { title: '', rows: [{ id: `r_${Date.now()}`, title: '', description: '' }] }])
  const rmSection = (i: number) => { if (sections.length > 1) setSections(sections.filter((_, j) => j !== i)) }
  const addRow = (si: number) => { const s = [...sections]; s[si] = { ...s[si], rows: [...s[si].rows, { id: `r_${Date.now()}`, title: '', description: '' }] }; setSections(s) }
  const rmRow = (si: number, ri: number) => { const s = [...sections]; s[si] = { ...s[si], rows: s[si].rows.filter((_, j) => j !== ri) }; setSections(s) }
  const setSec = (si: number, v: string) => { const s = [...sections]; s[si] = { ...s[si], title: v }; setSections(s) }
  const setRow = (si: number, ri: number, f: 'title' | 'description', v: string) => {
    const s = [...sections]; const rows = [...s[si].rows]; rows[ri] = { ...rows[ri], [f]: v }; s[si] = { ...s[si], rows }; setSections(s)
  }

  const addPollOpt = () => { if (pollOptions.length < 12) setPollOptions([...pollOptions, '']) }
  const rmPollOpt = (i: number) => { if (pollOptions.length > 2) setPollOptions(pollOptions.filter((_, j) => j !== i)) }
  const setPollOpt = (i: number, v: string) => { const o = [...pollOptions]; o[i] = v; setPollOptions(o) }

  const addCard = () => setCards([...cards, { header: { title: '' }, body: { text: '' }, footer: '', buttons: [{ type: 'REPLY', displayText: '', id: `cb_${Date.now()}` }] }])
  const rmCard = (i: number) => { if (cards.length > 1) setCards(cards.filter((_, j) => j !== i)) }
  const setCard = (i: number, fn: (c: CarouselCard) => CarouselCard) => { const c = [...cards]; c[i] = fn({ ...c[i] }); setCards(c) }

  /* ─── Preview data (no setState!) ─── */
  const previewData = useMemo(() => {
    switch (activeTab) {
      case 'buttons': return { type: activeTab, text: btnText, header: btnHeader, footer: btnFooter, imageUrl: btnImageUrl, buttons }
      case 'list': return { type: activeTab, text: listText, header: listHeader, footer: listFooter, buttonText: listButtonText, sections }
      case 'poll': return { type: activeTab, question: pollQuestion, options: pollOptions, selectableCount: pollSelectableCount }
      case 'pix': return { type: activeTab, pixKey, pixKeyType, merchantName: pixMerchantName, headerTitle: pixHeaderTitle, bodyText: pixBodyText, footerText: pixFooterText }
      case 'carousel': return { type: activeTab, body: carouselBody, footer: carouselFooter, cards }
    }
  }, [activeTab, btnText, btnHeader, btnFooter, btnImageUrl, buttons, listText, listHeader, listFooter, listButtonText, sections,
      pollQuestion, pollOptions, pollSelectableCount, pixKey, pixKeyType, pixMerchantName, pixHeaderTitle, pixBodyText, pixFooterText,
      carouselBody, carouselFooter, cards])

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="ic-overlay">
      <div className="ic-modal">

        {/* ═══ HEADER ═══ */}
        <div className="ic-header">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center">
              <Smartphone className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-white leading-tight">Mensagem Interativa</h2>
              <p className="text-[11px] text-[#8B9DB6] mt-0.5">
                {TABS.find(t => t.type === activeTab)?.label} — WhatsApp nativo via Evolution GO
              </p>
            </div>
          </div>
          <button onClick={onClose} className="ic-close-btn"><X className="h-4.5 w-4.5" /></button>
        </div>

        {/* ═══ TABS ═══ */}
        <div className="ic-tabs">
          {TABS.map(tab => {
            const active = activeTab === tab.type
            return (
              <button
                key={tab.type}
                onClick={() => { setActiveTab(tab.type); setErrors([]); setShowValidation(false) }}
                className={`ic-tab ${active ? 'ic-tab-active' : ''}`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* ═══ BODY: 2 columns ═══ */}
        <div className="ic-body">

          {/* ── LEFT: Form ── */}
          <div className="ic-form">

            {/* BUTTONS TAB */}
            {activeTab === 'buttons' && (
              <div className="ic-form-inner">
                <Field label="Texto da mensagem" required counter={`${btnText.length}/1024`}>
                  <textarea className="ic-input ic-textarea" rows={3} maxLength={1024} placeholder="Digite o texto principal da mensagem..." value={btnText} onChange={e => setBtnText(e.target.value)} />
                </Field>

                <div className="ic-row-2">
                  <Field label="Header" sub="opcional">
                    <input className="ic-input" maxLength={60} placeholder="Título (opcional)" value={btnHeader} onChange={e => setBtnHeader(e.target.value)} />
                  </Field>
                  <Field label="Footer" sub="opcional">
                    <input className="ic-input" maxLength={60} placeholder="Rodapé (opcional)" value={btnFooter} onChange={e => setBtnFooter(e.target.value)} />
                  </Field>
                </div>

                <Field label="Imagem no Header" sub="opcional" icon={<ImageIcon className="h-3 w-3" />}>
                  <input className="ic-input" placeholder="https://... (URL pública)" value={btnImageUrl} onChange={e => setBtnImageUrl(e.target.value)} />
                </Field>

                <div className="ic-section-title">
                  <span>Botões</span>
                  <span className="ic-badge">{buttons.length}/3</span>
                </div>

                <div className="space-y-2">
                  {buttons.map((btn, i) => (
                    <div key={i} className="ic-card">
                      <div className="flex items-center gap-2">
                        <span className="ic-num">{i + 1}</span>
                        <select className="ic-select-sm" value={btn.buttonType} onChange={e => setBtn(i, 'buttonType', e.target.value)}>
                          {Object.entries(BTN_TYPE_LABELS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
                        </select>
                        <input className="ic-input flex-1" maxLength={20} placeholder="Texto do botão"
                          value={btn.text} onChange={e => setBtn(i, 'text', e.target.value)} />
                        <span className="ic-counter-sm">{btn.text.length}/20</span>
                        {buttons.length > 1 && (
                          <button onClick={() => rmButton(i)} className="ic-btn-del"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                      {btn.buttonType === 'url' && (
                        <div className="mt-2 ml-6">
                          <input className="ic-input" placeholder="https://www.exemplo.com" value={btn.url || ''} onChange={e => setBtn(i, 'url', e.target.value)} />
                        </div>
                      )}
                      {btn.buttonType === 'copy' && (
                        <div className="mt-2 ml-6">
                          <input className="ic-input" placeholder="Texto que será copiado (ex: CUPOM20)" value={btn.copyCode || ''} onChange={e => setBtn(i, 'copyCode', e.target.value)} />
                        </div>
                      )}
                      {btn.buttonType === 'call' && (
                        <div className="mt-2 ml-6">
                          <input className="ic-input" placeholder="+5511999999999" value={btn.phoneNumber || ''} onChange={e => setBtn(i, 'phoneNumber', e.target.value)} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {buttons.length < 3 && (
                  <button onClick={addButton} className="ic-btn-add"><Plus className="h-3.5 w-3.5" /> Adicionar botão</button>
                )}

                <p className="ic-hint">⚠️ Botões "Resposta" NÃO podem ser misturados com Link / Copiar / Ligar</p>
              </div>
            )}

            {/* LIST TAB */}
            {activeTab === 'list' && (
              <div className="ic-form-inner">
                <Field label="Texto da mensagem" required>
                  <textarea className="ic-input ic-textarea" rows={3} maxLength={1024} placeholder="Texto acima do menu..." value={listText} onChange={e => setListText(e.target.value)} />
                </Field>

                <div className="ic-row-3">
                  <Field label="Header" sub="opcional">
                    <input className="ic-input" maxLength={60} value={listHeader} onChange={e => setListHeader(e.target.value)} />
                  </Field>
                  <Field label="Texto do Botão" required>
                    <input className="ic-input" maxLength={20} value={listButtonText} onChange={e => setListButtonText(e.target.value)} />
                  </Field>
                  <Field label="Footer" sub="opcional">
                    <input className="ic-input" maxLength={60} value={listFooter} onChange={e => setListFooter(e.target.value)} />
                  </Field>
                </div>

                <div className="ic-section-title"><span>Seções</span></div>

                {sections.map((sec, si) => (
                  <div key={si} className="ic-card">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="ic-num">{si + 1}</span>
                      <input className="ic-input flex-1" maxLength={24} placeholder="Título da seção" value={sec.title} onChange={e => setSec(si, e.target.value)} />
                      {sections.length > 1 && <button onClick={() => rmSection(si)} className="ic-btn-del"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    {sec.rows.map((row, ri) => (
                      <div key={ri} className="flex items-center gap-2 ml-6 mb-1.5">
                        <span className="text-[10px] text-[#5A7184]">•</span>
                        <input className="ic-input flex-1" maxLength={24} placeholder="Título do item" value={row.title} onChange={e => setRow(si, ri, 'title', e.target.value)} />
                        <input className="ic-input flex-1" maxLength={72} placeholder="Descrição (opc)" value={row.description} onChange={e => setRow(si, ri, 'description', e.target.value)} />
                        {sec.rows.length > 1 && <button onClick={() => rmRow(si, ri)} className="ic-btn-del-sm"><Trash2 className="h-3 w-3" /></button>}
                      </div>
                    ))}
                    <button onClick={() => addRow(si)} className="ic-btn-add-sm ml-6"><Plus className="h-3 w-3" /> Item</button>
                  </div>
                ))}

                <button onClick={addSection} className="ic-btn-add"><Plus className="h-3.5 w-3.5" /> Nova seção</button>
              </div>
            )}

            {/* POLL TAB */}
            {activeTab === 'poll' && (
              <div className="ic-form-inner">
                <Field label="Pergunta" required>
                  <input className="ic-input" maxLength={256} placeholder="Qual sua preferência?" value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} />
                </Field>

                <div className="ic-section-title"><span>Opções</span><span className="ic-badge">{pollOptions.length}/12</span></div>

                {pollOptions.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <span className="ic-num">{i + 1}</span>
                    <input className="ic-input flex-1" maxLength={100} placeholder={`Opção ${i + 1}`} value={opt} onChange={e => setPollOpt(i, e.target.value)} />
                    {pollOptions.length > 2 && <button onClick={() => rmPollOpt(i)} className="ic-btn-del-sm"><Trash2 className="h-3 w-3" /></button>}
                  </div>
                ))}
                {pollOptions.length < 12 && (
                  <button onClick={addPollOpt} className="ic-btn-add"><Plus className="h-3.5 w-3.5" /> Nova opção</button>
                )}

                <Field label="Respostas permitidas">
                  <select className="ic-input" value={pollSelectableCount} onChange={e => setPollSelectableCount(Number(e.target.value))}>
                    <option value={1}>Escolha única</option>
                    <option value={0}>Múltipla escolha</option>
                    {[2, 3, 4, 5].map(n => <option key={n} value={n}>Até {n}</option>)}
                  </select>
                </Field>
              </div>
            )}

            {/* PIX TAB */}
            {activeTab === 'pix' && (
              <div className="ic-form-inner">
                <div className="ic-pix-banner">
                  <QrCode className="h-4 w-4 text-[#25D366]" />
                  <span>PIX nativo do WhatsApp — aparece como botão de pagamento no celular</span>
                </div>

                <div className="ic-row-2">
                  <Field label="Chave PIX" required>
                    <input className="ic-input" placeholder="CPF, email, tel ou chave EVP" value={pixKey} onChange={e => setPixKey(e.target.value)} />
                  </Field>
                  <Field label="Tipo da Chave" required>
                    <select className="ic-input" value={pixKeyType} onChange={e => setPixKeyType(e.target.value)}>
                      <option value="cpf">CPF</option>
                      <option value="cnpj">CNPJ</option>
                      <option value="email">Email</option>
                      <option value="phone">Telefone</option>
                      <option value="evp">Chave Aleatória (EVP)</option>
                    </select>
                  </Field>
                </div>

                <Field label="Nome do Beneficiário" required>
                  <input className="ic-input" placeholder="Nome ou razão social" value={pixMerchantName} onChange={e => setPixMerchantName(e.target.value)} />
                </Field>

                <div className="ic-row-2">
                  <Field label="Título" sub="opcional">
                    <input className="ic-input" maxLength={60} placeholder="Ex: Pagamento" value={pixHeaderTitle} onChange={e => setPixHeaderTitle(e.target.value)} />
                  </Field>
                  <Field label="Rodapé" sub="opcional">
                    <input className="ic-input" maxLength={60} placeholder="Ex: Empresa Ltda" value={pixFooterText} onChange={e => setPixFooterText(e.target.value)} />
                  </Field>
                </div>

                <Field label="Texto do Corpo" sub="opcional">
                  <textarea className="ic-input ic-textarea" rows={2} maxLength={1024} placeholder="Mensagem adicional..." value={pixBodyText} onChange={e => setPixBodyText(e.target.value)} />
                </Field>
              </div>
            )}

            {/* CAROUSEL TAB */}
            {activeTab === 'carousel' && (
              <div className="ic-form-inner">
                <Field label="Texto Principal" required>
                  <textarea className="ic-input ic-textarea" rows={2} maxLength={1024} placeholder="Texto acima do carrossel..." value={carouselBody} onChange={e => setCarouselBody(e.target.value)} />
                </Field>
                <Field label="Rodapé" sub="opcional">
                  <input className="ic-input" maxLength={60} value={carouselFooter} onChange={e => setCarouselFooter(e.target.value)} />
                </Field>

                <div className="ic-section-title"><span>Cards</span><span className="ic-badge">{cards.length}/10</span></div>

                {cards.map((card, ci) => (
                  <div key={ci} className="ic-card">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="ic-num">{ci + 1}</span>
                        <span className="text-[11px] font-bold text-[#8B9DB6] uppercase tracking-wider">Card</span>
                      </div>
                      {cards.length > 1 && <button onClick={() => rmCard(ci)} className="ic-btn-del"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>

                    <div className="ic-row-2 mb-2">
                      <input className="ic-input" maxLength={60} placeholder="Título do card" value={card.header.title}
                        onChange={e => setCard(ci, c => ({ ...c, header: { ...c.header, title: e.target.value } }))} />
                      <input className="ic-input" placeholder="URL da imagem (https://...)" value={card.header.imageUrl || ''}
                        onChange={e => setCard(ci, c => ({ ...c, header: { ...c.header, imageUrl: e.target.value } }))} />
                    </div>

                    <textarea className="ic-input ic-textarea mb-2" rows={2} maxLength={1024} placeholder="Texto do card"
                      value={card.body.text} onChange={e => setCard(ci, c => ({ ...c, body: { text: e.target.value } }))} />

                    {/* Card buttons */}
                    <div className="ic-card-btns">
                      <span className="text-[10px] text-[#5A7184] uppercase tracking-wider font-semibold mb-1 block">Botões</span>
                      {card.buttons.map((btn, bi) => (
                        <div key={bi} className="flex items-center gap-1.5 mb-1">
                          <select className="ic-select-sm !w-[90px]" value={btn.type}
                            onChange={e => setCard(ci, c => { const bs = [...c.buttons]; bs[bi] = { ...bs[bi], type: e.target.value as any }; return { ...c, buttons: bs } })}>
                            <option value="REPLY">Resposta</option><option value="URL">Link</option>
                            <option value="CALL">Ligar</option><option value="COPY">Copiar</option>
                          </select>
                          <input className="ic-input flex-1" maxLength={20} placeholder="Texto" value={btn.displayText}
                            onChange={e => setCard(ci, c => { const bs = [...c.buttons]; bs[bi] = { ...bs[bi], displayText: e.target.value }; return { ...c, buttons: bs } })} />
                          {btn.type === 'URL' && <input className="ic-input flex-1" placeholder="https://..." value={btn.url || ''}
                            onChange={e => setCard(ci, c => { const bs = [...c.buttons]; bs[bi] = { ...bs[bi], url: e.target.value }; return { ...c, buttons: bs } })} />}
                          {btn.type === 'CALL' && <input className="ic-input flex-1" placeholder="5511..." value={btn.phoneNumber || ''}
                            onChange={e => setCard(ci, c => { const bs = [...c.buttons]; bs[bi] = { ...bs[bi], phoneNumber: e.target.value }; return { ...c, buttons: bs } })} />}
                          {btn.type === 'COPY' && <input className="ic-input flex-1" placeholder="Texto para copiar" value={btn.copyCode || ''}
                            onChange={e => setCard(ci, c => { const bs = [...c.buttons]; bs[bi] = { ...bs[bi], copyCode: e.target.value }; return { ...c, buttons: bs } })} />}
                        </div>
                      ))}
                      {card.buttons.length < 3 && (
                        <button onClick={() => setCard(ci, c => ({ ...c, buttons: [...c.buttons, { type: 'REPLY', displayText: '', id: `cb_${Date.now()}` }] }))}
                          className="ic-btn-add-sm"><Plus className="h-3 w-3" /> Botão</button>
                      )}
                    </div>
                  </div>
                ))}

                {cards.length < 10 && (
                  <button onClick={addCard} className="ic-btn-add"><Plus className="h-3.5 w-3.5" /> Novo Card</button>
                )}
              </div>
            )}

            {/* ─── Errors ─── */}
            {showValidation && errors.length > 0 && (
              <div className="ic-errors">
                {errors.map((e, i) => (
                  <p key={i} className="ic-error-item"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" /> {e}</p>
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT: WhatsApp Preview ── */}
          <div className="ic-preview-col">
            <div className="ic-preview-label">
              <Smartphone className="h-3.5 w-3.5" /> Pré-visualização
            </div>
            <div className="ic-phone">
              <div className="ic-phone-header">
                <div className="ic-phone-avatar">C</div>
                <div>
                  <div className="text-[12px] font-semibold text-white leading-tight">Cliente</div>
                  <div className="text-[9px] text-[#8696a0]">online</div>
                </div>
              </div>
              <div className="ic-phone-body">
                <div className="ic-wa-bubble">
                  <WaPreview data={previewData} />
                  <div className="text-right mt-1">
                    <span className="text-[9px] text-[#8696a0]">12:00 ✓✓</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <div className="ic-footer">
          <button onClick={onClose} className="ic-btn-cancel">Cancelar</button>
          <button onClick={handleSend} disabled={sending} className="ic-btn-send">
            {sending ? (
              <><span className="ic-spinner" /> Enviando...</>
            ) : (
              <><Send className="h-4 w-4" /> Enviar mensagem</>
            )}
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
         SCOPED STYLES
         ═══════════════════════════════════════════════════════════════ */}
      <style>{`
        /* ── Overlay & Modal ── */
        .ic-overlay { position:fixed; inset:0; z-index:90; background:rgba(0,0,0,.65); display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(4px); }
        .ic-modal { background:#0D1B2A; border-radius:16px; border:1px solid #1B3A5C; box-shadow:0 24px 80px rgba(0,0,0,.6); width:100%; max-width:960px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; }

        /* ── Header ── */
        .ic-header { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #1B3A5C; background:#0A1628; }
        .ic-close-btn { padding:6px; border-radius:8px; color:#5A7184; transition:all .15s; background:transparent; border:none; cursor:pointer; }
        .ic-close-btn:hover { background:#1B3A5C; color:#8B9DB6; }

        /* ── Tabs ── */
        .ic-tabs { display:flex; gap:2px; padding:8px 16px; border-bottom:1px solid #1B3A5C; background:#0A1628; overflow-x:auto; }
        .ic-tab { display:flex; align-items:center; gap:6px; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:600; white-space:nowrap; transition:all .15s; color:#5A7184; background:transparent; border:none; cursor:pointer; }
        .ic-tab:hover { background:#162D4A; color:#8B9DB6; }
        .ic-tab-active { background:linear-gradient(135deg, #25D366, #128C7E); color:#fff !important; box-shadow:0 2px 8px rgba(37,211,102,.3); }

        /* ── Body ── */
        .ic-body { display:flex; flex:1; overflow:hidden; min-height:0; }

        /* ── Form column ── */
        .ic-form { flex:1; overflow-y:auto; padding:20px; border-right:1px solid #1B3A5C; min-width:0; }
        .ic-form::-webkit-scrollbar { width:5px; }
        .ic-form::-webkit-scrollbar-track { background:transparent; }
        .ic-form::-webkit-scrollbar-thumb { background:#1B3A5C; border-radius:4px; }
        .ic-form-inner { display:flex; flex-direction:column; gap:14px; }

        /* ── Inputs ── */
        .ic-input { width:100%; padding:8px 12px; border-radius:8px; font-size:13px; border:1px solid #1B3A5C; background:#0A1628; color:#E1E8F0; outline:none; transition:border-color .15s, box-shadow .15s; }
        .ic-input::placeholder { color:#3E5C76; }
        .ic-input:focus { border-color:#25D366; box-shadow:0 0 0 3px rgba(37,211,102,.1); }
        .ic-textarea { resize:vertical; min-height:60px; line-height:1.5; }
        select.ic-input { cursor:pointer; appearance:auto; }

        .ic-select-sm { padding:5px 8px; border-radius:6px; font-size:12px; border:1px solid #1B3A5C; background:#0A1628; color:#E1E8F0; cursor:pointer; outline:none; }
        .ic-select-sm:focus { border-color:#25D366; }

        /* ── Grid helpers ── */
        .ic-row-2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .ic-row-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }

        /* ── Section title ── */
        .ic-section-title { display:flex; align-items:center; gap:8px; padding-bottom:4px; border-bottom:1px solid #1B3A5C; margin-top:4px; }
        .ic-section-title span:first-child { font-size:12px; font-weight:700; color:#8B9DB6; text-transform:uppercase; letter-spacing:.05em; }
        .ic-badge { font-size:10px; padding:2px 7px; border-radius:10px; background:#1B3A5C; color:#5A7184; font-weight:600; }

        /* ── Cards ── */
        .ic-card { padding:12px; border-radius:10px; border:1px solid #1B3A5C; background:#0F2234; }
        .ic-card-btns { padding-left:10px; border-left:2px solid #25D36640; margin-top:8px; }

        /* ── Number circle ── */
        .ic-num { width:20px; height:20px; border-radius:50%; background:#1B3A5C; color:#5A7184; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }

        /* ── Counters ── */
        .ic-counter-sm { font-size:10px; color:#3E5C76; flex-shrink:0; }

        /* ── Buttons ── */
        .ic-btn-add { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#25D366; background:transparent; border:1px dashed #25D36650; padding:8px 14px; border-radius:8px; cursor:pointer; transition:all .15s; }
        .ic-btn-add:hover { background:#25D36610; border-color:#25D366; }
        .ic-btn-add-sm { display:flex; align-items:center; gap:4px; font-size:11px; color:#25D366; background:transparent; border:none; cursor:pointer; padding:2px 0; }
        .ic-btn-add-sm:hover { text-decoration:underline; }
        .ic-btn-del { padding:4px; border-radius:6px; color:#5A7184; background:transparent; border:none; cursor:pointer; transition:all .15s; }
        .ic-btn-del:hover { background:rgba(239,68,68,.15); color:#ef4444; }
        .ic-btn-del-sm { padding:2px; border-radius:4px; color:#5A7184; background:transparent; border:none; cursor:pointer; }
        .ic-btn-del-sm:hover { color:#ef4444; }

        /* ── Hint & errors ── */
        .ic-hint { font-size:11px; color:#5A7184; margin-top:2px; }
        .ic-errors { margin-top:12px; padding:12px; border-radius:10px; background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.2); display:flex; flex-direction:column; gap:4px; }
        .ic-error-item { font-size:12px; color:#f87171; display:flex; align-items:start; gap:6px; }

        /* ── PIX banner ── */
        .ic-pix-banner { display:flex; align-items:center; gap:8px; padding:10px 14px; border-radius:10px; background:rgba(37,211,102,.08); border:1px solid rgba(37,211,102,.15); font-size:12px; color:#6ee7a0; }

        /* ── Preview column ── */
        .ic-preview-col { width:300px; min-width:300px; display:flex; flex-direction:column; padding:16px; background:#060F1A; overflow-y:auto; }
        .ic-preview-label { font-size:11px; font-weight:600; color:#3E5C76; text-transform:uppercase; letter-spacing:.06em; display:flex; align-items:center; gap:6px; margin-bottom:12px; }

        /* ── Phone mockup ── */
        .ic-phone { flex:1; border-radius:20px; border:2px solid #1B3A5C; overflow:hidden; display:flex; flex-direction:column; background:#0b141a; }
        .ic-phone-header { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#1f2c34; border-bottom:1px solid #2a3942; }
        .ic-phone-avatar { width:28px; height:28px; border-radius:50%; background:#25D366; color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; }
        .ic-phone-body { flex:1; padding:12px; overflow-y:auto; background:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%231B3A5C' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
        .ic-phone-body::-webkit-scrollbar { width:3px; }
        .ic-phone-body::-webkit-scrollbar-thumb { background:#1B3A5C; border-radius:2px; }
        .ic-wa-bubble { background:#005c4b; border-radius:0 8px 8px 8px; padding:8px 10px; max-width:100%; font-size:12.5px; color:#e9edef; line-height:1.4; word-break:break-word; }

        /* ── Footer ── */
        .ic-footer { display:flex; align-items:center; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #1B3A5C; background:#0A1628; }
        .ic-btn-cancel { padding:8px 18px; border-radius:8px; font-size:13px; color:#5A7184; border:1px solid #1B3A5C; background:transparent; cursor:pointer; transition:all .15s; }
        .ic-btn-cancel:hover { background:#1B3A5C; color:#8B9DB6; }
        .ic-btn-send { display:flex; align-items:center; gap:8px; padding:9px 22px; border-radius:8px; background:linear-gradient(135deg, #25D366, #128C7E); color:#fff; font-size:13px; font-weight:600; border:none; cursor:pointer; transition:all .15s; box-shadow:0 2px 8px rgba(37,211,102,.3); }
        .ic-btn-send:hover { opacity:.9; box-shadow:0 4px 16px rgba(37,211,102,.4); }
        .ic-btn-send:disabled { opacity:.5; cursor:not-allowed; }
        .ic-spinner { width:16px; height:16px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:ic-spin .6s linear infinite; display:inline-block; }
        @keyframes ic-spin { to { transform:rotate(360deg); } }

        /* ── Field label styles ── */
        .ic-field { display:flex; flex-direction:column; gap:5px; }
        .ic-field-header { display:flex; align-items:center; gap:6px; }
        .ic-field-label { font-size:11px; font-weight:700; color:#5A7184; text-transform:uppercase; letter-spacing:.04em; }
        .ic-field-req { color:#f87171; font-size:10px; }
        .ic-field-sub { font-size:10px; color:#3E5C76; }
        .ic-field-counter { margin-left:auto; font-size:10px; color:#3E5C76; }
      `}</style>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   FIELD COMPONENT
   ═══════════════════════════════════════════════════════════════ */

function Field({ label, required, sub, counter, icon, children }: {
  label: string; required?: boolean; sub?: string; counter?: string; icon?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="ic-field">
      <div className="ic-field-header">
        {icon}
        <span className="ic-field-label">{label}</span>
        {required && <span className="ic-field-req">*</span>}
        {sub && <span className="ic-field-sub">({sub})</span>}
        {counter && <span className="ic-field-counter">{counter}</span>}
      </div>
      {children}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   WHATSAPP PREVIEW
   ═══════════════════════════════════════════════════════════════ */

function WaPreview({ data }: { data: any }) {
  if (!data) return <span className="text-[#5A7184] text-[11px]">Preencha os campos...</span>

  const accent = '#53bdeb'

  switch (data.type) {
    case 'buttons': {
      const { text, header, footer, imageUrl, buttons = [] } = data
      const valid = buttons.filter((b: any) => b.text?.trim())
      return (
        <>
          {imageUrl?.trim() && (
            <div className="w-full h-[80px] bg-[#1B3A5C] rounded-md mb-1.5 flex items-center justify-center overflow-hidden">
              <img src={imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as any).style.display = 'none' }} />
            </div>
          )}
          {header?.trim() && <p className="text-[11px] font-bold opacity-80 mb-0.5">{header}</p>}
          <p className="text-[12px] leading-[1.4]">{text || <span className="opacity-30">Texto da mensagem...</span>}</p>
          {footer?.trim() && <p className="text-[10px] opacity-40 mt-1">{footer}</p>}
          {valid.length > 0 && (
            <div className="border-t border-white/10 -mx-2.5 px-2.5 mt-1.5 pt-1">
              {valid.map((b: any, i: number) => {
                const Icon = b.buttonType === 'url' ? Link2 : b.buttonType === 'call' ? Phone : b.buttonType === 'copy' ? Copy : MousePointerClick
                return (
                  <div key={i} className="py-1 text-center text-[11px] font-medium border-b border-white/5 last:border-0" style={{ color: accent }}>
                    <Icon className="inline-block h-2.5 w-2.5 mr-1 -mt-0.5" />{b.text}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )
    }

    case 'list': {
      const { text, header, footer, buttonText, sections = [] } = data
      return (
        <>
          {header?.trim() && <p className="text-[11px] font-bold opacity-80 mb-0.5">{header}</p>}
          <p className="text-[12px] leading-[1.4]">{text || <span className="opacity-30">Texto...</span>}</p>
          {footer?.trim() && <p className="text-[10px] opacity-40 mt-1">{footer}</p>}
          <div className="border-t border-white/10 -mx-2.5 px-2.5 mt-1.5 pt-1.5">
            {sections.map((s: any, si: number) => (
              <div key={si} className="mb-1.5">
                {s.title?.trim() && <p className="text-[9px] font-bold opacity-40 uppercase tracking-wider">{s.title}</p>}
                {(s.rows || []).filter((r: any) => r.title?.trim()).map((r: any, ri: number) => (
                  <div key={ri} className="flex items-center gap-1 py-0.5">
                    <span className="text-[9px] opacity-30">•</span>
                    <span className="text-[10.5px]">{r.title}</span>
                    {r.description?.trim() && <span className="text-[9px] opacity-40">— {r.description}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 -mx-2.5 px-2.5 pt-1.5 text-center">
            <span className="text-[11px] font-medium flex items-center justify-center gap-1" style={{ color: accent }}>
              <List className="h-3 w-3" /> {buttonText || 'Menu'}
            </span>
          </div>
        </>
      )
    }

    case 'poll': {
      const { question, options = [], selectableCount } = data
      return (
        <>
          <div className="flex items-center gap-1 mb-1">
            <BarChart3 className="h-3 w-3" style={{ color: accent }} />
            <span className="text-[9px] font-bold opacity-40 uppercase">Enquete</span>
          </div>
          <p className="text-[12.5px] font-semibold leading-[1.3] mb-1.5">{question || <span className="opacity-30">Pergunta...</span>}</p>
          {options.filter((o: string) => o.trim()).map((o: string, i: number) => (
            <div key={i} className="flex items-center gap-2 py-1 px-2 mb-1 rounded bg-white/5">
              <div className="w-3 h-3 rounded-full border border-[#53bdeb] flex-shrink-0" />
              <span className="text-[11px]">{o}</span>
            </div>
          ))}
          {selectableCount != null && selectableCount !== 1 && (
            <p className="text-[9px] opacity-30 mt-1">{selectableCount === 0 ? 'Múltipla escolha' : `Até ${selectableCount} opções`}</p>
          )}
        </>
      )
    }

    case 'pix': {
      const { pixKey, pixKeyType, merchantName, headerTitle, bodyText, footerText } = data
      return (
        <>
          <div className="flex items-center gap-1 mb-1.5">
            <QrCode className="h-3 w-3 text-[#25D366]" />
            <span className="text-[9px] font-bold text-[#25D366] uppercase">PIX</span>
          </div>
          {headerTitle?.trim() && <p className="text-[11px] font-bold mb-0.5">{headerTitle}</p>}
          {bodyText?.trim() && <p className="text-[11px] opacity-70 mb-1">{bodyText}</p>}
          <div className="bg-white/5 rounded-md p-2 space-y-0.5">
            <div className="flex gap-1"><span className="text-[9px] opacity-40">Chave:</span><span className="text-[10px] font-mono">{pixKey || '...'}</span></div>
            {pixKeyType && <div className="flex gap-1"><span className="text-[9px] opacity-40">Tipo:</span><span className="text-[10px]">{pixKeyType.toUpperCase()}</span></div>}
            <div className="flex gap-1"><span className="text-[9px] opacity-40">Beneficiário:</span><span className="text-[10px]">{merchantName || '...'}</span></div>
          </div>
          {footerText?.trim() && <p className="text-[9px] opacity-30 mt-1">{footerText}</p>}
          <div className="border-t border-white/10 -mx-2.5 px-2.5 mt-1.5 pt-1 text-center">
            <span className="text-[11px] font-medium" style={{ color: '#25D366' }}>💳 Pagar com PIX</span>
          </div>
        </>
      )
    }

    case 'carousel': {
      const { body, footer, cards = [] } = data
      return (
        <>
          <p className="text-[12px] leading-[1.4] mb-1">{body || <span className="opacity-30">Texto...</span>}</p>
          {footer?.trim() && <p className="text-[10px] opacity-40 mb-1.5">{footer}</p>}
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
            {cards.map((c: any, ci: number) => (
              <div key={ci} className="flex-shrink-0 w-[140px] rounded-md border border-white/10 overflow-hidden bg-white/5">
                {c.header?.imageUrl?.trim() && (
                  <div className="w-full h-[55px] bg-[#1B3A5C]">
                    <img src={c.header.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as any).style.display = 'none' }} />
                  </div>
                )}
                <div className="p-1.5">
                  {c.header?.title?.trim() && <p className="text-[9px] font-bold truncate">{c.header.title}</p>}
                  {c.body?.text?.trim() && <p className="text-[8px] opacity-60 line-clamp-2">{c.body.text}</p>}
                  {(c.buttons || []).filter((b: any) => b.displayText?.trim()).map((b: any, bi: number) => (
                    <div key={bi} className="text-center py-0.5 mt-0.5 text-[8px] font-medium border-t border-white/5" style={{ color: accent }}>
                      {b.displayText}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!cards.length && <span className="text-[10px] opacity-30">Adicione cards...</span>}
          </div>
        </>
      )
    }

    default:
      return <span className="text-[11px] opacity-30">Selecione um tipo...</span>
  }
}
