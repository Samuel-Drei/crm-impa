export interface User {
  id: string
  name: string
  email: string
  role: string // Role slug: 'admin' | 'manager' | 'agent' | custom
  roleId?: string
  roleName?: string
  isSuperAdmin?: boolean
  companyId: string
  permissions?: string[]
  conversationScope?: string
  defaultScope?: string
  teamIds?: string[]
}

export interface Company {
  id: string
  name: string
  plan: string
}

export interface Instance {
  id: string
  name: string
  description?: string
  channel: 'BAILEYS' | 'WHATSMEOW' | 'CLOUD_API' | 'COEXISTENCE' | 'EVO_GO'
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'BANNED'
  phoneNumber?: string
  profileName?: string
  profilePicture?: string
  messagesSent: number
  messagesReceived: number
  apiToken: string
  // Cloud API specific fields
  wabaId?: string
  phoneNumberId?: string
  accessToken?: string
  appId?: string          // Meta App ID for upload/templates
  webhookSecret?: string
  // Evo Go specific fields
  evoApiUrl?: string
  evoInstanceId?: string
  evoApiKey?: string
  // Webhook configuration
  webhookUrl?: string
  webhookEvents?: string[]
  // Behavior settings
  rejectCalls?: boolean
  ignoreGroups?: boolean
  ignoreBroadcasts?: boolean
  ignoreStatus?: boolean
  alwaysOnline?: boolean
  readMessages?: boolean
  createdAt: string
}

export interface Contact {
  id: string
  name: string
  phoneNumber: string
  email?: string
  tags: string[]
  metadata?: Record<string, unknown>
  isActive: boolean
  whatsappStatus?: string
  verifiedName?: string
  whatsappSyncedAt?: string
  createdAt: string
  updatedAt?: string
}

export interface CustomAttributeDefinition {
  id: string
  attributeKey: string
  attributeDisplayName: string
  attributeDisplayType: 'TEXT' | 'NUMBER' | 'LINK' | 'DATE' | 'LIST' | 'CHECKBOX'
  attributeModel: 'CONTACT' | 'CONVERSATION'
  attributeValues?: string[]
  description?: string
}

export interface Message {
  id: string
  instanceId: string
  remoteJid: string
  messageId: string
  direction: 'INBOUND' | 'OUTBOUND'
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  type: string
  content: string
  mediaUrl?: string
  metadata?: Record<string, any>
  sentByUserId?: string
  sentByAIAgentId?: string
  sentByUser?: { id: string; name: string } | null
  sentByAIAgent?: { id: string; name: string } | null
  sentAt?: string
  deliveredAt?: string
  readAt?: string
  failedAt?: string
  failReason?: string
  createdAt: string
}

export interface Template {
  id: string
  name: string
  language: string
  category: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  headerType?: string
  headerContent?: string
  bodyText: string
  footerText?: string
  buttons?: TemplateButton[]
  createdAt: string
}

export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
  text: string
  url?: string
  phoneNumber?: string
}

export interface Campaign {
  id: string
  name: string
  description?: string
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  messageType: string
  messageContent: string
  delay: number
  totalContacts: number
  sentCount: number
  deliveredCount: number
  failedCount: number
  scheduledAt?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}

export interface TypebotIntegration {
  id: string
  instanceId: string
  typebotId: string
  typebotUrl: string
  triggerType: 'all' | 'keyword' | 'new_conversation'
  triggerValue?: string
  variables?: Record<string, string>
  isActive: boolean
}

export interface N8nIntegration {
  id: string
  instanceId: string
  webhookUrl: string
  events: string[]
  isActive: boolean
}

export interface DashboardStats {
  instances: {
    total: number
    online: number
    offline: number
  }
  messages: {
    total: number
    today: number
  }
  contacts: number
  campaigns: number
  conversations?: {
    open: number
    pending: number
  }
}

export interface AuthResponse {
  user: User
  company: Company
  token: string
}

