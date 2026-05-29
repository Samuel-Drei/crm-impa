import api from './api'

// ============================================
// Types
// ============================================

export type AIProviderType = 
  | 'OPENAI' | 'GEMINI' | 'CLAUDE' 
  | 'DEEPSEEK' | 'GROQ' | 'OPENROUTER' | 'PERPLEXITY' | 'MISTRAL' 
  | 'COHERE' | 'XAI' | 'TOGETHER' | 'FIREWORKS' | 'CEREBRAS' 
  | 'GITHUB_MODELS' | 'GITHUB_COPILOT' | 'ANTIGRAVITY' | 'OPENAI_COMPATIBLE'

export interface AIProvider {
  id: string
  companyId: string
  name: string
  type: AIProviderType
  authType?: string
  model: string
  enabledModels: string[]
  baseUrl?: string | null
  maxTokens: number
  temperature: number
  topP?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  isActive: boolean
  isDefault: boolean
  refreshToken?: string | null
  tokenExpiresAt?: string | null
  oauthData?: any
  createdAt: string
  updatedAt: string
}

export interface AIAgent {
  id: string
  companyId: string
  providerId: string
  name: string
  description?: string
  type: 'LLM' | 'SEQUENTIAL' | 'WORKFLOW'
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT'
  systemPrompt: string
  welcomeMessage?: string
  triggerType: 'KEYWORD' | 'ALL' | 'ADVANCED' | 'NONE'
  triggerOperator: 'CONTAINS' | 'EQUALS' | 'STARTS_WITH' | 'ENDS_WITH' | 'REGEX'
  triggerValue?: string
  keywordFinish?: string
  unknownMessage?: string
  delayMessage: number
  splitMessages: boolean
  timePerChar: number
  maxMessageLength: number
  sessionTimeout: number
  keepOpen: boolean
  listeningFromMe: boolean
  stopBotFromMe: boolean
  debounceTime: number
  ignoreJids: string[]
  isDefault: boolean
  useCrmContext: boolean
  useContactInfo: boolean
  useConversationHistory: boolean
  contextMessagesLimit: number
  sessionMessagesLimit: number
  instanceIds: string[]
  mcpServerIds: string[]
  httpTools?: any
  followUpEnabled?: boolean
  followUpSteps?: any
  followUpPrompt?: string
  followUpCloseOnMax?: boolean
  followUpCloseMessage?: string
  settings?: any
  createdAt: string
  updatedAt: string
  provider?: { id: string; name: string; type: string; model: string; enabledModels?: string[] }
  _count?: { sessions: number; messages: number }
  knowledgeBases?: Array<{
    id: string
    knowledgeBase: { id: string; name: string; type: string; description?: string }
  }>
}

export type AIAgentPromptField = 'SYSTEM_PROMPT' | 'FOLLOW_UP_PROMPT'
export type AIPromptPatchOperation = 'REPLACE' | 'INSERT_BEFORE' | 'INSERT_AFTER' | 'APPEND' | 'REMOVE'

export interface PromptEditorFlags {
  preservePlaceholders: boolean
  preserveTools: boolean
  preserveStructure: boolean
  partialOnly: boolean
}

export interface PromptEditCandidate {
  label: string
  excerpt: string
}

export interface PromptPatchPlan {
  confidence: number
  operation: AIPromptPatchOperation
  target: {
    strategy: 'exact_match' | 'text_span' | 'document_end'
    startMarker?: string
    endMarker?: string
  }
  oldText: string
  newText: string
  reason: string
  needsConfirmation?: boolean
  candidates?: PromptEditCandidate[]
}

