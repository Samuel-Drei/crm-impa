import { memo } from 'react'
import {
  Handle as ReactFlowHandle,
  Position,
  useNodeConnections,
  type HandleProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  Play,
  MessageSquare,
  Image,
  Mic,
  Video,
  FileText,
  MousePointer,
  List,
  LayoutGrid,
  GitBranch,
  Clock,
  Variable,
  Globe,
  PhoneForwarded,
  ArrowRight,
  StopCircle,
  Edit3,
  Trash2,
  Send,
  Database,
  Zap,
  Users,
  XCircle,
  Brain,
  Bot,
  BookOpen,
  GitMerge,
  Repeat,
  Inbox,
  CheckCircle,
  Code,
  UserCheck,
  UserPlus,
  Tag,
  ArrowRightLeft,
  ListTodo,
  Bell,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  connectedHandleClassByType,
  isFlowHandleConnected,
} from '@/lib/flowConnectedHandles'
import type { FlowButton, FlowCarouselButton, FlowCarouselCard } from '@/types'

interface BaseNodeData extends Record<string, unknown> {
  label?: string
  header?: string
  content?: string
  footer?: string
  buttons?: FlowButton[]
  carouselCards?: FlowCarouselCard[]
  listSections?: Array<{ title: string; rows: Array<{ id: string; title: string }> }>
  menuOptions?: Array<{ id: string; trigger: string; label: string }>
  waitForInput?: boolean
  inputVariable?: string
  delay?: number
  variable?: string
  value?: string
  condition?: { variable: string; operator: string; value?: string; cases?: Array<{ id: string; value: string }> }
  mediaUrl?: string
  httpConfig?: { url?: string; method?: string; headers?: Array<{ key: string; value: string }>; body?: string; responseVariable?: string; responseMappings?: Array<{ path: string; variable: string }> }
  auditEnabled?: boolean
  auditWebhookEnabled?: boolean
}

type FlowBuilderNodeProps = NodeProps<Node<BaseNodeData>>

const getFlowButtonType = (button: FlowButton) => button.buttonType || 'reply'
const isReplyFlowButton = (button: FlowButton) => getFlowButtonType(button) === 'reply'
const getCarouselButtonType = (button: FlowCarouselButton) => button.buttonType || 'reply'
const isReplyCarouselButton = (button: FlowCarouselButton) => getCarouselButtonType(button) === 'reply'

// Modern card styles
const cardStyles = {
  base: 'min-w-[220px] max-w-[280px] bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden transition-all duration-200 hover:shadow-xl',
  selected: 'ring-2 ring-purple-500 ring-offset-2',
  header: 'px-4 py-3 text-white font-semibold text-sm flex items-center gap-2',
  subtitle: 'text-[10px] opacity-80 font-normal',
  body: 'px-4 py-3 text-gray-600 text-xs leading-relaxed',
  footer: 'px-4 py-2 border-t border-gray-50 flex items-center justify-between',
  handle: 'w-3 h-3 !bg-purple-500 border-2 border-white shadow-md',
  handleLabel: 'absolute text-[9px] text-gray-400 whitespace-nowrap',
}

const compatibilityHandleStyle = {
  opacity: 0,
  pointerEvents: 'none' as const,
}

const Handle = ({ className, type, id, ...props }: HandleProps) => {
  const connections = useNodeConnections({ handleType: type })
  const isConnected = isFlowHandleConnected({
    type,
    handleId: id,
    connections,
  })

  return (
    <ReactFlowHandle
      {...props}
      type={type}
      id={id}
      className={cn(className, isConnected && connectedHandleClassByType[type])}
    />
  )
}

// Gradient backgrounds for different node types
const gradients = {
  start: 'bg-gradient-to-r from-green-500 to-emerald-600',
  message: 'bg-gradient-to-r from-pink-500 to-purple-600',
  media: 'bg-gradient-to-r from-purple-500 to-indigo-600',
  interaction: 'bg-gradient-to-r from-rose-500 to-pink-600',
  data: 'bg-gradient-to-r from-emerald-500 to-teal-600',
  logic: 'bg-gradient-to-r from-amber-500 to-orange-600',
  api: 'bg-gradient-to-r from-blue-500 to-cyan-600',
  transfer: 'bg-gradient-to-r from-gray-500 to-slate-600',
  end: 'bg-gradient-to-r from-red-500 to-rose-600',
  ai: 'bg-gradient-to-r from-violet-500 to-purple-600',
  aiAgent: 'bg-gradient-to-r from-purple-500 to-fuchsia-600',
  knowledge: 'bg-gradient-to-r from-indigo-500 to-violet-600',
  crm: 'bg-gradient-to-r from-teal-500 to-emerald-600',
  notification: 'bg-gradient-to-r from-fuchsia-500 to-pink-600',
  code: 'bg-gradient-to-r from-sky-500 to-blue-600',
  template: 'bg-gradient-to-r from-teal-500 to-cyan-600',
}

// Common handles: visible input on the left, visible output on the right.
// Hidden compatibility handles keep existing saved edges anchored after older
// layouts used top targets and bottom sources.
const InputHandles = () => (
  <>
    <Handle type="target" position={Position.Left} id="target-left" className={cardStyles.handle} />
    <Handle
      type="target"
      position={Position.Left}
      id="target-top"
      className={cardStyles.handle}
      style={compatibilityHandleStyle}
    />
  </>
)

