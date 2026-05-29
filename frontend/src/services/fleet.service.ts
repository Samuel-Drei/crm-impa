import api from './api'

// ============================================
// Types
// ============================================

export type FleetMemberStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
export type FleetMissionStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'COMPLETED'
export type FleetMissionExecutionMode = 'AUTONOMOUS' | 'REQUIRE_APPROVAL'
export type FleetOperationStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | 'REJECTED'
export type FleetOperationTrigger = 'SCHEDULED' | 'MANUAL' | 'CHAT'
export type FleetMessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL'

export interface FleetDepartment {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  order: number
  createdAt: string
  updatedAt: string
  _count?: { members: number }
}

export interface FleetMember {
  id: string
  companyId: string
  name: string
  displayRole: string
  providerId: string
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  topP?: number | null
  toolsConfig?: any
  departmentId?: string | null
  avatarUrl?: string | null
  emoji?: string | null
  colorTag?: string | null
  status: FleetMemberStatus
  onboarded: boolean
  assignedRoleId?: string | null
  allowAutonomousActions: boolean
  notificationUserIds: string[]
  totalChats: number
  totalMissions: number
  totalOperations: number
  totalTokensUsed: number | string
  lastUsedAt?: string | null
  createdAt: string
  updatedAt: string
  provider?: { id: string; name: string; type: string; model: string; enabledModels?: string[] }
  department?: FleetDepartment | null
  role?: { id: string; name: string; slug?: string } | null
  missions?: FleetMission[]
}

export interface FleetMission {
  id: string
  companyId: string
  memberId: string
  title: string
  description?: string | null
  instruction: string
  cronExpr?: string | null
  cronNlOriginal?: string | null
  cronTimezone: string
  runOnceAt?: string | null
  nextRunAt?: string | null
  lastRunAt?: string | null
  executionMode: FleetMissionExecutionMode
  maxRuns?: number | null
  totalRuns: number
  successRuns: number
  failedRuns: number
  status: FleetMissionStatus
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  notifyUserIds: string[]
  createdBy?: string | null
  createdAt: string
  updatedAt: string
  member?: { id: string; name: string; displayRole: string; avatarUrl?: string | null; emoji?: string | null }
}

export interface FleetOperation {
  id: string
  companyId: string
  memberId: string
  missionId?: string | null
  chatId?: string | null
  trigger: FleetOperationTrigger
  status: FleetOperationStatus
  instruction: string
  output?: string | null
  error?: string | null
  toolsCalled?: any
  proposedActions?: any
  approvedBy?: string | null
  approvedAt?: string | null
  rejectedReason?: string | null
  tokensInput?: number | null
  tokensOutput?: number | null
  durationMs?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  createdAt: string
  member?: { id: string; name: string; displayRole: string; avatarUrl?: string | null; emoji?: string | null }
  mission?: { id: string; title: string }
}

export interface FleetChat {
  id: string
  companyId: string
  userId: string
  memberId: string
  title?: string | null
  pinned: boolean
  archivedAt?: string | null
  totalMessages: number
  totalTokens: number | string
  createdAt: string
  updatedAt: string
  member?: { id: string; name: string; displayRole: string; avatarUrl?: string | null; emoji?: string | null; colorTag?: string | null }
}

export interface FleetMessage {
  id: string
  chatId: string
  role: FleetMessageRole
  content: string
  toolName?: string | null
  toolInput?: any
  toolOutput?: any
  toolSuccess?: boolean | null
  tokensInput?: number | null
  tokensOutput?: number | null
  durationMs?: number | null
  createdAt: string
}

export interface CronPreviewResult {
  cronExpr: string
  description: string
  cronTimezone?: string
  nextRuns: string[]
}

export interface ChatSendResult {
  chatId: string
  userMessageId: string
  operationId: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  // Campos legados (mantidos opcionais para compat com código antigo)
  assistantMessageId?: string
  output?: string
  tokensUsed?: number
  durationMs?: number
  error?: string
}

export interface ChatRuntimeStatus {
  running: boolean
  awaitingApproval: boolean
  operationId: string | null
  status: FleetOperationStatus | null
  startedAt: string | null
  proposedActions: any | null
  approvalRiskLevel: string | null
  approvalRationale: string | null
  toolsExecuted: number
  latestToolName: string | null
  latestToolSuccess: boolean | null
  latestSummary: string | null
  recentTools: Array<{
    toolName: string
    toolSuccess: boolean
    durationMs: number
    summary: string
  }>
}

// ============================================
// Departments
// ============================================

