/**
 * Renderiza mensagens interativas (botões, lista, enquete, PIX, carrossel) dentro das bolhas de chat.
 * Os dados são extraídos do campo `metadata.interactive` da mensagem.
 */

import { List, BarChart3, QrCode, MousePointerClick, Copy, Check, Link2, Phone, LayoutGrid } from 'lucide-react'
import { useState } from 'react'

interface InteractiveData {
  type: 'buttons' | 'list' | 'poll' | 'pix' | 'carousel'
  // buttons
  text?: string
  buttons?: Array<{ id: string; text: string; buttonType?: string; url?: string; copyCode?: string; phoneNumber?: string }>
  footer?: string
  header?: string
  imageUrl?: string
  videoUrl?: string
  // list
  buttonText?: string
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
  // poll
  question?: string
  options?: string[]
  selectableCount?: number
  // pix
  pixKey?: string
  pixKeyType?: string
  merchantName?: string
  headerTitle?: string
  bodyText?: string
  footerText?: string
  // carousel
  body?: string
  cards?: Array<{
    header?: { title?: string; imageUrl?: string; videoUrl?: string }
    body?: { text?: string }
    footer?: string
    buttons?: Array<{ type: string; displayText: string; url?: string; phoneNumber?: string; copyCode?: string }>
  }>
}

interface Props {
  data: InteractiveData
  isOutbound: boolean
}