const OutputHandles = () => (
  <>
    <Handle type="source" position={Position.Right} id="source-right" className={cardStyles.handle} />
    <Handle
      type="source"
      position={Position.Right}
      id="source-bottom"
      className={cardStyles.handle}
      style={compatibilityHandleStyle}
    />
  </>
)

// Action buttons component - Edit emits custom event to open properties panel
const ActionButtons = ({ nodeId }: { nodeId?: string }) => (
  <div className="flex items-center gap-1">
    <button
      className="w-6 h-6 rounded-full bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center transition-colors"
      onClick={(e) => {
        e.stopPropagation()
        if (nodeId) window.dispatchEvent(new CustomEvent('editNode', { detail: { id: nodeId } }))
      }}
      title="Editar"
    >
      <Edit3 className="w-3 h-3 text-emerald-600" />
    </button>
  </div>
)

// Port label component
const PortLabel = ({ label, position }: { label: string; position: 'left' | 'right' | 'bottom' }) => {
  const positionStyles = {
    left: '-left-16 top-1/2 -translate-y-1/2',
    right: '-right-16 top-1/2 -translate-y-1/2',
    bottom: 'left-1/2 -translate-x-1/2 -bottom-5',
  }
  return (
    <span className={cn(cardStyles.handleLabel, positionStyles[position])}>
      {label}
    </span>
  )
}

// Start Node
export const StartNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <div className={cn(cardStyles.header, gradients.start)}>
      <Play className="w-4 h-4" />
      <div>
        <span>Início do Fluxo</span>
        <div className={cardStyles.subtitle}>Ponto de entrada</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      <p className="text-gray-500 italic">
        {data.label || 'O fluxo começa aqui quando acionado'}
      </p>
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Trigger</span>
      <Zap className="w-3 h-3 text-green-500" />
    </div>
    <OutputHandles />
  </div>
))
StartNode.displayName = 'StartNode'

