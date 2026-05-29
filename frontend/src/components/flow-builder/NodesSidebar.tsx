import { useState } from 'react'
import {
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
  Menu,
  GripVertical,
  Brain,
  Bot,
  BookOpen,
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
  Settings,
} from 'lucide-react'
import { BuilderSettingsPanel } from '@/components/flow-builder/BuilderSettingsPanel'
import type { BuilderSettings } from '@/lib/builderSettings'
import { cn } from '@/lib/utils'

interface NodeItem {
  type: string
  label: string
  icon: any
  gradient: string
  description: string
}

type NodesSidebarView = 'nodes' | 'builder'

type NodesSidebarProps = {
  builderSettings?: BuilderSettings
  isBuilderSettingsSaving?: boolean
  onBuilderSettingsPreview?: (settings: BuilderSettings) => void
  onBuilderSettingsSave?: (settings: BuilderSettings) => void
  onBuilderSettingsCancel?: () => void
}

const nodeCategories = [
  {
    name: 'Mensagens',
    color: 'text-pink-600',
    nodes: [
      { type: 'MESSAGE', label: 'Mensagem', icon: MessageSquare, gradient: 'from-pink-500 to-purple-500', description: 'Enviar texto' },
      { type: 'IMAGE', label: 'Imagem', icon: Image, gradient: 'from-purple-500 to-pink-500', description: 'Enviar imagem' },
      { type: 'AUDIO', label: 'Audio', icon: Mic, gradient: 'from-pink-400 to-rose-500', description: 'Enviar audio' },
      { type: 'VIDEO', label: 'Video', icon: Video, gradient: 'from-rose-500 to-pink-500', description: 'Enviar video' },
      { type: 'DOCUMENT', label: 'Documento', icon: FileText, gradient: 'from-purple-400 to-pink-400', description: 'Enviar arquivo' },
    ],
  },
  {
    name: 'Interacao',
    color: 'text-cyan-600',
    nodes: [
      { type: 'MENU', label: 'Menu', icon: Menu, gradient: 'from-cyan-500 to-teal-500', description: 'Menu numerado' },
      { type: 'BUTTONS', label: 'Botoes', icon: MousePointer, gradient: 'from-indigo-500 to-purple-500', description: 'Botoes clicaveis' },
      { type: 'CAROUSEL', label: 'Carrossel', icon: LayoutGrid, gradient: 'from-fuchsia-500 to-rose-500', description: 'Cards interativos' },
      { type: 'LIST', label: 'Lista', icon: List, gradient: 'from-teal-500 to-cyan-500', description: 'Lista Cloud API' },
    ],
  },
  {
    name: 'Logica',
    color: 'text-emerald-600',
    nodes: [
      { type: 'CONDITION', label: 'Condicao', icon: GitBranch, gradient: 'from-emerald-500 to-green-500', description: 'Se/Senao' },
      { type: 'DELAY', label: 'Aguardar', icon: Clock, gradient: 'from-gray-500 to-slate-500', description: 'Pausar execucao' },
      { type: 'SET_VARIABLE', label: 'Variavel', icon: Variable, gradient: 'from-green-500 to-emerald-500', description: 'Definir valor' },
    ],
  },
  {
    name: 'Avancado',
    color: 'text-blue-600',
    nodes: [
      { type: 'HTTP_REQUEST', label: 'HTTP', icon: Globe, gradient: 'from-blue-500 to-indigo-500', description: 'Requisicao API' },
      { type: 'CODE', label: 'Código', icon: Code, gradient: 'from-sky-500 to-blue-500', description: 'JavaScript custom' },
      { type: 'TEMPLATE', label: 'Template', icon: FileText, gradient: 'from-teal-500 to-cyan-500', description: 'Texto com variáveis' },
      { type: 'TRANSFER', label: 'Transferir', icon: PhoneForwarded, gradient: 'from-slate-500 to-gray-500', description: 'Para atendente' },
      { type: 'GO_TO_FLOW', label: 'Ir para', icon: ArrowRight, gradient: 'from-violet-500 to-purple-500', description: 'Outro fluxo' },
      { type: 'END', label: 'Fim', icon: StopCircle, gradient: 'from-red-500 to-rose-500', description: 'Encerrar' },
    ],
  },
  {
    name: 'Inteligência Artificial',
    color: 'text-violet-600',
    nodes: [
      { type: 'LLM', label: 'LLM (IA)', icon: Brain, gradient: 'from-violet-500 to-purple-600', description: 'Gerar texto com IA' },
      { type: 'AI_AGENT', label: 'Agente IA', icon: Bot, gradient: 'from-purple-500 to-fuchsia-500', description: 'Delegar a um agente' },
      { type: 'KNOWLEDGE_RETRIEVAL', label: 'Base Conhec.', icon: BookOpen, gradient: 'from-indigo-500 to-violet-500', description: 'Busca RAG' },
      { type: 'ITERATION', label: 'Iteração', icon: Repeat, gradient: 'from-fuchsia-500 to-purple-500', description: 'Loop sobre lista com agente' },
    ],
  },
  {
    name: 'Interação Humana',
    color: 'text-amber-600',
    nodes: [
      { type: 'HUMAN_INPUT', label: 'Input Humano', icon: Inbox, gradient: 'from-amber-500 to-yellow-500', description: 'Aguarda resposta do operador' },
      { type: 'APPROVAL', label: 'Aprovação', icon: CheckCircle, gradient: 'from-orange-500 to-amber-500', description: 'Aprovação/Rejeição pelo time' },
    ],
  },
  {
    name: 'Ações CRM',
    color: 'text-teal-600',
    nodes: [
      { type: 'SEND_MESSAGE', label: 'Enviar Msg', icon: MessageSquare, gradient: 'from-emerald-500 to-teal-500', description: 'WhatsApp via instância' },
      { type: 'UPDATE_CONTACT', label: 'Att. Contato', icon: UserCheck, gradient: 'from-teal-500 to-green-500', description: 'Atualizar contato' },
      { type: 'ASSIGN_CONVERSATION', label: 'Atribuir', icon: UserPlus, gradient: 'from-green-500 to-teal-500', description: 'Atribuir conversa' },
      { type: 'ADD_TAG', label: 'Add Tag', icon: Tag, gradient: 'from-lime-500 to-green-500', description: 'Adicionar label' },
      { type: 'MOVE_CARD', label: 'Mover Card', icon: ArrowRightLeft, gradient: 'from-cyan-500 to-teal-500', description: 'Mover no pipeline' },
      { type: 'CREATE_TASK', label: 'Criar Tarefa', icon: ListTodo, gradient: 'from-sky-500 to-cyan-500', description: 'Nova tarefa' },
      { type: 'SEND_NOTIFICATION', label: 'Notificação', icon: Bell, gradient: 'from-fuchsia-500 to-pink-500', description: 'Notificar equipe' },
    ],
  },
]