// FlowBuilder Types
export type FlowStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'
export type FlowTriggerType = 'KEYWORD' | 'ALL' | 'BUTTON_REPLY' | 'LIST_REPLY' | 'WEBHOOK'
export type FlowNodeType =
  | 'START'
  | 'MESSAGE'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'MENU'
  | 'BUTTONS'
  | 'CAROUSEL'
  | 'LIST'
  | 'CONDITION'
  | 'DELAY'
  | 'SET_VARIABLE'
  | 'HTTP_REQUEST'
  | 'TRANSFER'
  | 'GO_TO_FLOW'
  | 'END'
  // IA
  | 'LLM'
  | 'AI_AGENT'
  | 'KNOWLEDGE_RETRIEVAL'
  | 'CODE'
  | 'TEMPLATE'
  // CRM
  | 'SEND_MESSAGE'
  | 'UPDATE_CONTACT'
  | 'ASSIGN_CONVERSATION'
  | 'ADD_TAG'
  | 'MOVE_CARD'
  | 'CREATE_TASK'
  | 'SEND_NOTIFICATION'
  // Human interaction
  | 'ITERATION'
  | 'HUMAN_INPUT'
  | 'APPROVAL'

export interface Flow {
  id: string
  name: string
  description?: string
  status: FlowStatus
  triggerType: FlowTriggerType
  triggerValue?: string
  instanceId?: string
  version: number
  variables?: Record<string, any>
  settings?: Record<string, any>
  nodesCount?: number
  activeSessions?: number
  createdAt: string
  updatedAt: string
}

export interface FlowNode {
  id: string
  flowId: string
  type: FlowNodeType
  positionX: number
  positionY: number
  data: FlowNodeData
  label?: string
}

export type FlowButtonType = 'reply' | 'copy' | 'url' | 'call' | 'pix'
export type FlowCarouselButtonType = 'reply' | 'copy' | 'url' | 'call'

export interface FlowButton {
  id: string
  text: string
  buttonType?: FlowButtonType
  url?: string
  copyCode?: string
  phoneNumber?: string
  currency?: string
  name?: string
  keyType?: 'random' | 'cpf' | 'cnpj' | 'email' | 'phone'
  key?: string
}

export interface FlowCarouselButton {
  id: string
  text: string
  buttonType?: FlowCarouselButtonType
  url?: string
  copyCode?: string
  phoneNumber?: string
}

export interface FlowCarouselCard {
  id: string
  header: {
    title?: string
    subtitle?: string
    imageUrl?: string
    videoUrl?: string
  }
  body: {
    text: string
  }
  footer?: string
  buttons?: FlowCarouselButton[]
}

export interface FlowNodeData extends Record<string, unknown> {
  label?: string
  header?: string
  content?: string
  footer?: string
  mediaUrl?: string
  mediaType?: string
  fileName?: string
  buttons?: FlowButton[]
  carouselCards?: FlowCarouselCard[]
  menuOptions?: Array<{ id: string; trigger: string; label: string }>
  listSections?: Array<{
    title: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>
  buttonText?: string
  waitForInput?: boolean
  inputVariable?: string
  delay?: number
  variable?: string
  value?: string
  condition?: {
    variable: string
    operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'regex' | 'exists'
    value?: string
    cases?: Array<{ id: string; value: string }>
  }
  httpConfig?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    url: string
    headers?: Array<{ key: string; value: string }>
    body?: string
    responseVariable?: string
    responseMappings?: Array<{ path: string; variable: string }>
  }
  targetFlowId?: string
  // END node audit
  auditEnabled?: boolean
  auditGroupJid?: string
  auditMessage?: string
  auditWebhookEnabled?: boolean
  auditWebhookMethod?: string
  auditWebhookUrl?: string
  auditWebhookHeaders?: string
  auditWebhookBody?: string
  // LLM / AI
  provider?: string
  model?: string
  prompt?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  outputVariable?: string
  // AI Agent
  agentId?: string
  agentName?: string
  // Knowledge Retrieval
  query?: string
  knowledgeBaseId?: string
  topK?: number
  // Code
  code?: string
  // Template
  template?: string
  // CRM: Send Message
  instanceId?: string
  to?: string
  message?: string
  // CRM: Update Contact
  contactFields?: Array<{ field: string; value: string }>
  // CRM: Assign Conversation
  assigneeId?: string
  teamId?: string
  // CRM: Add Tag
  tagName?: string
  tagId?: string
  // CRM: Move Card
  pipelineId?: string
  stageId?: string
  // CRM: Create Task
  taskTitle?: string
  taskDescription?: string
  taskAssigneeId?: string
  taskDueDate?: string
  // CRM: Send Notification
  notificationTitle?: string
  notificationMessage?: string
  notificationUserIds?: string[]
  // ITERATION node
  itemTemplate?: string
  maxItems?: number
  stopOnError?: boolean
  // HUMAN_INPUT / APPROVAL node
  timeoutHours?: number
  formSchema?: any
  actionDescription?: string
}