// Message Node
export const MessageNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, data.waitForInput ? 'bg-gradient-to-r from-violet-500 to-purple-600' : gradients.message)}>
      <MessageSquare className="w-4 h-4" />
      <div>
        <span>{data.waitForInput ? 'Pergunta' : 'Mensagem'}</span>
        <div className={cardStyles.subtitle}>{data.waitForInput ? 'Aguarda resposta' : 'Enviar texto'}</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {data.content ? (
        <p className="line-clamp-3">{data.content}</p>
      ) : (
        <p className="italic text-gray-400">Clique para configurar a mensagem...</p>
      )}
      {data.waitForInput && data.inputVariable && (
        <div className="mt-2 flex items-center gap-1.5 px-2 py-1 bg-violet-50 rounded-lg">
          <Variable className="w-3 h-3 text-violet-500" />
          <span className="text-[10px] text-violet-600 font-mono">{`{{${data.inputVariable}}}`}</span>
        </div>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400 flex items-center gap-1">
        <Send className="w-3 h-3" /> {data.waitForInput ? 'Input' : 'Texto'}
      </span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
MessageNode.displayName = 'MessageNode'

// Image Node
export const ImageNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.media)}>
      <Image className="w-4 h-4" />
      <div>
        <span>Imagem</span>
        <div className={cardStyles.subtitle}>Enviar mídia</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {data.mediaUrl ? (
        <div className="space-y-1">
          <p className="truncate text-xs font-mono bg-gray-50 px-2 py-1 rounded">{data.mediaUrl}</p>
          {data.content && <p className="line-clamp-2">{data.content}</p>}
        </div>
      ) : (
        <p className="italic text-gray-400">Clique para adicionar imagem...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Mídia</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
ImageNode.displayName = 'ImageNode'

// Audio Node
export const AudioNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.media)}>
      <Mic className="w-4 h-4" />
      <div>
        <span>Áudio</span>
        <div className={cardStyles.subtitle}>Enviar áudio</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {data.mediaUrl ? (
        <p className="truncate font-mono bg-gray-50 px-2 py-1 rounded">{data.mediaUrl}</p>
      ) : (
        <p className="italic text-gray-400">Clique para adicionar áudio...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Áudio</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
AudioNode.displayName = 'AudioNode'

// Video Node
export const VideoNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.media)}>
      <Video className="w-4 h-4" />
      <div>
        <span>Vídeo</span>
        <div className={cardStyles.subtitle}>Enviar vídeo</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {data.mediaUrl ? (
        <div className="space-y-1">
          <p className="truncate font-mono bg-gray-50 px-2 py-1 rounded">{data.mediaUrl}</p>
          {data.content && <p className="line-clamp-2">{data.content}</p>}
        </div>
      ) : (
        <p className="italic text-gray-400">Clique para adicionar vídeo...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Vídeo</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
VideoNode.displayName = 'VideoNode'

// Document Node
export const DocumentNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.media)}>
      <FileText className="w-4 h-4" />
      <div>
        <span>Documento</span>
        <div className={cardStyles.subtitle}>Enviar arquivo</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {data.mediaUrl ? (
        <p className="truncate font-mono bg-gray-50 px-2 py-1 rounded">{data.mediaUrl}</p>
      ) : (
        <p className="italic text-gray-400">Clique para adicionar documento...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">PDF/Doc</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
DocumentNode.displayName = 'DocumentNode'

// Menu Node - Text-based menu with numbered options
export const MenuNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => {
  const options = data.menuOptions || []

  return (
    <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
      <InputHandles />
      <div className={cn(cardStyles.header, gradients.interaction)}>
        <List className="w-4 h-4" />
        <div>
          <span>Menu de Opções</span>
          <div className={cardStyles.subtitle}>Escolha múltipla</div>
        </div>
      </div>
      <div className={cardStyles.body}>
        {data.content && <p className="mb-2 font-medium text-gray-700">{data.content}</p>}
        {options.length > 0 ? (
          <div className="space-y-1">
            {options.map((opt, i) => (
              <div key={opt.id} className="flex items-center gap-2 px-2 py-1 bg-gradient-to-r from-pink-50 to-purple-50 rounded-lg">
                <span className="w-5 h-5 rounded-full bg-purple-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {opt.trigger}
                </span>
                <span className="text-gray-600">{opt.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="italic text-gray-400">Adicione opções do menu...</p>
        )}
      </div>
      <div className={cardStyles.footer}>
        <span className="text-[10px] text-gray-400">{options.length} opções</span>
        <ActionButtons nodeId={id} />
      </div>
      {/* Hidden compatibility handles for older bottom-output edges */}
      {options.length > 0 ? (
        <>
          {options.map((opt, i) => (
            <div key={`compat-${opt.id}`}>
              <Handle
                type="source"
                position={Position.Right}
                id={opt.id}
                className={cardStyles.handle}
                style={{
                  top: `${((i + 1) / (options.length + 2)) * 100}%`,
                  ...compatibilityHandleStyle,
                }}
              />
            </div>
          ))}
          <div>
            <Handle
              type="source"
              position={Position.Right}
              id="fallback"
              className={cn(cardStyles.handle, '!bg-gray-400')}
              style={{
                top: `${((options.length + 1) / (options.length + 2)) * 100}%`,
                ...compatibilityHandleStyle,
              }}
            />
          </div>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="source-bottom"
          className={cardStyles.handle}
          style={compatibilityHandleStyle}
        />
      )}
      {/* Right-side handles */}
      {options.length > 0 ? (
        <>
          {options.map((opt, i) => (
            <div key={`right-${opt.id}`}>
              <Handle
                type="source"
                position={Position.Right}
                id={`right-${opt.id}`}
                className={cardStyles.handle}
                style={{ top: `${((i + 1) / (options.length + 2)) * 100}%` }}
              />
              <span
                className="absolute text-[8px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none"
                style={{ right: -8, top: `${((i + 1) / (options.length + 2)) * 100}%`, transform: 'translate(100%, -50%)' }}
              >
                {opt.trigger}
              </span>
            </div>
          ))}
          <div>
            <Handle
              type="source"
              position={Position.Right}
              id="right-fallback"
              className={cn(cardStyles.handle, '!bg-gray-400')}
              style={{ top: `${((options.length + 1) / (options.length + 2)) * 100}%` }}
            />
            <span
              className="absolute text-[8px] bg-gray-400 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none"
              style={{ right: -8, top: `${((options.length + 1) / (options.length + 2)) * 100}%`, transform: 'translate(100%, -50%)' }}
            >
              outro
            </span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} id="source-right" className={cardStyles.handle} />
      )}
    </div>
  )
})
MenuNode.displayName = 'MenuNode'

// Buttons Node
export const ButtonsNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => {
  const buttons = data.buttons || []
  const replyButtons = buttons.filter(isReplyFlowButton)
  const hasPixButton = buttons.some(btn => getFlowButtonType(btn) === 'pix')

  return (
    <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
      <InputHandles />
      <div className={cn(cardStyles.header, gradients.interaction)}>
        <MousePointer className="w-4 h-4" />
        <div>
          <span>Botões</span>
          <div className={cardStyles.subtitle}>{replyButtons.length > 0 ? 'Resposta rápida' : 'Ação'}</div>
        </div>
      </div>
      <div className={cardStyles.body}>
        {data.header && !hasPixButton && <p className="mb-1 font-semibold text-gray-800">{data.header}</p>}
        {data.content && !hasPixButton && <p className="mb-2 font-medium text-gray-700">{data.content}</p>}
        {buttons.length > 0 ? (
          <div className="space-y-1">
            {buttons.map((btn, i) => (
              <div key={btn.id || i} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg text-center text-xs font-medium">
                <span className="uppercase text-[9px] opacity-80 mr-1">{getFlowButtonType(btn)}</span>
                {btn.text || 'Botao'}
              </div>
            ))}
          </div>
        ) : (
          <p className="italic text-gray-400">Adicione botões...</p>
        )}
        {data.footer && !hasPixButton && <p className="mt-2 text-[10px] text-gray-400">{data.footer}</p>}
      </div>
      <div className={cardStyles.footer}>
        <span className="text-[10px] text-gray-400">{buttons.length || 0} botões</span>
        <ActionButtons nodeId={id} />
      </div>
      {replyButtons.length > 0 ? (
        replyButtons.map((btn, i) => (
          <div key={`compat-${btn.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={btn.id}
              className={cardStyles.handle}
              style={{
                top: `${((i + 1) / (replyButtons.length + 1)) * 100}%`,
                ...compatibilityHandleStyle,
              }}
            />
          </div>
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="source-bottom"
          className={cardStyles.handle}
          style={compatibilityHandleStyle}
        />
      )}
      {/* Right-side handles */}
      {replyButtons.length > 0 ? (
        replyButtons.map((btn, i) => (
          <div key={`right-${btn.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={`right-${btn.id}`}
              className={cardStyles.handle}
              style={{ top: `${((i + 1) / (replyButtons.length + 1)) * 100}%` }}
            />
            <span
              className="absolute text-[8px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none"
              style={{ right: -8, top: `${((i + 1) / (replyButtons.length + 1)) * 100}%`, transform: 'translate(100%, -50%)' }}
            >
              {btn.text}
            </span>
          </div>
        ))
      ) : (
        <Handle type="source" position={Position.Right} id="source-right" className={cardStyles.handle} />
      )}
    </div>
  )
})
ButtonsNode.displayName = 'ButtonsNode'

// Carousel Node
export const CarouselNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => {
  const cards = data.carouselCards || []
  const replyButtons = cards.flatMap((card) =>
    (card.buttons || [])
      .filter(isReplyCarouselButton)
      .map((button) => ({ ...button, cardTitle: card.header?.title || card.body?.text || 'Card' }))
  )

  return (
    <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
      <InputHandles />
      <div className={cn(cardStyles.header, 'bg-gradient-to-r from-fuchsia-500 to-rose-600')}>
        <LayoutGrid className="w-4 h-4" />
        <div>
          <span>Carrossel</span>
          <div className={cardStyles.subtitle}>{cards.length || 0} cards</div>
        </div>
      </div>
      <div className={cardStyles.body}>
        {data.content ? (
          <p className="mb-2 font-medium text-gray-700 line-clamp-2">{data.content}</p>
        ) : (
          <p className="mb-2 italic text-gray-400">Texto acima do carrossel...</p>
        )}
        {cards.length > 0 ? (
          <div className="flex gap-2 overflow-hidden">
            {cards.slice(0, 2).map((card, i) => (
              <div key={card.id || i} className="w-[92px] shrink-0 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                {card.header?.imageUrl ? (
                  <div className="h-10 bg-gray-200">
                    <img src={card.header.imageUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="h-10 bg-gradient-to-br from-fuchsia-100 to-rose-100" />
                )}
                <div className="p-1.5">
                  <p className="truncate text-[9px] font-semibold text-gray-700">{card.header?.title || `Card ${i + 1}`}</p>
                  <p className="line-clamp-2 text-[8px] text-gray-500">{card.body?.text || 'Sem texto'}</p>
                </div>
              </div>
            ))}
            {cards.length > 2 && (
              <div className="flex w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-[10px] font-semibold text-gray-400">
                +{cards.length - 2}
              </div>
            )}
          </div>
        ) : (
          <p className="italic text-gray-400">Adicione cards...</p>
        )}
      </div>
      <div className={cardStyles.footer}>
        <span className="text-[10px] text-gray-400">{replyButtons.length} respostas</span>
        <ActionButtons nodeId={id} />
      </div>
      {replyButtons.length > 0 ? (
        replyButtons.map((btn, i) => (
          <div key={`compat-${btn.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={btn.id}
              className={cardStyles.handle}
              style={{
                top: `${((i + 1) / (replyButtons.length + 1)) * 100}%`,
                ...compatibilityHandleStyle,
              }}
            />
          </div>
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="source-bottom"
          className={cardStyles.handle}
          style={compatibilityHandleStyle}
        />
      )}
      {replyButtons.length > 0 ? (
        replyButtons.map((btn, i) => (
          <div key={`right-${btn.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={`right-${btn.id}`}
              className={cardStyles.handle}
              style={{ top: `${((i + 1) / (replyButtons.length + 1)) * 100}%` }}
            />
            <span
              className="absolute text-[8px] bg-fuchsia-500 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none"
              style={{ right: -8, top: `${((i + 1) / (replyButtons.length + 1)) * 100}%`, transform: 'translate(100%, -50%)' }}
            >
              {btn.text}
            </span>
          </div>
        ))
      ) : (
        <Handle type="source" position={Position.Right} id="source-right" className={cardStyles.handle} />
      )}
    </div>
  )
})
CarouselNode.displayName = 'CarouselNode'

// List Node
export const ListNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => {
  const allRows = data.listSections?.flatMap(section => section.rows) || []

  return (
    <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
      <InputHandles />
      <div className={cn(cardStyles.header, gradients.interaction)}>
        <List className="w-4 h-4" />
        <div>
          <span>Lista</span>
          <div className={cardStyles.subtitle}>Menu Cloud API</div>
        </div>
      </div>
      <div className={cardStyles.body}>
        {data.content && <p className="mb-2 font-medium text-gray-700">{data.content}</p>}
        {data.listSections && data.listSections.length > 0 ? (
          <div className="space-y-2">
            {data.listSections.map((section, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-2">
                <span className="text-[10px] font-semibold text-gray-500 uppercase">{section.title}</span>
                <div className="mt-1 space-y-0.5">
                  {section.rows.slice(0, 2).map((row, j) => (
                    <div key={j} className="text-xs text-gray-600 pl-2 border-l-2 border-pink-300">
                      {row.title}
                    </div>
                  ))}
                  {section.rows.length > 2 && (
                    <div className="text-[10px] text-gray-400 pl-2">+{section.rows.length - 2} mais</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="italic text-gray-400">Configure a lista...</p>
        )}
      </div>
      <div className={cardStyles.footer}>
        <span className="text-[10px] text-gray-400">{allRows.length} itens</span>
        <ActionButtons nodeId={id} />
      </div>
      {allRows.length > 0 ? (
        allRows.map((row, i) => (
          <div key={`compat-${row.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={row.id}
              className={cardStyles.handle}
              style={{
                top: `${((i + 1) / (allRows.length + 1)) * 100}%`,
                ...compatibilityHandleStyle,
              }}
            />
          </div>
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="source-bottom"
          className={cardStyles.handle}
          style={compatibilityHandleStyle}
        />
      )}
      {/* Right-side handles */}
      {allRows.length > 0 ? (
        allRows.map((row, i) => (
          <div key={`right-${row.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={`right-${row.id}`}
              className={cardStyles.handle}
              style={{ top: `${((i + 1) / (allRows.length + 1)) * 100}%` }}
            />
            <span
              className="absolute text-[8px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none"
              style={{ right: -8, top: `${((i + 1) / (allRows.length + 1)) * 100}%`, transform: 'translate(100%, -50%)' }}
            >
              {row.title}
            </span>
          </div>
        ))
      ) : (
        <Handle type="source" position={Position.Right} id="source-right" className={cardStyles.handle} />
      )}
    </div>
  )
})
ListNode.displayName = 'ListNode'

// Condition Node - Switch/Case style with multiple values
export const ConditionNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => {
  const cases = data.condition?.cases || []
  const hasOldFormat = !cases.length && data.condition?.value !== undefined

  // Old format compatibility: show as yes/no
  if (hasOldFormat && data.condition) {
    return (
      <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
        <InputHandles />
        <div className={cn(cardStyles.header, gradients.logic)}>
          <GitBranch className="w-4 h-4" />
          <div>
            <span>Condição</span>
            <div className={cardStyles.subtitle}>Se / Senão</div>
          </div>
        </div>
        <div className={cardStyles.body}>
          <div className="bg-amber-50 rounded-lg p-2 font-mono text-xs">
            <span className="text-amber-600">SE</span>{' '}
            <span className="bg-amber-100 px-1 rounded">{data.condition.variable}</span>{' '}
            <span className="text-amber-600">{data.condition.operator}</span>{' '}
            {data.condition.value && <span className="bg-amber-100 px-1 rounded">{data.condition.value}</span>}
          </div>
        </div>
        <div className={cardStyles.footer}>
          <span className="text-[10px] text-gray-400">2 saídas</span>
          <ActionButtons nodeId={id} />
        </div>
        <Handle type="source" position={Position.Right} id="yes" className={cn(cardStyles.handle, '!bg-green-500')} style={{ top: '33%', ...compatibilityHandleStyle }} />
        <Handle type="source" position={Position.Right} id="no" className={cn(cardStyles.handle, '!bg-red-500')} style={{ top: '66%', ...compatibilityHandleStyle }} />
        <Handle type="source" position={Position.Right} id="right-yes" className={cn(cardStyles.handle, '!bg-green-500')} style={{ top: '33%' }} />
        <span className="absolute text-[8px] bg-green-500 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none" style={{ right: -8, top: '33%', transform: 'translate(100%, -50%)' }}>Sim</span>
        <Handle type="source" position={Position.Right} id="right-no" className={cn(cardStyles.handle, '!bg-red-500')} style={{ top: '66%' }} />
        <span className="absolute text-[8px] bg-red-500 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none" style={{ right: -8, top: '66%', transform: 'translate(100%, -50%)' }}>{`Não`}</span>
      </div>
    )
  }

  const operatorLabels: Record<string, string> = {
    equals: '=', contains: '∋', startsWith: '⊳', endsWith: '⊲', regex: '~', exists: '∃',
  }

  return (
    <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
      <InputHandles />
      <div className={cn(cardStyles.header, gradients.logic)}>
        <GitBranch className="w-4 h-4" />
        <div>
          <span>Condição</span>
          <div className={cardStyles.subtitle}>Switch / Caso</div>
        </div>
      </div>
      <div className={cardStyles.body}>
        {data.condition?.variable ? (
          <div className="space-y-1.5">
            <div className="bg-amber-50 rounded-lg px-2 py-1 font-mono text-xs">
              <span className="text-amber-600">SWITCH</span>{' '}
              <span className="bg-amber-100 px-1 rounded">{data.condition.variable}</span>{' '}
              <span className="text-amber-600">{operatorLabels[data.condition.operator] || data.condition.operator}</span>
            </div>
            {cases.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1.5 px-2 py-1 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg">
                <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">{i + 1}</span>
                <span className="text-xs text-gray-700 font-mono">{c.value || '""'}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded-lg">
              <span className="w-5 h-5 rounded-full bg-gray-400 text-white text-[10px] flex items-center justify-center font-bold">∅</span>
              <span className="text-xs text-gray-400 italic">fallback</span>
            </div>
          </div>
        ) : (
          <p className="italic text-gray-400">Configure a condição...</p>
        )}
      </div>
      <div className={cardStyles.footer}>
        <span className="text-[10px] text-gray-400">{cases.length} valores + fallback</span>
        <ActionButtons nodeId={id} />
      </div>
      {/* Hidden compatibility handles for older bottom-output edges */}
      {cases.length > 0 ? (
        <>
          {cases.map((c, i) => (
            <div key={`compat-${c.id}`}>
              <Handle type="source" position={Position.Right} id={c.id} className={cn(cardStyles.handle, '!bg-amber-500')} style={{ top: `${((i + 1) / (cases.length + 2)) * 100}%`, ...compatibilityHandleStyle }} />
            </div>
          ))}
          <div>
            <Handle type="source" position={Position.Right} id="fallback" className={cn(cardStyles.handle, '!bg-gray-400')} style={{ top: `${((cases.length + 1) / (cases.length + 2)) * 100}%`, ...compatibilityHandleStyle }} />
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} id="source-bottom" className={cardStyles.handle} style={compatibilityHandleStyle} />
      )}
      {/* Right handles per case + fallback */}
      {cases.length > 0 ? (
        <>
          {cases.map((c, i) => (
            <div key={`right-${c.id}`}>
              <Handle type="source" position={Position.Right} id={`right-${c.id}`} className={cn(cardStyles.handle, '!bg-amber-500')} style={{ top: `${((i + 1) / (cases.length + 2)) * 100}%` }} />
              <span className="absolute text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none" style={{ right: -8, top: `${((i + 1) / (cases.length + 2)) * 100}%`, transform: 'translate(100%, -50%)' }}>{c.value || '""'}</span>
            </div>
          ))}
          <div>
            <Handle type="source" position={Position.Right} id="right-fallback" className={cn(cardStyles.handle, '!bg-gray-400')} style={{ top: `${((cases.length + 1) / (cases.length + 2)) * 100}%` }} />
            <span className="absolute text-[8px] bg-gray-400 text-white px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap pointer-events-none" style={{ right: -8, top: `${((cases.length + 1) / (cases.length + 2)) * 100}%`, transform: 'translate(100%, -50%)' }}>outro</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} id="source-right" className={cardStyles.handle} />
      )}
    </div>
  )
})
ConditionNode.displayName = 'ConditionNode'

// Delay Node
export const DelayNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.logic)}>
      <Clock className="w-4 h-4" />
      <div>
        <span>Aguardar</span>
        <div className={cardStyles.subtitle}>Delay</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      <div className="text-center py-2">
        <span className="text-3xl font-bold text-amber-600">{data.delay || 1}</span>
        <span className="text-gray-500 ml-1">segundos</span>
      </div>
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Timer</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
DelayNode.displayName = 'DelayNode'

// Set Variable Node
export const SetVariableNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.data)}>
      <Database className="w-4 h-4" />
      <div>
        <span>Variável</span>
        <div className={cardStyles.subtitle}>Salvar dado</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {data.variable ? (
        <div className="bg-emerald-50 rounded-lg p-2 font-mono text-xs">
          <span className="text-emerald-600 bg-emerald-100 px-1 rounded">{data.variable}</span>
          <span className="text-gray-400 mx-1">=</span>
          <span className="text-gray-600">{data.value || '""'}</span>
        </div>
      ) : (
        <p className="italic text-gray-400">Configure a variável...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Dados</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
SetVariableNode.displayName = 'SetVariableNode'

// HTTP Request Node
export const HttpRequestNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => {
  const headersCount = data.httpConfig?.headers?.length || 0
  const mappingsCount = data.httpConfig?.responseMappings?.length || 0

  return (
    <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
      <InputHandles />
      <div className={cn(cardStyles.header, gradients.api)}>
        <Globe className="w-4 h-4" />
        <div>
          <span>Requisição HTTP</span>
          <div className={cardStyles.subtitle}>API Externa</div>
        </div>
      </div>
      <div className={cardStyles.body}>
        {data.httpConfig?.url ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-600 rounded text-[10px] font-bold">
                {data.httpConfig.method || 'GET'}
              </span>
              {headersCount > 0 && (
                <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">
                  {headersCount} header{headersCount > 1 ? 's' : ''}
                </span>
              )}
              {mappingsCount > 0 && (
                <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded text-[10px]">
                  {mappingsCount} var{mappingsCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="truncate font-mono text-xs bg-gray-50 px-2 py-1 rounded">{data.httpConfig.url}</p>
            {mappingsCount > 0 && (
              <div className="space-y-0.5">
                {data.httpConfig.responseMappings!.slice(0, 2).map((m, i) => (
                  <p key={i} className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded truncate">
                    {m.path} → <span className="font-semibold">{m.variable}</span>
                  </p>
                ))}
                {mappingsCount > 2 && (
                  <p className="text-[10px] text-gray-400">+{mappingsCount - 2} mais</p>
                )}
              </div>
            )}
            {data.httpConfig.responseVariable && !mappingsCount && (
              <p className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                → {data.httpConfig.responseVariable}
              </p>
            )}
          </div>
        ) : (
          <p className="italic text-gray-400">Configure a requisição...</p>
        )}
      </div>
      <div className={cardStyles.footer}>
        <span className="text-[10px] text-gray-400">API</span>
        <ActionButtons nodeId={id} />
      </div>
      <OutputHandles />
    </div>
  )
})
HttpRequestNode.displayName = 'HttpRequestNode'

// Transfer Node
export const TransferNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.transfer)}>
      <Users className="w-4 h-4" />
      <div>
        <span>Transferir</span>
        <div className={cardStyles.subtitle}>Atendimento Humano</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
        <PhoneForwarded className="w-5 h-5 text-gray-400" />
        <span className="text-gray-600">{data.content || 'Transferir para atendente'}</span>
      </div>
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Humano</span>
      <ActionButtons nodeId={id} />
    </div>
  </div>
))
TransferNode.displayName = 'TransferNode'

// Go To Flow Node
export const GoToFlowNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.api)}>
      <ArrowRight className="w-4 h-4" />
      <div>
        <span>Ir para Fluxo</span>
        <div className={cardStyles.subtitle}>Outro fluxo</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      <p className="italic text-gray-400">Selecione um fluxo...</p>
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Redirect</span>
      <ActionButtons nodeId={id} />
    </div>
  </div>
))
GoToFlowNode.displayName = 'GoToFlowNode'

