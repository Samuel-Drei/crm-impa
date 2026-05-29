import api from './api'

export type AIBrainNodeType =
  | 'CONTACT' | 'COMPANY' | 'TOPIC' | 'FACT' | 'PREFERENCE'
  | 'OBJECTION' | 'EVENT' | 'DOCUMENT_CHUNK' | 'SESSION'

export type AIBrainEdgeType =
  | 'MENTIONS' | 'PREFERS' | 'OBJECTS_TO' | 'RELATED_TO' | 'WORKS_AT'
  | 'DEAL_OF' | 'LEARNED_FROM' | 'SUPERSEDES' | 'PARTICIPATED_IN' | 'DERIVED_FROM'

export type AIBrainFactCategory =
  | 'DEMOGRAPHIC' | 'PREFERENCE' | 'OBJECTION' | 'INTENT'
  | 'PAIN_POINT' | 'COMMITMENT' | 'EVENT' | 'CUSTOM'

export interface BrainGraphNode {
  id: string
  label: string
  type: AIBrainNodeType
  size: number
  color: string
  metadata?: any
  subjectType?: string | null
  subjectId?: string | null
}

export interface BrainGraphEdge {
  id: string
  source: string
  target: string
  type: AIBrainEdgeType
  weight: number
  label?: string
}

export interface BrainGraphPayload {
  nodes: BrainGraphNode[]
  edges: BrainGraphEdge[]
  rootId?: string
}

export interface BrainFact {
  id: string
  companyId: string
  contactId?: string | null
  customerAccountId?: string | null
  agentId?: string | null
  nodeId?: string | null
  category: AIBrainFactCategory
  subject: string
  predicate: string
  value: string
  confidence: number
  sourceType: 'LLM' | 'MANUAL' | 'CRM_SYNC' | 'RAG'
  sourceRefType?: string | null
  sourceRefId?: string | null
  validFrom: string
  validTo?: string | null
  supersededById?: string | null
  createdAt: string
  updatedAt: string
}

export interface BrainProfile {
  node: any | null
  facts: BrainFact[]
  learnedToday: BrainFact[]
  connectionsCount: number
}

export const aiBrainService = {
  getProfile: async (subjectType: string, subjectId: string): Promise<BrainProfile> => {
    const { data } = await api.get('/ai/brain/profile', { params: { subjectType, subjectId } })
    return data
  },

  getGraph: async (
    subjectType: string,
    subjectId: string,
    depth = 2,
    types?: AIBrainNodeType[],
  ): Promise<BrainGraphPayload> => {
    const { data } = await api.get('/ai/brain/graph', {
      params: { subjectType, subjectId, depth, types: types?.join(',') },
    })
    return data
  },

  getGlobalGraph: async (limit = 500, types?: AIBrainNodeType[]): Promise<BrainGraphPayload> => {
    const { data } = await api.get('/ai/brain/graph/global', {
      params: { limit, types: types?.join(',') },
    })
    return data
  },

  syncContact: async (contactId: string) => {
    const { data } = await api.post(`/ai/brain/sync/contact/${contactId}`)
    return data
  },

  syncCustomerAccount: async (customerAccountId: string) => {
    const { data } = await api.post(`/ai/brain/sync/customer-account/${customerAccountId}`)
    return data
  },

  listFacts: async (params: {
    contactId?: string
    customerAccountId?: string
    category?: AIBrainFactCategory
    includeSuperseded?: boolean
    page?: number
    limit?: number
  }) => {
    const { data } = await api.get('/ai/brain/facts', { params })
    return data as { records: BrainFact[]; total: number; page: number; limit: number; totalPages: number }
  },

  createFact: async (payload: {
    contactId?: string
    customerAccountId?: string
    agentId?: string
    nodeId?: string
    category: AIBrainFactCategory
    subject: string
    predicate: string
    value: string
    confidence?: number
  }): Promise<BrainFact> => {
    const { data } = await api.post('/ai/brain/facts', payload)
    return data
  },

  supersedeFact: async (id: string, newValue: string, reason?: string): Promise<BrainFact> => {
    const { data } = await api.post(`/ai/brain/facts/${id}/supersede`, { newValue, reason })
    return data
  },

  deleteFact: async (id: string) => {
    const { data } = await api.delete(`/ai/brain/facts/${id}`)
    return data
  },
}