export interface FlowEdge {
  id: string
  flowId: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  condition?: any
}

export interface FlowWithDetails extends Flow {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

// Webhook Events Types
export interface WebhookVariable {
  id: string
  webhookEventId: string
  key: string
  value: string
  valueType: string
  createdAt: string
}

export interface WebhookEvent {
  id: string
  companyId: string
  rawPayload: any
  ipAddress: string
  userAgent?: string
  createdAt: string
  variables?: WebhookVariable[]
}

// Automation Types
export type AutomationStatus = 'ACTIVE' | 'INACTIVE'
export type AutomationLogStatus = 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED'

export interface Automation {
  id: string
  companyId: string
  instanceId: string
  name: string
  description?: string
  token: string
  status: AutomationStatus
  delayBetweenMessages: number
  metaTemplateName?: string
  metaTemplateLanguage?: string
  messageBody?: {
    text?: string
    [key: string]: any
  }
  variableMapping?: Record<string, string>
  phoneField: string
  // Roteamento Atlaz
  templateCode?: string  // $Template1, $Template2, $Template3, etc
  templateType?: 'FATURA_DIA' | 'DISPARO_LIVRE'  // Tipo para roteamento automático
  totalSent: number
  totalFailed: number
  lastTriggeredAt?: string
  createdAt: string
  updatedAt: string
  instance?: {
    id: string
    name: string
    channel: 'BAILEYS' | 'WHATSMEOW' | 'CLOUD_API' | 'COEXISTENCE' | 'EVO_GO'
    status: string
  }
  _count?: {
    logs: number
  }
}

export interface AutomationLog {
  id: string
  automationId: string
  phoneNumber: string
  messageContent?: string
  payload?: any
  status: AutomationLogStatus
  apiMessageId?: string
  errorMessage?: string
  processedAt?: string
  createdAt: string
}

export interface MetaTemplate {
  id: string
  name: string
  status: string
  category: string
  language: string
  components: any[]
}

// ── Conversation / CRM Types ──────────────────────────

export type ConversationStatus = 'OPEN' | 'RESOLVED' | 'PENDING' | 'SNOOZED'
export type ConversationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface Conversation {
  id: string
  companyId: string
  instanceId: string
  contactId?: string
  remoteJid: string
  status: ConversationStatus
  priority?: ConversationPriority
  assigneeId?: string
  teamId?: string
  customAttributes?: Record<string, any>
  cachedLabelList?: string
  snoozedUntil?: string
  lastActivityAt: string
  firstReplyAt?: string
  waitingSince?: string
  createdAt: string
  contact?: {
    id: string
    name: string
    phoneNumber: string
    profilePicture?: string
  }
  assignee?: {
    id: string
    name: string
    email: string
  }
  team?: {
    id: string
    name: string
  }
  conversationLabels?: ConversationLabel[]
  aiSessionStatus?: string
  aiAgentName?: string
  _count?: {
    messages: number
  }
}

export interface Team {
  id: string
  companyId: string
  name: string
  description?: string
  allowAutoAssign: boolean
  createdAt: string
  members?: TeamMember[]
  _count?: {
    conversations: number
  }
}

export interface TeamMember {
  id: string
  teamId: string
  userId: string
  user?: {
    id: string
    name: string
    email: string
  }
}

export interface Label {
  id: string
  companyId: string
  title: string
  description?: string
  color: string
  showOnSidebar: boolean
  createdAt: string
  _count?: {
    conversationLabels: number
  }
}

export interface ConversationLabel {
  id: string
  conversationId: string
  labelId: string
  label?: Label
}

export interface CustomAttributeDefinition {
  id: string
  companyId: string
  attributeKey: string
  attributeDisplayName: string
  attributeDisplayType: 'TEXT' | 'NUMBER' | 'LINK' | 'DATE' | 'LIST' | 'CHECKBOX'
  attributeModel: 'CONVERSATION' | 'CONTACT'
  attributeValues?: string[]
  regexPattern?: string
  regexCue?: string
  description?: string
}

export interface CannedResponse {
  id: string
  companyId: string
  shortCode: string
  content: string
  createdAt: string
}

export interface CustomFilter {
  id: string
  companyId: string
  userId: string
  name: string
  filterType: string
  query: FilterCondition[]
  createdAt: string
}

export interface FilterCondition {
  attribute: string
  operator: string
  values: (string | number | boolean)[]
  queryOperator?: 'AND' | 'OR'
}

export interface ConversationAutomation {
  id: string
  companyId: string
  name: string
  description?: string
  eventName: string
  conditions: any[]
  actions: any[]
  isActive: boolean
  createdAt: string
}

export type MacroVisibility = 'PERSONAL' | 'GLOBAL'

export interface Macro {
  id: string
  companyId: string
  name: string
  visibility: MacroVisibility
  actions: any[]
  createdBy?: {
    id: string
    name: string
  }
  createdAt: string
}

// ══════════════════════════════════════════
// Pipelines / Kanban
// ══════════════════════════════════════════
export type CardStatus = 'OPEN' | 'WON' | 'LOST' | 'ARCHIVED'
export type CardPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface Pipeline {
  id: string
  companyId: string
  name: string
  description?: string
  type: string
  isDefault: boolean
  isActive: boolean
  icon?: string
  color?: string
  stages: Stage[]
  _count?: { cards: number }
  createdAt: string
}

export interface Stage {
  id: string
  pipelineId: string
  companyId: string
  name: string
  slug: string
  color: string
  position: number
  isDefault: boolean
  isWon: boolean
  isLost: boolean
  _count?: { cards: number }
}

export interface Card {
  id: string
  pipelineId: string
  stageId: string
  companyId: string
  title: string
  description?: string
  value?: number
  currency: string
  status: CardStatus
  priority: CardPriority
  position: number
  source?: string
  expectedCloseDate?: string
  wonAt?: string
  lostAt?: string
  lostReason?: string
  customFields?: Record<string, any>
  createdBy?: string
  pipeline?: { id: string; name: string; type: string }
  stage?: { id: string; name: string; slug: string; color: string; isWon?: boolean; isLost?: boolean }
  contact?: { id: string; name: string; phoneNumber?: string; email?: string; profilePicture?: string }
  conversation?: { id: string; remoteJid?: string; status?: string }
  assignee?: { id: string; name: string; email?: string }
  team?: { id: string; name: string }
  tags?: CardTag[]
  tasks?: CardTask[]
  notes?: CardNote[]
  files?: CardFile[]
  _count?: { tasks: number; notes: number; files: number; activities: number }
  createdAt: string
  updatedAt: string
}

export interface CardTag {
  id: string
  cardId: string
  labelId: string
  label?: { id: string; title: string; color: string }
}

export interface CardTask {
  id: string
  cardId: string
  title: string
  description?: string
  isCompleted: boolean
  completedAt?: string
  assignee?: { id: string; name: string }
  dueDate?: string
  priority: CardPriority
  position: number
}

export interface CardNote {
  id: string
  cardId: string
  content: string
  isPrivate: boolean
  author?: { id: string; name: string }
  createdAt: string
}

export interface CardFile {
  id: string
  cardId: string
  fileName: string
  fileUrl: string
  fileSize: number
  mimeType?: string
  uploader?: { id: string; name: string }
  createdAt: string
}

export interface CardActivity {
  id: string
  cardId: string
  type: string
  content: string
  actorId?: string
  actorName?: string
  oldValue?: string
  newValue?: string
  metadata?: any
  createdAt: string
}

export interface PipelineMetrics {
  totalCards: number
  openCards: number
  wonCards: number
  lostCards: number
  conversionRate: number
  totalOpenValue: number
  totalWonValue: number
  stages: {
    id: string
    name: string
    slug: string
    color: string
    cardCount: number
    totalValue: number
  }[]
}

// ══════════════════════════════════════════
// Módulos CRM Nativos
// ══════════════════════════════════════════
export interface CustomFieldDef {
  target: 'card' | 'contact'
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'url' | 'currency' | 'textarea'
  options?: string[]
  required?: boolean
  group?: string
  placeholder?: string
}

export interface PipelineTemplate {
  name: string
  type: string
  description?: string
  stages: {
    name: string
    slug: string
    color: string
    position: number
    isWon?: boolean
    isLost?: boolean
  }[]
}

export interface CardAction {
  key: string
  label: string
  icon: string
  confirmText?: string
}

export interface StageValidation {
  stageSlug: string
  rules: {
    field: string
    operator: 'not_empty' | 'equals' | 'min' | 'max' | 'regex'
    value?: any
    message: string
  }[]
}

// ── Catálogo ──
export interface ItemCategory {
  id: string
  name: string
  slug: string
  description?: string
  parentId?: string
  parent?: ItemCategory
  children?: ItemCategory[]
  _count?: { items: number }
  createdAt: string
}

export interface CatalogItem {
  id: string
  name: string
  slug: string
  description?: string
  type: 'PRODUCT' | 'SERVICE'
  sku?: string
  unit?: string
  price: number
  taxRate?: number
  active: boolean
  categoryId?: string
  category?: ItemCategory
  variants?: ItemVariant[]
  images?: ItemImage[]
  priceTiers?: ItemPriceTier[]
  _count?: { proposalItems: number; invoiceItems: number }
  createdAt: string
}

export interface ItemVariant {
  id: string
  name: string
  sku?: string
  price: number
  active: boolean
}

export interface ItemImage {
  id: string
  url: string
  alt?: string
  sortOrder: number
}

export interface ItemPriceTier {
  id: string
  minQty: number
  price: number
}

export interface ItemBundle {
  id: string
  name: string
  slug: string
  description?: string
  discount: number
  active: boolean
  items: ItemBundleItem[]
  createdAt: string
}

export interface ItemBundleItem {
  id: string
  itemId: string
  item: CatalogItem
  quantity: number
}

// ── Propostas ──
export interface Proposal {
  id: string
  number: string
  subject: string
  status: 'DRAFT' | 'SENT' | 'OPEN' | 'REVISED' | 'DECLINED' | 'ACCEPTED' | 'EXPIRED'
  customerId?: string
  customer?: { id: string; name: string; email?: string }
  leadId?: string
  lead?: { id: string; name: string }
  openTill?: string
  currency: string
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
  notes?: string
  terms?: string
  publicHash: string
  items: ProposalItem[]
  comments?: ProposalComment[]
  activities?: ProposalActivity[]
  assignedTo?: { id: string; name: string }
  createdBy?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface ProposalItem {
  id: string
  catalogItemId?: string
  catalogItem?: CatalogItem
  description: string
  longDescription?: string
  quantity: number
  unit: string
  unitPrice: number
  discount: number
  taxRate: number
  sortOrder: number
  total: number
}

export interface ProposalComment {
  id: string
  content: string
  user: { id: string; name: string }
  createdAt: string
}

export interface ProposalActivity {
  id: string
  action: string
  description?: string
  user?: { id: string; name: string }
  createdAt: string
}

// ── Faturas ──
export interface Invoice {
  id: string
  number: string
  status: 'DRAFT' | 'SENT' | 'VIEWED' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  customerId: string
  customer?: { id: string; name: string; email?: string }
  proposalId?: string
  dueDate?: string
  currency: string
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
  amountPaid: number
  amountDue: number
  notes?: string
  terms?: string
  publicHash: string
  recurring: boolean
  recurringCycle?: string
  items: InvoiceItem[]
  payments?: Payment[]
  activities?: InvoiceActivity[]
  createdBy?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface InvoiceItem {
  id: string
  catalogItemId?: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discount: number
  taxRate: number
  sortOrder: number
  total: number
}

export interface InvoiceActivity {
  id: string
  action: string
  description?: string
  user?: { id: string; name: string }
  createdAt: string
}

// ── Pagamentos ──
export interface Payment {
  id: string
  invoiceId: string
  invoice?: Invoice
  amount: number
  method: 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'TRANSFER' | 'CASH' | 'OTHER'
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED' | 'CANCELLED'
  gatewayId?: string
  gatewayPaymentId?: string
  gatewayData?: any
  paidAt?: string
  notes?: string
  createdAt: string
}

export interface PaymentGatewayConfig {
  id: string
  provider: 'ASAAS' | 'STRIPE' | 'MERCADOPAGO' | 'MANUAL'
  name: string
  active: boolean
  isDefault: boolean
  credentials: Record<string, string>
  webhookSecret?: string
  createdAt: string
}

// ── Contratos ──
export interface Contract {
  id: string
  number: string
  subject: string
  status: 'DRAFT' | 'SENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'RENEWED'
  customerId: string
  customer?: { id: string; name: string; email?: string }
  type: string
  startDate: string
  endDate?: string
  value: number
  content?: string
  notes?: string
  publicHash: string
  signedAt?: string
  signedByName?: string
  signedByIp?: string
  autoRenew: boolean
  renewalDays: number
  renewals?: ContractRenewal[]
  activities?: ContractActivity[]
  createdBy?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface ContractRenewal {
  id: string
  oldEndDate: string
  newEndDate: string
  newValue?: number
  notes?: string
  renewedBy?: { id: string; name: string }
  createdAt: string
}

export interface ContractActivity {
  id: string
  action: string
  description?: string
  user?: { id: string; name: string }
  createdAt: string
}

// ── Projetos e Tarefas ──
export interface Project {
  id: string
  name: string
  description?: string
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
  contactId?: string
  contact?: { id: string; name: string; email?: string; phoneNumber?: string }
  contractId?: string
  contract?: { id: string; title: string; number?: string; prefix?: string }
  startDate?: string
  deadline?: string
  progress: number
  progressMode?: string
  billingType: 'FIXED' | 'HOURLY' | 'FREE'
  fixedCost?: number
  hourlyRate?: number
  members?: ProjectMember[]
  milestones?: Milestone[]
  tasks?: ProjectTask[]
  activities?: ProjectActivity[]
  discussions?: ProjectDiscussion[]
  notes?: ProjectNote[]
  timesheets?: ProjectTimesheet[]
  _count?: { tasks: number; milestones: number; invoices: number }
  createdAt: string
  updatedAt: string
}

export interface ProjectMember {
  id: string
  userId: string
  user?: { id: string; name: string }
  role?: string
}

export interface Milestone {
  id: string
  name: string
  description?: string
  dueDate?: string
  color?: string
  sortOrder: number
  _count?: { tasks: number }
}

export interface ProjectTask {
  id: string
  name: string
  description?: string
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'AWAITING_FEEDBACK' | 'COMPLETED' | 'CANCELLED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  projectId?: string
  project?: { id: string; name: string }
  milestoneId?: string | null
  milestone?: { id: string; name: string } | null
  startDate?: string
  dueDate?: string
  kanbanOrder?: number
  timeTracked: number
  billable: boolean
  isPublic: boolean
  assignees?: TaskAssignee[]
  checklist?: any
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface TaskAssignee {
  id: string
  userId: string
  user?: { id: string; name: string }
}

export interface ProjectActivity {
  id: string
  projectId: string
  type: string
  content?: string
  actorId: string
  actorType: string
  metadata?: any
  createdAt: string
}

export interface ProjectDiscussion {
  id: string
  projectId: string
  subject: string
  description?: string
  createdBy: string
  lastActivityAt: string
  comments?: ProjectDiscussionComment[]
  _count?: { comments: number }
  createdAt: string
}

export interface ProjectDiscussionComment {
  id: string
  discussionId: string
  parentId?: string
  content: string
  authorId: string
  authorName: string
  createdAt: string
}

export interface ProjectNote {
  id: string
  projectId: string
  title: string
  content?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ProjectTimesheet {
  id: string
  projectId: string
  taskId?: string
  userId: string
  startTime: string
  endTime?: string
  duration: number
  note?: string
  tags: string[]
  createdAt: string
}

export interface ProjectOverview {
  tasks: {
    total: number
    completed: number
    overdue: number
    byStatus: Record<string, number>
  }
  time: {
    totalTrackedMinutes: number
    totalTimesheetMinutes: number
  }
  financial: {
    invoiceCount: number
    invoiceTotal: number
    amountPaid: number
    expenseCount: number
    expenseTotal: number
  }
  timeline: {
    daysElapsed: number | null
    daysRemaining: number | null
    totalDays: number | null
    isOverdue: boolean
  }
}

// ── Despesas ──
export interface ExpenseCategory {
  id: string
  name: string
  description?: string
  _count?: { expenses: number }
  createdAt: string
}

export interface Expense {
  id: string
  categoryId: string
  category?: ExpenseCategory
  customerId?: string
  customer?: { id: string; name: string }
  projectId?: string
  project?: { id: string; name: string }
  amount: number
  taxRate: number
  taxAmount: number
  currency: string
  name: string
  note?: string
  date: string
  reference?: string
  billable: boolean
  invoiceId?: string
  receipt?: string
  recurring: boolean
  recurringCycle?: string
  createdBy?: { id: string; name: string }
  createdAt: string
}

export interface SidebarMenu {
  label: string
  icon: string
  path: string
  position: number
  section: 'modules'
}

export interface CardTabDef {
  key: string
  label: string
  icon: string
  position: number
}

export interface DashboardWidget {
  key: string
  label: string
  size: 'sm' | 'md' | 'lg'
  position: number
}

export interface ModuleDefinition {
  slug: string
  name: string
  description: string
  icon: string
  category: string
  config?: any
  activatedAt?: string
  customFields?: CustomFieldDef[]
  pipelineTemplates?: PipelineTemplate[]
  cardActions?: CardAction[]
  stageValidations?: StageValidation[]
  sidebarMenus?: SidebarMenu[]
  cardTabs?: CardTabDef[]
  dashboardWidgets?: DashboardWidget[]
}

export interface ModuleRegistryItem {
  slug: string
  name: string
  description: string
  icon: string
  category: string
  fieldsCount: number
  templatesCount: number
  tabsCount: number
  actionsCount: number
  activation?: {
    isActive: boolean
    config: any
    activatedAt: string
    activatedBy: string
  } | null
}