// End Node
export const EndNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.end)}>
      <XCircle className="w-4 h-4" />
      <div>
        <span>Encerrar</span>
        <div className={cardStyles.subtitle}>Fim do fluxo</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {data.content ? (
        <p className="text-gray-600">{data.content}</p>
      ) : (
        <div className="flex items-center justify-center gap-2 text-gray-400 py-2">
          <StopCircle className="w-5 h-5" />
          <span>Conversa finalizada</span>
        </div>
      )}
      {(data.auditEnabled || data.auditWebhookEnabled) && (
        <div className="flex flex-col gap-1 mt-2">
          {data.auditEnabled && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded text-blue-600 text-[11px]">
              <Send className="w-3 h-3" />
              <span>WhatsApp audit</span>
            </div>
          )}
          {data.auditWebhookEnabled && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-50 rounded text-purple-600 text-[11px]">
              <Globe className="w-3 h-3" />
              <span>Webhook audit</span>
            </div>
          )}
        </div>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Final</span>
      <ActionButtons nodeId={id} />
    </div>
  </div>
))
EndNode.displayName = 'EndNode'

// ─── IA Nodes ────────────────────────────────────────────────

// LLM Node
export const LLMNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.ai)}>
      <Brain className="w-4 h-4" />
      <div>
        <span>LLM (IA)</span>
        <div className={cardStyles.subtitle}>{(data as any).model || 'Gerar texto'}</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).prompt ? (
        <p className="line-clamp-3">{(data as any).prompt}</p>
      ) : (
        <p className="italic text-gray-400">Clique para configurar o prompt...</p>
      )}
      {(data as any).outputVariable && (
        <div className="mt-2 flex items-center gap-1.5 px-2 py-1 bg-violet-50 rounded-lg">
          <Variable className="w-3 h-3 text-violet-500" />
          <span className="text-[10px] text-violet-600 font-mono">{`{{${(data as any).outputVariable}}}`}</span>
        </div>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400 flex items-center gap-1">
        <Brain className="w-3 h-3" /> IA
      </span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
LLMNode.displayName = 'LLMNode'

// AI Agent Node
export const AIAgentNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.aiAgent)}>
      <Bot className="w-4 h-4" />
      <div>
        <span>Agente IA</span>
        <div className={cardStyles.subtitle}>{(data as any).agentName || 'Delegar tarefa'}</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).agentId ? (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-50 rounded-lg">
          <Bot className="w-3 h-3 text-purple-500" />
          <span className="text-xs text-purple-600">{(data as any).agentName || 'Agente selecionado'}</span>
        </div>
      ) : (
        <p className="italic text-gray-400">Selecione um agente...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Agente</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
AIAgentNode.displayName = 'AIAgentNode'

// Knowledge Retrieval Node
export const KnowledgeRetrievalNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.knowledge)}>
      <BookOpen className="w-4 h-4" />
      <div>
        <span>Base de Conhecimento</span>
        <div className={cardStyles.subtitle}>Busca RAG</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).query ? (
        <p className="line-clamp-2">{(data as any).query}</p>
      ) : (
        <p className="italic text-gray-400">Clique para configurar a busca...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">RAG</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
KnowledgeRetrievalNode.displayName = 'KnowledgeRetrievalNode'

// Code Node
export const CodeNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.code)}>
      <Code className="w-4 h-4" />
      <div>
        <span>Código</span>
        <div className={cardStyles.subtitle}>JavaScript</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).code ? (
        <pre className="text-[10px] font-mono bg-gray-50 dark:bg-zinc-800 p-2 rounded line-clamp-3 overflow-hidden">{(data as any).code}</pre>
      ) : (
        <p className="italic text-gray-400">Clique para escrever código...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">JS</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
CodeNode.displayName = 'CodeNode'

// Iteration Node
export const IterationNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, 'bg-gradient-to-r from-fuchsia-500 to-purple-600')}>
      <Repeat className="w-4 h-4" />
      <div>
        <span>Iteração</span>
        <div className={cardStyles.subtitle}>Loop com agente IA</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).inputVariable ? (
        <p className="text-xs"><strong>Lista:</strong> {`{{${(data as any).inputVariable}}}`}</p>
      ) : (
        <p className="italic text-gray-400">Configurar iteração...</p>
      )}
      {(data as any).itemTemplate && <p className="text-xs mt-1 line-clamp-2 text-muted-foreground">{(data as any).itemTemplate}</p>}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">IA</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