export default function InteractiveMessageBubble({ data, isOutbound }: Props) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  if (!data || !data.type) return null

  const accentColor = isOutbound ? 'rgba(83, 189, 235, 0.9)' : 'rgba(83, 189, 235, 0.8)'

  switch (data.type) {
    case 'buttons':
      return (
        <div className="min-w-[200px] max-w-full">
          {data.header && (
            <p className="text-[12px] font-bold mb-1 opacity-80">{data.header}</p>
          )}
          {data.imageUrl && (
            <img src={data.imageUrl} alt="" className="w-full rounded-md mb-1.5 max-h-[200px] object-cover" />
          )}
          {data.text && (
            <p className="text-[13.5px] leading-[1.35] mb-1.5">{data.text}</p>
          )}
          {data.footer && (
            <p className="text-[11px] opacity-50 mb-2">{data.footer}</p>
          )}
          <div className="border-t border-current/10 -mx-2.5 px-2.5 pt-1">
            {(data.buttons || []).map((btn, i) => {
              const BtnIcon = btn.buttonType === 'url' ? Link2
                : btn.buttonType === 'call' ? Phone
                : btn.buttonType === 'copy' ? Copy
                : MousePointerClick
              return (
                <div
                  key={i}
                  className="py-1.5 text-center text-[13px] font-medium border-b border-current/5 last:border-0"
                  style={{ color: accentColor }}
                >
                  <BtnIcon className="inline-block h-3 w-3 mr-1 -mt-0.5" />
                  {btn.text}
                </div>
              )
            })}
          </div>
        </div>
      )

    case 'list':
      return (
        <div className="min-w-[200px] max-w-full">
          {data.header && (
            <p className="text-[12px] font-bold mb-1 opacity-80">{data.header}</p>
          )}
          {data.text && (
            <p className="text-[13.5px] leading-[1.35] mb-1.5">{data.text}</p>
          )}
          {data.footer && (
            <p className="text-[11px] opacity-50 mb-2">{data.footer}</p>
          )}
          {/* Mini preview of sections */}
          <div className="border-t border-current/10 -mx-2.5 px-2.5 pt-1.5 mb-1">
            {(data.sections || []).map((section, si) => (
              <div key={si} className="mb-1.5">
                <p className="text-[10.5px] font-semibold opacity-60 uppercase tracking-wider mb-0.5">{section.title}</p>
                {section.rows.map((row, ri) => (
                  <div key={ri} className="flex items-start gap-1.5 py-0.5">
                    <span className="text-[11px] opacity-40 mt-px">•</span>
                    <div>
                      <span className="text-[12px]">{row.title}</span>
                      {row.description && (
                        <span className="text-[10.5px] opacity-50 ml-1">— {row.description}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-current/10 -mx-2.5 px-2.5 pt-1.5 text-center">
            <span className="text-[13px] font-medium flex items-center justify-center gap-1.5" style={{ color: accentColor }}>
              <List className="h-3.5 w-3.5" />
              {data.buttonText || 'Menu'}
            </span>
          </div>
        </div>
      )

    case 'poll':
      return (
        <div className="min-w-[200px] max-w-full">
          <div className="flex items-center gap-1.5 mb-1.5">
            <BarChart3 className="h-3.5 w-3.5" style={{ color: accentColor }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider opacity-60">Enquete</span>
          </div>
          <p className="text-[14px] font-semibold leading-[1.3] mb-2">{data.question}</p>
          <div className="space-y-1.5">
            {(data.options || []).map((opt, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md"
                style={{ background: isOutbound ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
              >
                <div className="w-3.5 h-3.5 rounded-full border-[1.5px] flex-shrink-0"
                  style={{ borderColor: accentColor }}
                />
                <span className="text-[12.5px]">{opt}</span>
              </div>
            ))}
          </div>
          {data.selectableCount != null && data.selectableCount !== 1 && (
            <p className="text-[10.5px] opacity-40 mt-1.5">
              {data.selectableCount === 0
                ? 'Múltiplas opções permitidas'
                : `Selecione até ${data.selectableCount}`}
            </p>
          )}
        </div>
      )

    case 'pix':
      return (
        <div className="min-w-[220px] max-w-full">
          <div className="flex items-center gap-1.5 mb-2">
            <QrCode className="h-3.5 w-3.5" style={{ color: accentColor }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider opacity-60">Pagamento PIX</span>
          </div>

          <div className="space-y-1">
            {data.headerTitle && (
              <p className="text-[13px] font-bold mb-1">{data.headerTitle}</p>
            )}

            <div className="flex items-center gap-2">
              <span className="text-[11.5px] opacity-50 flex-shrink-0">Chave:</span>
              <code
                className="text-[12px] px-1.5 py-0.5 rounded font-mono flex-1 truncate"
                style={{ background: isOutbound ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }}
              >
                {data.pixKey}
              </code>
              <button
                onClick={() => data.pixKey && copyToClipboard(data.pixKey)}
                className="p-1 rounded hover:bg-white/10 transition-colors flex-shrink-0"
                title="Copiar chave PIX"
              >
                {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 opacity-50" />}
              </button>
            </div>

            {data.pixKeyType && (
              <div className="flex gap-2">
                <span className="text-[11.5px] opacity-50">Tipo:</span>
                <span className="text-[12px]">{data.pixKeyType.toUpperCase()}</span>
              </div>
            )}

            <div className="flex gap-2">
              <span className="text-[11.5px] opacity-50">Beneficiário:</span>
              <span className="text-[12px]">{data.merchantName}</span>
            </div>

            {data.bodyText && (
              <p className="text-[12px] opacity-70 mt-1">{data.bodyText}</p>
            )}

            {data.footerText && (
              <p className="text-[11px] opacity-50 mt-1">{data.footerText}</p>
            )}
          </div>
        </div>
      )

    case 'carousel':
      return (
        <div className="min-w-[240px] max-w-full">
          <div className="flex items-center gap-1.5 mb-2">
            <LayoutGrid className="h-3.5 w-3.5" style={{ color: accentColor }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider opacity-60">Carrossel</span>
          </div>
          {data.body && <p className="text-[13px] leading-[1.35] mb-2">{data.body}</p>}
          {data.footer && <p className="text-[11px] opacity-50 mb-2">{data.footer}</p>}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {(data.cards || []).map((card, ci) => (
              <div
                key={ci}
                className="flex-shrink-0 w-[200px] rounded-lg border overflow-hidden"
                style={{ borderColor: isOutbound ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', background: isOutbound ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }}
              >
                {card.header?.imageUrl && (
                  <img src={card.header.imageUrl} alt="" className="w-full h-[100px] object-cover" />
                )}
                <div className="p-2">
                  {card.header?.title && <p className="text-[12px] font-bold mb-0.5">{card.header.title}</p>}
                  {card.body?.text && <p className="text-[11.5px] leading-[1.3] opacity-80">{card.body.text}</p>}
                  {card.footer && <p className="text-[10px] opacity-40 mt-1">{card.footer}</p>}
                  {card.buttons && card.buttons.length > 0 && (
                    <div className="border-t border-current/10 mt-1.5 pt-1">
                      {card.buttons.map((btn, bi) => {
                        const Icon = btn.type === 'URL' ? Link2 : btn.type === 'CALL' ? Phone : btn.type === 'COPY' ? Copy : MousePointerClick
                        return (
                          <div key={bi} className="py-1 text-center text-[11px] font-medium" style={{ color: accentColor }}>
                            <Icon className="inline-block h-2.5 w-2.5 mr-0.5 -mt-0.5" />
                            {btn.displayText}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )

    default:
      return null
  }
}