export interface PromptDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface PromptValidationIssue {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface PromptEditPreviewResponse {
  field: AIAgentPromptField
  instruction: string
  originalText: string
  resultText?: string
  patch?: PromptPatchPlan
  diff?: {
    additions: number
    removals: number
    hunks: PromptDiffHunk[]
  }
  validationIssues: PromptValidationIssue[]
  needsConfirmation: boolean
  candidates?: PromptEditCandidate[]
}

export interface AIAgentPromptVersion {
  id: string
  companyId: string
  agentId: string
  field: AIAgentPromptField
  instruction: string
  operation: AIPromptPatchOperation
  targetStrategy: string
  targetMeta?: any
  oldText: string
  newText: string
  resultText: string
  diffJson?: {
    additions: number
    removals: number
    hunks: PromptDiffHunk[]
  }
  confidence?: number | null
  needsConfirmation: boolean
  warnings?: PromptValidationIssue[]
  restoredFromVersionId?: string | null
  createdById?: string | null
  createdAt: string
}

export interface AIKnowledgeBase {
  id: string
  companyId: string
  name: string
  description?: string
  embeddingProviderId?: string | null
  embeddingProvider: string
  embeddingModel: string
  embeddingApiKey?: string | null
  embeddingBaseUrl?: string | null
  embeddingDimension: number
  chunkSize: number
  chunkOverlap: number
  retrievalMode: 'semantic' | 'keyword' | 'hybrid'
  topK: number
  scoreThreshold: number
  indexingStatus: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  sources?: AIKnowledgeSource[]
  agents?: Array<{ agent: { id: string; name: string } }>
  _count?: { documents: number }
}

export interface EmbeddingProviderInfo {
  id: string
  name: string
  models: Array<{
    id: string
    name: string
    dimensions: number
    pricePerMTokens: number
  }>
}

export interface AIQAPair {
  id: string
  question: string
  answer: string
  active: boolean
  order: number
}

export interface AIKnowledgeSource {
  id: string
  companyId: string
  knowledgeBaseId: string
  type: 'TEXT' | 'URL' | 'WEBSITE' | 'YOUTUBE' | 'FILE' | 'QA'
  name: string
  status: 'QUEUED' | 'PROCESSING' | 'INDEXED' | 'ERROR' | 'DISABLED'
  textContent?: string
  sourceUrl?: string
  crawlConfig?: any
  fileUrl?: string
  fileName?: string
  fileMimeType?: string
  fileSize?: number
  qaItems?: AIQAPair[]
  totalChunks: number
  lastIndexedAt?: string
  errorMessage?: string
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
  documents?: AIKnowledgeDocument[]
  jobs?: AIIngestionJob[]
}

export interface AIKnowledgeDocument {
  id: string
  title: string
  sourceUrl?: string
  status: string
  totalChunks: number
  tokenCount: number
  wordCount: number
  indexedAt?: string
  errorMessage?: string
  // Document parsing metadata
  pageCount?: number
  parsingMethod?: string
  fileSize?: number
}

export interface AIKnowledgeChunk {
  id: string
  content: string
  chunkIndex: number
  tokenCount: number
  isIndexed: boolean
}

export interface AIIngestionJob {
  id: string
  companyId: string
  sourceId: string
  type: string
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  progress: number
  currentStep?: string
  errorMessage?: string
  documentsFound: number
  documentsProcessed: number
  chunksCreated: number
  tokensUsed: number
  startedAt?: string
  completedAt?: string
  createdAt: string
  source?: { id: string; name: string; type: string }
}

export interface AISession {
  id: string
  agentId: string
  instanceId: string
  remoteJid: string
  status: 'OPENED' | 'PAUSED' | 'CLOSED'
  messageCount: number
  tokensUsed: number
  startedAt: string
  lastActivity: string
  closedAt?: string
  agent?: { id: string; name: string }
  _count?: { messages: number }
}

export interface AIMessage {
  id: string
  sessionId: string
  agentId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokensUsed?: number
  latencyMs?: number
  createdAt: string
}

export interface AIStats {
  totalAgents: number
  activeAgents: number
  totalSessions: number
  openSessions: number
  totalMessages: number
  totalProviders: number
  tokensLast24h: number
}

// ============================================
// API Calls
// ============================================

// Stats
export const getAIStats = () => api.get<AIStats>('/ai/stats').then(r => r.data)

// Providers
export const getAIProviders = () => api.get<AIProvider[]>('/ai/providers').then(r => r.data)
export const getAIProvider = (id: string) => api.get<AIProvider>(`/ai/providers/${id}`).then(r => r.data)
export const createAIProvider = (data: Partial<AIProvider> & { apiKey?: string }) =>
  api.post<AIProvider>('/ai/providers', data).then(r => r.data)
export const updateAIProvider = (id: string, data: Partial<AIProvider> & { apiKey?: string }) =>
  api.put<AIProvider>(`/ai/providers/${id}`, data).then(r => r.data)
export const deleteAIProvider = (id: string) => api.delete(`/ai/providers/${id}`)
export const testAIProvider = (id: string) =>
  api.post<{ success: boolean; response?: string; error?: string; latencyMs?: number }>(`/ai/providers/${id}/test`).then(r => r.data)

// Agents
export const getAIAgents = () => api.get<AIAgent[]>('/ai/agents').then(r => r.data)
export const getAIAgent = (id: string) => api.get<AIAgent>(`/ai/agents/${id}`).then(r => r.data)
export const createAIAgent = (data: Partial<AIAgent>) =>
  api.post<AIAgent>('/ai/agents', data).then(r => r.data)
export const updateAIAgent = (id: string, data: Partial<AIAgent>) =>
  api.put<AIAgent>(`/ai/agents/${id}`, data).then(r => r.data)
export const deleteAIAgent = (id: string) => api.delete(`/ai/agents/${id}`)

// ==================== Skills (Procedural Memory vetorizada) ====================
export interface AIAgentSkill {
  id: string
  companyId: string
  agentId: string | null
  name: string
  slug: string
  description?: string | null
  conditions: string[]
  instructions: string
  examples?: string | null
  relatedSkillIds: string[]
  priority: number
  tags: string[]
  isActive: boolean
  embeddingProviderId?: string | null
  embeddingModel?: string | null
  qdrantPointId?: string | null
  embeddingHash?: string | null
  indexedAt?: string | null
  hitCount: number
  lastHitAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ActiveSkillPreview {
  id: string
  name: string
  slug: string
  priority: number
  alwaysOn: boolean
  score?: number
  instructions: string
  examples?: string | null
}

export const listAISkills = (params?: { agentId?: string; includeGlobal?: boolean }) => {
  const search = new URLSearchParams()
  if (params?.agentId) search.set('agentId', params.agentId)
  if (params?.includeGlobal !== undefined) search.set('includeGlobal', String(params.includeGlobal))
  const qs = search.toString()
  return api.get<AIAgentSkill[]>(`/ai/skills${qs ? `?${qs}` : ''}`).then(r => r.data)
}
export const getAISkill = (id: string) => api.get<AIAgentSkill>(`/ai/skills/${id}`).then(r => r.data)
export const createAISkill = (data: Partial<AIAgentSkill>) =>
  api.post<AIAgentSkill>('/ai/skills', data).then(r => r.data)
export const updateAISkill = (id: string, data: Partial<AIAgentSkill>) =>
  api.put<AIAgentSkill>(`/ai/skills/${id}`, data).then(r => r.data)
export const deleteAISkill = (id: string) => api.delete(`/ai/skills/${id}`)
export const reindexAISkill = (id: string) => api.post(`/ai/skills/${id}/reindex`).then(r => r.data)
export const reindexAllAISkills = () =>
  api.post<{ ok: number; failed: number }>('/ai/skills/reindex-all').then(r => r.data)
export const previewAISkills = (data: { agentId: string; message: string; topK?: number; scoreThreshold?: number }) =>
  api.post<{ skills: ActiveSkillPreview[]; promptPreview: string }>('/ai/skills/preview', data).then(r => r.data)

// Prompt Editor (edição inteligente parcial)
export const previewAIAgentPromptEdit = (id: string, data: {
  field: AIAgentPromptField
  instruction: string
  flags: PromptEditorFlags
  selectedCandidate?: PromptEditCandidate | null
  /** Override de provider para esta edição (opcional). */
  providerId?: string | null
  /** Override de modelo para esta edição (opcional). */
  model?: string | null
}) => api.post<PromptEditPreviewResponse>(`/ai/agents/${id}/prompt-editor/preview`, data).then(r => r.data)

export const applyAIAgentPromptEdit = (id: string, data: {
  field: AIAgentPromptField
  instruction: string
  flags: PromptEditorFlags
  patch: PromptPatchPlan
}) => api.post<{
  agent: AIAgent
  version: AIAgentPromptVersion
  diff: { additions: number; removals: number; hunks: PromptDiffHunk[] }
  validationIssues: PromptValidationIssue[]
}>(`/ai/agents/${id}/prompt-editor/apply`, data).then(r => r.data)

export const listAIAgentPromptVersions = (id: string) =>
  api.get<AIAgentPromptVersion[]>(`/ai/agents/${id}/prompt-editor/versions`).then(r => r.data)

export const getAIAgentPromptVersion = (id: string, versionId: string) =>
  api.get<AIAgentPromptVersion>(`/ai/agents/${id}/prompt-editor/versions/${versionId}`).then(r => r.data)

export const restoreAIAgentPromptVersion = (id: string, versionId: string) =>
  api.post<{
    agent: AIAgent
    version: AIAgentPromptVersion
    diff: { additions: number; removals: number; hunks: PromptDiffHunk[] }
  }>(`/ai/agents/${id}/prompt-editor/versions/${versionId}/restore`).then(r => r.data)

// Prompt Coach (análise e coaching do prompt)
export type CoachIssueSeverity = 'error' | 'warning' | 'info' | 'suggestion'
export type CoachPillar =
  | 'role' | 'goal' | 'rules' | 'tone' | 'structure'
  | 'examples' | 'variables' | 'fallback' | 'flow' | 'quality'

export interface CoachIssue {
  id: string
  pillar: CoachPillar
  severity: CoachIssueSeverity
  title: string
  message: string
  excerpt?: string
  source: 'static' | 'ai'
  suggestion?: { label: string; instruction: string }
}

export interface CoachPillarScore {
  pillar: CoachPillar
  label: string
  score: number
  maxScore: number
}

export interface CoachAnalysisResponse {
  field: AIAgentPromptField
  score: number
  grade: string
  pillars: CoachPillarScore[]
  issues: CoachIssue[]
  summary?: string
  aiUsed: boolean
  stats: {
    chars: number
    words: number
    lines: number
    sections: number
    placeholders: number
    examples: number
  }
}

export const analyzeAIAgentPrompt = (id: string, data: {
  field: AIAgentPromptField
  useAI?: boolean
  providerId?: string
  model?: string
}) => api.post<CoachAnalysisResponse>(`/ai/agents/${id}/prompt-coach/analyze`, data).then(r => r.data)

// Knowledge Base (RAG)
export const getAIKnowledgeBases = () => api.get<AIKnowledgeBase[]>('/ai/knowledge-bases').then(r => r.data)
export const getAIKnowledgeBase = (id: string) => api.get<AIKnowledgeBase>(`/ai/knowledge-bases/${id}`).then(r => r.data)
export const createAIKnowledgeBase = (data: { name: string; description?: string }) =>
  api.post<AIKnowledgeBase>('/ai/knowledge-bases', data).then(r => r.data)
export const updateAIKnowledgeBase = (id: string, data: Partial<AIKnowledgeBase>) =>
  api.put<AIKnowledgeBase>(`/ai/knowledge-bases/${id}`, data).then(r => r.data)
export const deleteAIKnowledgeBase = (id: string) => api.delete(`/ai/knowledge-bases/${id}`)

// Knowledge Sources
export const getAIKnowledgeSource = (id: string) => api.get<AIKnowledgeSource>(`/ai/knowledge-sources/${id}`).then(r => r.data)
export const createAIKnowledgeSource = (data: {
  knowledgeBaseId: string
  type: 'TEXT' | 'URL' | 'WEBSITE' | 'YOUTUBE' | 'FILE' | 'QA'
  name: string
  textContent?: string
  sourceUrl?: string
  crawlConfig?: any
  fileUrl?: string
  fileName?: string
  fileMimeType?: string
  fileSize?: number
  qaItems?: Array<{ question: string; answer: string; active?: boolean; order?: number }>
}) => api.post<{ source: AIKnowledgeSource; jobId: string }>('/ai/knowledge-sources', data).then(r => r.data)
export const uploadAIKnowledgeFile = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post<{ fileUrl: string; fileName: string; fileMimeType: string; fileSize: number }>(
    '/ai/knowledge-sources/upload',
    fd,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  ).then(r => r.data)
}
export const deleteAIKnowledgeSource = (id: string) => api.delete(`/ai/knowledge-sources/${id}`)
export const updateAIKnowledgeSource = (id: string, data: { name?: string; textContent?: string }) =>
  api.put<{ source: AIKnowledgeSource; jobId?: string }>(`/ai/knowledge-sources/${id}`, data).then(r => r.data)
export const reindexAIKnowledgeSource = (id: string) =>
  api.post<{ jobId: string }>(`/ai/knowledge-sources/${id}/reindex`).then(r => r.data)

// Q&A Pairs CRUD
export const addAIKnowledgeQAPair = (sourceId: string, data: { question: string; answer: string; active?: boolean; order?: number }) =>
  api.post<{ pair: AIQAPair; jobId: string }>(`/ai/knowledge-sources/${sourceId}/qa-pairs`, data).then(r => r.data)
export const updateAIKnowledgeQAPair = (sourceId: string, pairId: string, data: Partial<{ question: string; answer: string; active: boolean; order: number }>) =>
  api.put<{ pair: AIQAPair; jobId: string }>(`/ai/knowledge-sources/${sourceId}/qa-pairs/${pairId}`, data).then(r => r.data)
export const deleteAIKnowledgeQAPair = (sourceId: string, pairId: string) =>
  api.delete<{ success: boolean; jobId: string }>(`/ai/knowledge-sources/${sourceId}/qa-pairs/${pairId}`).then(r => r.data)

// Markdown export (visualizar/baixar conteúdo extraído)
export const getAIKnowledgeSourceMarkdown = (id: string) =>
  api.get<string>(`/ai/knowledge-sources/${id}/markdown`, { responseType: 'text', transformResponse: [(d) => d] }).then(r => r.data)
export const getAIKnowledgeDocumentMarkdown = (id: string) =>
  api.get<string>(`/ai/knowledge-documents/${id}/markdown`, { responseType: 'text', transformResponse: [(d) => d] }).then(r => r.data)
export const downloadAIKnowledgeSourceMarkdown = async (id: string, fileName: string) => {
  const res = await api.get(`/ai/knowledge-sources/${id}/markdown`, { params: { download: 1 }, responseType: 'blob' })
  const blob = new Blob([res.data], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.md') ? fileName : `${fileName}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
export const downloadAIKnowledgeDocumentMarkdown = async (id: string, fileName: string) => {
  const res = await api.get(`/ai/knowledge-documents/${id}/markdown`, { params: { download: 1 }, responseType: 'blob' })
  const blob = new Blob([res.data], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.md') ? fileName : `${fileName}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Ingestion Jobs
export const getAIIngestionJobs = (params?: { sourceId?: string; status?: string }) =>
  api.get<AIIngestionJob[]>('/ai/ingestion-jobs', { params }).then(r => r.data)
export const getAIIngestionJob = (id: string) =>
  api.get<AIIngestionJob>(`/ai/ingestion-jobs/${id}`).then(r => r.data)

// RAG Health & Debug
export const getRAGHealth = () =>
  api.get<{ qdrant: string; status: string }>('/ai/rag/health').then(r => r.data)
export const testRAGSearch = (data: { query: string; knowledgeBaseIds?: string[]; topK?: number; scoreThreshold?: number }) =>
  api.post<{ results: any[]; total: number }>('/ai/rag/search', data).then(r => r.data)

// KB Chat (conversar com a base)
export const chatWithKnowledgeBase = (kbId: string, data: { message: string; history?: Array<{ role: string; content: string }>; providerId?: string; model?: string }) =>
  api.post<{ reply: string; model: string; providerName: string; sources: any[]; tokensUsed: number; costUsd: number }>(`/ai/knowledge-bases/${kbId}/chat`, data).then(r => r.data)

// ASR (Automatic Speech Recognition) para YouTube sem legendas
export const getAsrEstimate = (sourceId: string, provider?: 'openai' | 'local') =>
  api.post<{
    estimate: {
      videoId: string; title: string; durationSeconds: number; durationFormatted: string
      provider: string; estimatedCostUsd: number; pricePerMinute: number; isFree: boolean; message: string
    }
    providers: Array<{ id: string; name: string; available: boolean; reason?: string }>
    ytdlpAvailable: boolean
  }>(`/ai/sources/${sourceId}/asr-estimate`, { provider }).then(r => r.data)

export const confirmAsrTranscription = (sourceId: string, data: { provider: 'openai' | 'local'; acceptedCostUsd: number }) =>
  api.post<{ message: string; jobId: string; provider: string; estimatedCostUsd: number }>(`/ai/sources/${sourceId}/asr-confirm`, data).then(r => r.data)

export const getAsrStatus = () =>
  api.get<{ ytdlpAvailable: boolean; providers: { openai: { available: boolean; pricePerMinute: number }; local: { available: boolean; pricePerMinute: number } } }>('/ai/asr-status').then(r => r.data)

// Embedding Providers catalog
export const getEmbeddingProviders = () =>
  api.get<EmbeddingProviderInfo[]>('/ai/embedding-providers').then(r => r.data)

// Agent Test Chat (conversar diretamente com o agente sem WhatsApp)
export const testAgentChat = (agentId: string, data: { message: string; history?: Array<{ role: string; content: string }>; providerId?: string; model?: string }) =>
  api.post<{ reply: string; model: string; providerName: string; tokensUsed: number; costUsd: number; latencyMs: number }>(`/ai/agents/${agentId}/test-chat`, data).then(r => r.data)

// Agent Knowledge links
export const linkKnowledgeToAgent = (agentId: string, kbId: string) =>
  api.post(`/ai/agents/${agentId}/knowledge/${kbId}`).then(r => r.data)
export const unlinkKnowledgeFromAgent = (agentId: string, kbId: string) =>
  api.delete(`/ai/agents/${agentId}/knowledge/${kbId}`)

// Sessions
export const getAISessions = (params?: { agentId?: string; status?: string; page?: number; limit?: number }) =>
  api.get('/ai/sessions', { params }).then(r => r.data)
export const getAISessionMessages = (sessionId: string) =>
  api.get<{ session: AISession; messages: AIMessage[] }>(`/ai/sessions/${sessionId}/messages`).then(r => r.data)
export const closeAISession = (sessionId: string) =>
  api.post(`/ai/sessions/${sessionId}/close`).then(r => r.data)
export const reopenAISession = (sessionId: string) =>
  api.post(`/ai/sessions/${sessionId}/reopen`).then(r => r.data)
export const deleteAISession = (sessionId: string) =>
  api.delete(`/ai/sessions/${sessionId}`).then(r => r.data)

// Chat (teste manual)
export const sendAIChat = (data: {
  agentId: string
  instanceId: string
  remoteJid: string
  message: string
  contactName?: string
}) => api.post<{ reply: string; sessionId: string; tokensUsed: number }>('/ai/chat', data).then(r => r.data)

// ============================================
// Tool Logs
// ============================================

export interface AIToolLog {
  id: string
  companyId: string
  agentId: string
  sessionId?: string
  toolType: string
  toolName: string
  status: string
  requestMethod?: string
  requestUrl?: string
  requestHeaders?: any
  requestBody?: any
  requestParams?: any
  responseStatus?: number
  responseHeaders?: any
  responseBody?: string
  responseTime?: number
  resultForLLM?: string
  input?: any
  output?: any
  errorMessage?: string
  errorStack?: string
  durationMs?: number
  retryCount: number
  metadata?: any
  createdAt: string
}

export interface AIToolLogsResponse {
  logs: AIToolLog[]
  total: number
  page: number
  pages: number
}

export const getAIToolLogs = (params?: {
  agentId?: string; sessionId?: string; toolType?: string; status?: string; page?: number; limit?: number
}) => api.get<AIToolLogsResponse>('/ai/tool-logs', { params }).then(r => r.data)

export const getAIToolLog = (id: string) =>
  api.get<AIToolLog>(`/ai/tool-logs/${id}`).then(r => r.data)

// ============================================
// MCP Servers
// ============================================

export interface AIMCPServer {
  id: string
  companyId: string
  name: string
  description?: string
  serverUrl: string
  transport: 'sse' | 'streamable_http'
  authType: 'none' | 'bearer' | 'header' | 'query'
  authKey?: string
  authValue?: string
  timeout: number
  sseReadTimeout: number
  isActive: boolean
  discoveredTools?: any
  lastDiscoveredAt?: string
  createdAt: string
  updatedAt: string
}

export const getAIMCPServers = () =>
  api.get<AIMCPServer[]>('/ai/mcp-servers').then(r => r.data)

export const createAIMCPServer = (data: Partial<AIMCPServer>) =>
  api.post<AIMCPServer>('/ai/mcp-servers', data).then(r => r.data)

export const updateAIMCPServer = (id: string, data: Partial<AIMCPServer>) =>
  api.put<AIMCPServer>(`/ai/mcp-servers/${id}`, data).then(r => r.data)

export const deleteAIMCPServer = (id: string) =>
  api.delete(`/ai/mcp-servers/${id}`)

export const discoverMCPTools = (id: string) =>
  api.post<{ success: boolean; tools: any[]; discoveredAt?: string }>(`/ai/mcp-servers/${id}/discover`).then(r => r.data)

export const importOpenAPISpec = (spec: string) =>
  api.post<{ tools: any[]; baseUrl: string; info: any; errors: string[] }>('/ai/tools/import-openapi', { spec }).then(r => r.data)

// ============================================
// Agent Templates
// ============================================

export interface AIAgentTemplate {
  id: string
  slug: string
  name: string
  description: string
  category: string
  icon?: string
  color?: string
  systemPrompt: string
  welcomeMessage?: string
  model?: string
  providerType?: AIProviderType
  triggerType: string
  sessionTimeout: number
  followUpEnabled: boolean
  followUpPrompt?: string
  tags: string[]
  difficulty: string
  isActive: boolean
  sortOrder: number
  usageCount: number
  createdAt: string
  updatedAt: string
}

export const getAITemplates = (params?: { category?: string; difficulty?: string; search?: string }) =>
  api.get<AIAgentTemplate[]>('/ai/templates', { params }).then(r => r.data)

export const getAITemplate = (id: string) =>
  api.get<AIAgentTemplate>(`/ai/templates/${id}`).then(r => r.data)

export const getAITemplateCategories = () =>
  api.get<string[]>('/ai/templates/categories').then(r => r.data)

export const createAgentFromTemplate = (templateId: string, data: { providerId: string; name?: string; instanceIds?: string[] }) =>
  api.post<{ agent: AIAgent; template: { id: string; name: string; slug: string } }>(`/ai/templates/${templateId}/create-agent`, data).then(r => r.data)

export const seedAITemplates = () =>
  api.post<{ created: number; updated: number }>('/ai/templates/seed').then(r => r.data)

// ============================================
// AI Memory (Memória Persistente)
// ============================================

export interface AIMemory {
  id: string
  companyId: string
  agentId: string
  remoteJid: string
  summary: string
  facts?: string[]
  preferences?: Record<string, any>
  sessionCount: number
  lastSessionId?: string
  tokensUsed: number
  createdAt: string
  updatedAt: string
}

export const getAIMemories = (params?: { agentId?: string; remoteJid?: string; page?: number; limit?: number }) =>
  api.get<{ records: AIMemory[]; total: number; page: number; limit: number; totalPages: number }>('/ai/memories', { params }).then(r => r.data)

export const getAIMemory = (id: string) =>
  api.get<AIMemory>(`/ai/memories/${id}`).then(r => r.data)

export const deleteAIMemory = (id: string) =>
  api.delete(`/ai/memories/${id}`)

// ============================================
// Provider Metrics (Smart Routing)
// ============================================

export interface AIProviderMetricSummary {
  providerId: string
  providerName: string
  providerType: AIProviderType
  totalCalls: number
  successRate: number
  avgLatencyMs: number
  totalCostUsd: number
  models: string[]
  timeline: Array<{ windowStart: string; calls: number; avgLatency: number; errorRate: number }>
}

export const getAIProviderMetrics = (hours?: number) =>
  api.get<AIProviderMetricSummary[]>('/ai/provider-metrics', { params: hours ? { hours } : undefined }).then(r => r.data)

export const cleanAIProviderMetrics = () =>
  api.delete<{ deleted: number }>('/ai/provider-metrics/cleanup').then(r => r.data)

export interface AIProviderHealth {
  id: string
  name: string
  type: string
  model: string
  healthStatus: string
  healthLatencyMs: number | null
  lastHealthCheckAt: string | null
  consecutiveErrors: number
  lastHealthError: string | null
}

export const getAIProvidersHealth = () =>
  api.get<AIProviderHealth[]>('/ai/providers/health').then(r => r.data)


// ========== AGENT LEARNINGS ==========
export interface AIAgentLearning {
  id: string
  agentId: string
  trigger: string
  lesson: string
  category: string
  confidence: number
  appliedCount: number
  active: boolean
  archivedAt: string | null
  sourceType: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  agent?: { id: string; name: string }
}
export const listAILearnings = (params: { agentId?: string; category?: string; active?: string; page?: number; limit?: number }) =>
  api.get<{ items: AIAgentLearning[]; total: number; page: number; totalPages: number }>('/ai/learnings', { params }).then(r => r.data)
export const createAILearning = (data: { agentId: string; trigger: string; lesson: string; category?: string; confidence?: number }) =>
  api.post<AIAgentLearning>('/ai/learnings', data).then(r => r.data)
export const updateAILearning = (id: string, data: Partial<{ trigger: string; lesson: string; category: string; confidence: number; active: boolean }>) =>
  api.put<AIAgentLearning>(`/ai/learnings/${id}`, data).then(r => r.data)
export const deleteAILearning = (id: string) => api.delete(`/ai/learnings/${id}`)

// ========== AI ARTIFACTS ==========
export interface AIArtifact {
  id: string
  agentId: string
  remoteJid: string | null
  sessionId: string | null
  name: string
  description: string | null
  type: string
  mimeType: string | null
  content?: string
  version: number
  parentArtifactId: string | null
  status: string
  approvedBy: string | null
  approvedAt: string | null
  metadata?: any
  createdAt: string
  updatedAt: string
  versions?: Array<{ id: string; version: number; createdAt: string; status: string }>
}
export const listAIArtifacts = (params: { agentId?: string; remoteJid?: string; type?: string; status?: string; rootOnly?: string; page?: number; limit?: number }) =>
  api.get<{ items: AIArtifact[]; total: number; page: number; totalPages: number }>('/ai/artifacts', { params }).then(r => r.data)
export const getAIArtifact = (id: string) => api.get<AIArtifact>(`/ai/artifacts/${id}`).then(r => r.data)
export const updateAIArtifact = (id: string, data: Partial<{ name: string; description: string; status: string; content: string }>) =>
  api.put<AIArtifact>(`/ai/artifacts/${id}`, data).then(r => r.data)
export const deleteAIArtifact = (id: string) => api.delete(`/ai/artifacts/${id}`)