IterationNode.displayName = 'IterationNode'

// Human Input Node
export const HumanInputNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, 'bg-gradient-to-r from-amber-500 to-yellow-500')}>
      <Inbox className="w-4 h-4" />
      <div>
        <span>Input Humano</span>
        <div className={cardStyles.subtitle}>Aguarda operador</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).message ? (
        <p className="line-clamp-2 text-xs">{(data as any).message}</p>
      ) : (
        <p className="italic text-gray-400">Configurar mensagem...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Humano</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
HumanInputNode.displayName = 'HumanInputNode'

// Approval Node
export const ApprovalNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, 'bg-gradient-to-r from-orange-500 to-amber-500')}>
      <CheckCircle className="w-4 h-4" />
      <div>
        <span>Aprovação</span>
        <div className={cardStyles.subtitle}>Aprovação/Rejeição</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).message ? (
        <p className="line-clamp-2 text-xs">{(data as any).message}</p>
      ) : (
        <p className="italic text-gray-400">Configurar aprovação...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Humano</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
ApprovalNode.displayName = 'ApprovalNode'

// Template Node
export const TemplateNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.template)}>
      <FileText className="w-4 h-4" />
      <div>
        <span>Template</span>
        <div className={cardStyles.subtitle}>Texto com variáveis</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).template ? (
        <p className="line-clamp-3 font-mono text-[11px]">{(data as any).template}</p>
      ) : (
        <p className="italic text-gray-400">Clique para configurar o template...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Template</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
TemplateNode.displayName = 'TemplateNode'

// ─── CRM Nodes ───────────────────────────────────────────────

// Send Message Node (CRM — diferente do MESSAGE de chatbot)
export const SendMessageNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.crm)}>
      <MessageSquare className="w-4 h-4" />
      <div>
        <span>Enviar Mensagem</span>
        <div className={cardStyles.subtitle}>WhatsApp via instância</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).message ? (
        <p className="line-clamp-2">{(data as any).message}</p>
      ) : (
        <p className="italic text-gray-400">Configurar mensagem...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">CRM</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
SendMessageNode.displayName = 'SendMessageNode'

// Update Contact Node
export const UpdateContactNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.crm)}>
      <UserCheck className="w-4 h-4" />
      <div>
        <span>Atualizar Contato</span>
        <div className={cardStyles.subtitle}>Dados do contato</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      <p className="italic text-gray-400">Configurar campos...</p>
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">CRM</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
UpdateContactNode.displayName = 'UpdateContactNode'