export function NodesSidebar({
  builderSettings,
  isBuilderSettingsSaving = false,
  onBuilderSettingsPreview,
  onBuilderSettingsSave,
  onBuilderSettingsCancel,
}: NodesSidebarProps) {
  const [view, setView] = useState<NodesSidebarView>('nodes')
  const canConfigureBuilder = Boolean(builderSettings && onBuilderSettingsSave)

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const showNodes = () => {
    if (view === 'builder') {
      onBuilderSettingsCancel?.()
    }
    setView('nodes')
  }

  const showBuilderSettings = () => {
    if (!canConfigureBuilder) return
    setView('builder')
  }

  const cancelBuilderSettings = () => {
    onBuilderSettingsCancel?.()
    setView('nodes')
  }

  return (
    <div className="w-72 bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 overflow-y-auto shadow-lg">
      {/* Header */}
      <div className="sticky top-0 bg-white dark:bg-zinc-950 z-10 border-b border-gray-100 dark:border-zinc-800">
        <div className="px-4 py-3 space-y-3">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
            {view === 'builder' ? 'Aparência' : 'Componentes'}
          </h3>
          {canConfigureBuilder ? (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-zinc-900">
              <button
                type="button"
                aria-pressed={view === 'nodes'}
                onClick={showNodes}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
                  view === 'nodes'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-zinc-800 dark:text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Nós
              </button>
              <button
                type="button"
                aria-pressed={view === 'builder'}
                onClick={showBuilderSettings}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
                  view === 'builder'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-zinc-800 dark:text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                )}
              >
                <Settings className="h-3.5 w-3.5" />
                Aparência
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {view === 'builder' && builderSettings && onBuilderSettingsSave ? (
        <div className="p-3">
          <BuilderSettingsPanel
            settings={builderSettings}
            isSaving={isBuilderSettingsSaving}
            layout="sidebar"
            onChange={onBuilderSettingsPreview}
            onCancel={cancelBuilderSettings}
            onSave={onBuilderSettingsSave}
          />
        </div>
      ) : (
        <>
          <div className="p-3 space-y-4">
            {nodeCategories.map((category) => (
              <div key={category.name}>
                {/* Category Header */}
                <div className="flex items-center gap-2 mb-2 px-1">
                  <div className={cn('h-1.5 w-1.5 rounded-full',
                    category.name === 'Mensagens' ? 'bg-pink-500' :
                    category.name === 'Interacao' ? 'bg-cyan-500' :
                    category.name === 'Logica' ? 'bg-emerald-500' :
                    category.name === 'Inteligência Artificial' ? 'bg-violet-500' :
                    category.name === 'Ações CRM' ? 'bg-teal-500' : 'bg-blue-500'
                  )} />
                  <h4 className={cn(
                    'text-xs font-semibold uppercase tracking-wider',
                    category.color
                  )}>
                    {category.name}
                  </h4>
                </div>

                {/* Nodes Grid */}
                <div className="grid grid-cols-2 gap-2">
                  {category.nodes.map((node) => {
                    const Icon = node.icon
                    return (
                      <div
                        key={node.type}
                        draggable
                        onDragStart={(e) => onDragStart(e, node.type)}
                        className={cn(
                          'group relative flex flex-col items-center gap-1.5 p-3 rounded-xl',
                          'bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800',
                          'cursor-grab active:cursor-grabbing',
                          'hover:shadow-lg hover:border-purple-300 dark:hover:border-purple-700',
                          'hover:scale-105 active:scale-95',
                          'transition-all duration-200 ease-out'
                        )}
                      >
                        {/* Drag Indicator */}
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-50 transition-opacity">
                          <GripVertical className="h-3 w-3 text-gray-400" />
                        </div>

                        {/* Icon with gradient background */}
                        <div className={cn(
                          'p-2 rounded-lg bg-gradient-to-br shadow-sm',
                          node.gradient
                        )}>
                          <Icon className="h-4 w-4 text-white" />
                        </div>

                        {/* Label */}
                        <div className="text-center">
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                            {node.label}
                          </p>
                        </div>

                        {/* Hover tooltip */}
                        <div className={cn(
                          'absolute -bottom-8 left-1/2 -translate-x-1/2 z-50',
                          'px-2 py-1 rounded bg-gray-900 text-white text-xs whitespace-nowrap',
                          'opacity-0 group-hover:opacity-100 pointer-events-none',
                          'transition-opacity duration-200'
                        )}>
                          {node.description}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer with tips */}
          <div className="sticky bottom-0 bg-gradient-to-t from-white via-white dark:from-zinc-950 dark:via-zinc-950 to-transparent pt-6 pb-3 px-3">
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 border border-purple-200 dark:border-purple-800">
              <p className="text-xs text-purple-700 dark:text-purple-300">
                <span className="font-semibold">Dica:</span> Use Ctrl+S para salvar rapidamente
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