export const fleetService = {
  // Departments
  listDepartments: () => api.get<FleetDepartment[]>('/fleet/departments').then(r => r.data),
  createDepartment: (data: Partial<FleetDepartment>) => api.post<FleetDepartment>('/fleet/departments', data).then(r => r.data),
  updateDepartment: (id: string, data: Partial<FleetDepartment>) => api.patch<FleetDepartment>(`/fleet/departments/${id}`, data).then(r => r.data),
  deleteDepartment: (id: string) => api.delete(`/fleet/departments/${id}`),

  // Members
  listMembers: (params?: { departmentId?: string; status?: FleetMemberStatus }) =>
    api.get<FleetMember[]>('/fleet/members', { params }).then(r => r.data),
  getMember: (id: string) => api.get<FleetMember>(`/fleet/members/${id}`).then(r => r.data),
  createMember: (data: {
    name: string
    displayRole: string
    providerId: string
    model: string
    systemPrompt?: string
    temperature?: number
    maxTokens?: number
    topP?: number
    toolsConfig?: any
    departmentId?: string | null
    avatarUrl?: string | null
    emoji?: string | null
    colorTag?: string | null
    assignedRoleId?: string | null
    allowAutonomousActions?: boolean
    notificationUserIds?: string[]
  }) => api.post<FleetMember>('/fleet/members', data).then(r => r.data),
  updateMember: (id: string, data: Partial<FleetMember>) =>
    api.patch<FleetMember>(`/fleet/members/${id}`, data).then(r => r.data),
  deleteMember: (id: string) => api.delete(`/fleet/members/${id}`),

  // Missions
  listMissions: (params?: { memberId?: string; status?: FleetMissionStatus }) =>
    api.get<FleetMission[]>('/fleet/missions', { params }).then(r => r.data),
  createMission: (data: {
    memberId: string
    title: string
    description?: string
    instruction: string
    cronExpr?: string
    cronNl?: string
    cronTimezone?: string
    runOnceAt?: string
    executionMode?: FleetMissionExecutionMode
    maxRuns?: number
    notifyOnSuccess?: boolean
    notifyOnFailure?: boolean
    notifyUserIds?: string[]
  }) => api.post<FleetMission>('/fleet/missions', data).then(r => r.data),
  updateMission: (id: string, data: Partial<FleetMission> & { cronNl?: string }) =>
    api.patch<FleetMission>(`/fleet/missions/${id}`, data).then(r => r.data),
  deleteMission: (id: string) => api.delete(`/fleet/missions/${id}`),
  runMission: (id: string) => api.post<{ operationId: string }>(`/fleet/missions/${id}/run`).then(r => r.data),

  // Operations
  listOperations: (params?: { memberId?: string; missionId?: string; status?: FleetOperationStatus; limit?: number }) =>
    api.get<FleetOperation[]>('/fleet/operations', { params }).then(r => r.data),
  approveOperation: (id: string, data?: { instruction?: string }) =>
    api.post<{ operationId: string; status: 'RUNNING' }>(`/fleet/operations/${id}/approve`, data || {}).then(r => r.data),
  rejectOperation: (id: string, data?: { reason?: string }) =>
    api.post<{ operationId: string; status: 'REJECTED' }>(`/fleet/operations/${id}/reject`, data || {}).then(r => r.data),

  // Chats
  listChats: (params?: { memberId?: string }) =>
    api.get<FleetChat[]>('/fleet/chats', { params }).then(r => r.data),
  getChatMessages: (id: string) =>
    api.get<{ chat: FleetChat; messages: FleetMessage[] }>(`/fleet/chats/${id}/messages`).then(r => r.data),
  archiveChat: (id: string) => api.post(`/fleet/chats/${id}/archive`),
  openChat: (memberId: string) =>
    api.post<{ id: string; created: boolean }>('/fleet/chats/open', { memberId }).then(r => r.data),
  sendMessage: (data: { memberId: string; chatId?: string; message: string; thinkingMode?: boolean }) =>
    api.post<ChatSendResult>('/fleet/chats/message', data).then(r => r.data),
  getChatRuntime: (id: string) =>
    api.get<ChatRuntimeStatus>(`/fleet/chats/${id}/runtime`).then(r => r.data),

  // Cron preview
  previewCron: (data: { nl?: string; cronExpr?: string; count?: number; cronTimezone?: string }) =>
    api.post<CronPreviewResult>('/fleet/cron/preview', data).then(r => r.data),

  // Builder (criação conversacional)
  builderChat: (data: {
    providerId: string
    model?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    currentConfig?: BuilderProposedConfig | null
  }) => api.post<BuilderChatResult>('/fleet/builder/chat', data).then(r => r.data),
  builderCreate: (data: {
    providerId: string
    model: string
    config: BuilderProposedConfig
    departmentId?: string | null
  }) => api.post<FleetMember>('/fleet/builder/create', data).then(r => r.data),
}

export interface BuilderProposedConfig {
  name?: string
  displayRole?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  suggestedTools?: string[]
  emoji?: string
  colorTag?: string
  complete?: boolean
}

export interface BuilderChatResult {
  reply: string
  proposedConfig: BuilderProposedConfig | null
  mergedConfig: BuilderProposedConfig
  isComplete: boolean
}


// ========== CRITIC REVIEWS (Raven) ==========
export interface FleetCriticReview {
  id: string
  operationId: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  recommendation: 'proceed' | 'proceed_with_caution' | 'request_approval' | 'block'
  rationale: string
  risks: Array<{ title: string; severity: string; mitigation: string }>
  perspectives: Array<{ role: string; concern: string }>
  proposedActions: any
  reviewedById: string | null
  reviewerRole: string | null
  provider: string | null
  model: string | null
  blocked: boolean
  createdAt: string
  operation?: {
    id: string
    instruction: string
    status: string
    member?: { id: string; name: string; displayRole: string | null }
  }
}
export const listFleetCriticReviews = (params: { riskLevel?: string; recommendation?: string; page?: number; limit?: number }) =>
  api.get<{ items: FleetCriticReview[]; total: number; page: number; totalPages: number }>('/fleet/critic-reviews', { params }).then(r => r.data)
export const getFleetOperationCriticReview = (operationId: string) =>
  api.get<FleetCriticReview>(`/fleet/operations/${operationId}/critic-review`).then(r => r.data)