// Assign Conversation Node
export const AssignConversationNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.crm)}>
      <UserPlus className="w-4 h-4" />
      <div>
        <span>Atribuir Conversa</span>
        <div className={cardStyles.subtitle}>Atendente ou equipe</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      <p className="italic text-gray-400">Selecionar atendente...</p>
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">CRM</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
AssignConversationNode.displayName = 'AssignConversationNode'

// Add Tag Node
export const AddTagNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, 'bg-gradient-to-r from-lime-500 to-green-600')}>
      <Tag className="w-4 h-4" />
      <div>
        <span>Adicionar Tag</span>
        <div className={cardStyles.subtitle}>Label na conversa</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).tagName ? (
        <div className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 rounded-full">
          <Tag className="w-3 h-3 text-green-500" />
          <span className="text-xs text-green-700">{(data as any).tagName}</span>
        </div>
      ) : (
        <p className="italic text-gray-400">Selecionar tag...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">CRM</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
AddTagNode.displayName = 'AddTagNode'

// Move Card Node
export const MoveCardNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, 'bg-gradient-to-r from-cyan-500 to-teal-600')}>
      <ArrowRightLeft className="w-4 h-4" />
      <div>
        <span>Mover Card</span>
        <div className={cardStyles.subtitle}>Pipeline Kanban</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      <p className="italic text-gray-400">Selecionar coluna...</p>
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">CRM</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
MoveCardNode.displayName = 'MoveCardNode'

// Create Task Node
export const CreateTaskNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, 'bg-gradient-to-r from-sky-500 to-cyan-600')}>
      <ListTodo className="w-4 h-4" />
      <div>
        <span>Criar Tarefa</span>
        <div className={cardStyles.subtitle}>Nova tarefa</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).title ? (
        <p className="text-xs">{(data as any).title}</p>
      ) : (
        <p className="italic text-gray-400">Configurar tarefa...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">CRM</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
CreateTaskNode.displayName = 'CreateTaskNode'

// Send Notification Node
export const SendNotificationNode = memo(({ id, data, selected }: FlowBuilderNodeProps) => (
  <div className={cn(cardStyles.base, selected && cardStyles.selected)}>
    <InputHandles />
    <div className={cn(cardStyles.header, gradients.notification)}>
      <Bell className="w-4 h-4" />
      <div>
        <span>Notificação</span>
        <div className={cardStyles.subtitle}>Alerta interno</div>
      </div>
    </div>
    <div className={cardStyles.body}>
      {(data as any).message ? (
        <p className="line-clamp-2">{(data as any).message}</p>
      ) : (
        <p className="italic text-gray-400">Configurar notificação...</p>
      )}
    </div>
    <div className={cardStyles.footer}>
      <span className="text-[10px] text-gray-400">Alerta</span>
      <ActionButtons nodeId={id} />
    </div>
    <OutputHandles />
  </div>
))
SendNotificationNode.displayName = 'SendNotificationNode'

// Export node types mapping
export const nodeTypes = {
  START: StartNode,
  MESSAGE: MessageNode,
  IMAGE: ImageNode,
  AUDIO: AudioNode,
  VIDEO: VideoNode,
  DOCUMENT: DocumentNode,
  MENU: MenuNode,
  BUTTONS: ButtonsNode,
  CAROUSEL: CarouselNode,
  LIST: ListNode,
  CONDITION: ConditionNode,
  DELAY: DelayNode,
  SET_VARIABLE: SetVariableNode,
  HTTP_REQUEST: HttpRequestNode,
  TRANSFER: TransferNode,
  GO_TO_FLOW: GoToFlowNode,
  END: EndNode,
  // IA
  LLM: LLMNode,
  AI_AGENT: AIAgentNode,
  KNOWLEDGE_RETRIEVAL: KnowledgeRetrievalNode,
  CODE: CodeNode,
  ITERATION: IterationNode,
  HUMAN_INPUT: HumanInputNode,
  APPROVAL: ApprovalNode,
  TEMPLATE: TemplateNode,
  // CRM
  SEND_MESSAGE: SendMessageNode,
  UPDATE_CONTACT: UpdateContactNode,
  ASSIGN_CONVERSATION: AssignConversationNode,
  ADD_TAG: AddTagNode,
  MOVE_CARD: MoveCardNode,
  CREATE_TASK: CreateTaskNode,
  SEND_NOTIFICATION: SendNotificationNode,
}
