import { AIAgentPromptField, AIPromptPatchOperation } from '@prisma/client'
import { prisma } from '../../../config/database.js'
import { buildPromptDiff } from './diff.js'
import { applyPromptPatch } from './patch-engine.js'
import { buildPromptEditorSystemPrompt } from './prompt.js'
import type {
  PromptApplyRequest,
  PromptEditPreviewRequest,
  PromptEditPreviewResponse,
  PromptPatchPlan,
} from './types.js'
import { validatePromptEdit } from './validators.js'
import { createProvider } from '../providers/index.js'
import { getProviderWithSecrets } from '../ai.service.js'
import { trackTokenUsage } from '../token-tracker.js'

function getFieldValue(agent: { systemPrompt: string; followUpPrompt: string | null }, field: AIAgentPromptField) {
  return field === 'SYSTEM_PROMPT' ? agent.systemPrompt : (agent.followUpPrompt || '')
}

function setFieldValue(field: AIAgentPromptField, value: string) {
  return field === 'SYSTEM_PROMPT' ? { systemPrompt: value } : { followUpPrompt: value }
}

function extractJsonObject(content: string) {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Resposta da IA não contém JSON válido')
  }
  return trimmed.slice(firstBrace, lastBrace + 1)
}

function normalizePatchPlan(raw: any): PromptPatchPlan {
  return {
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
    operation: raw.operation,
    target: {
      strategy: raw.target?.strategy || 'exact_match',
      startMarker: raw.target?.startMarker,
      endMarker: raw.target?.endMarker,
    },
    oldText: String(raw.oldText || ''),
    newText: String(raw.newText || ''),
    reason: String(raw.reason || ''),
    needsConfirmation: !!raw.needsConfirmation,
    candidates: Array.isArray(raw.candidates) ? raw.candidates.map((candidate: any) => ({
      label: String(candidate.label || 'Trecho provável'),
      excerpt: String(candidate.excerpt || ''),
    })) : undefined,
  }
}

export async function getPromptEditorAgent(agentId: string, companyId: string) {
  const agent = await prisma.aIAgent.findFirst({
    where: { id: agentId, companyId },
    include: {
      provider: {
        select: { id: true, type: true, model: true, baseUrl: true },
      },
    },
  })

  if (!agent) throw new Error('Agente não encontrado')
  return agent
}

export async function previewPromptEdit(agentId: string, companyId: string, request: PromptEditPreviewRequest): Promise<PromptEditPreviewResponse> {
  const agent = await getPromptEditorAgent(agentId, companyId)
  const currentText = getFieldValue(agent, request.field)

  // Resolve provider: override do request (se válido e pertencer à empresa) ou o provider do agente
  const targetProviderId = request.providerId || agent.providerId
  const provider = await getProviderWithSecrets(targetProviderId, companyId)
  if (!provider) throw new Error('Provider não encontrado')
  if (request.providerId && !provider.isActive) {
    throw new Error(`Provider "${provider.name}" está inativo`)
  }

  // Resolve modelo: override do request → agent.model → provider.model
  let modelName = request.model || agent.model || provider.model

  // Validação: se um override de modelo foi pedido, ele precisa estar na lista de enabledModels do provider
  if (request.model && Array.isArray(provider.enabledModels) && provider.enabledModels.length > 0) {
    if (!provider.enabledModels.includes(request.model)) {
      throw new Error(`Modelo "${request.model}" não está habilitado para o provider "${provider.name}"`)
    }
    modelName = request.model
  }

  const providerImpl = createProvider(provider.type, provider.apiKey, provider.baseUrl, provider.oauthData)
  const completion = await providerImpl.chat({
    model: modelName,
    systemPrompt: buildPromptEditorSystemPrompt(request, currentText),
    messages: [{
      role: 'user',
      content: JSON.stringify({
        instruction: request.instruction,
        field: request.field,
        selectedCandidate: request.selectedCandidate || null,
      }),
    }],
    temperature: 0.1,
    maxTokens: 1600,
  })

  // Contabilizar tokens no relatório
  await trackTokenUsage({
    companyId,
    agentId,
    instanceId: '__prompt_editor__',
    model: completion.model || modelName,
    promptTokens: completion.promptTokens || Math.floor(completion.tokensUsed * 0.7),
    completionTokens: completion.completionTokens || Math.floor(completion.tokensUsed * 0.3),
    totalTokens: completion.tokensUsed,
  })

  const parsed = normalizePatchPlan(JSON.parse(extractJsonObject(completion.content)))

  if (parsed.needsConfirmation || parsed.confidence < 0.6 || !parsed.operation) {
    return {
      field: request.field,
      instruction: request.instruction,
      originalText: currentText,
      needsConfirmation: true,
      candidates: parsed.candidates || [],
      patch: parsed,
      validationIssues: [],
    }
  }

  const resultText = applyPromptPatch(currentText, parsed)
  const validationIssues = validatePromptEdit(currentText, resultText, request.flags)
  const diff = buildPromptDiff(currentText, resultText)

  return {
    field: request.field,
    instruction: request.instruction,
    originalText: currentText,
    resultText,
    patch: parsed,
    diff,
    needsConfirmation: false,
    validationIssues,
  }
}

export async function applyPromptEdit(agentId: string, companyId: string, userId: string | undefined, request: PromptApplyRequest) {
  const agent = await getPromptEditorAgent(agentId, companyId)
  const currentText = getFieldValue(agent, request.field)
  const resultText = applyPromptPatch(currentText, request.patch)
  const validationIssues = validatePromptEdit(currentText, resultText, request.flags)
  const blockingIssues = validationIssues.filter(issue => issue.severity === 'error')

  if (blockingIssues.length > 0) {
    throw new Error(blockingIssues.map(issue => issue.message).join('; '))
  }

  const diff = buildPromptDiff(currentText, resultText)

  const updatedAgent = await prisma.aIAgent.update({
    where: { id: agentId },
    data: setFieldValue(request.field, resultText),
    include: {
      provider: {
        select: { id: true, name: true, type: true, model: true },
      },
    },
  })

  const version = await prisma.aIAgentPromptVersion.create({
    data: {
      companyId,
      agentId,
      field: request.field,
      instruction: request.instruction,
      operation: request.patch.operation,
      targetStrategy: request.patch.target.strategy,
      targetMeta: request.patch.target as any,
      oldText: request.patch.oldText,
      newText: request.patch.newText,
      resultText,
      diffJson: diff as any,
      confidence: request.patch.confidence,
      needsConfirmation: !!request.patch.needsConfirmation,
      warnings: validationIssues.filter(issue => issue.severity === 'warning') as any,
      createdById: userId,
    },
  })

  return { agent: updatedAgent, version, diff, validationIssues }
}

export async function listPromptVersions(agentId: string, companyId: string) {
  return prisma.aIAgentPromptVersion.findMany({
    where: { agentId, companyId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getPromptVersion(agentId: string, versionId: string, companyId: string) {
  const version = await prisma.aIAgentPromptVersion.findFirst({
    where: { id: versionId, agentId, companyId },
  })
  if (!version) throw new Error('Versão de prompt não encontrada')
  return version
}

export async function restorePromptVersion(agentId: string, versionId: string, companyId: string, userId?: string) {
  const version = await getPromptVersion(agentId, versionId, companyId)
  const agent = await getPromptEditorAgent(agentId, companyId)
  const previousText = getFieldValue(agent, version.field)
  const restoredText = version.resultText
  const diff = buildPromptDiff(previousText, restoredText)

  const updatedAgent = await prisma.aIAgent.update({
    where: { id: agentId },
    data: setFieldValue(version.field, restoredText),
    include: {
      provider: {
        select: { id: true, name: true, type: true, model: true },
      },
    },
  })

  const newVersion = await prisma.aIAgentPromptVersion.create({
    data: {
      companyId,
      agentId,
      field: version.field,
      instruction: `Restauração da versão ${version.id}`,
      operation: AIPromptPatchOperation.REPLACE,
      targetStrategy: 'exact_match',
      targetMeta: { restoredFromVersionId: version.id } as any,
      oldText: previousText,
      newText: restoredText,
      resultText: restoredText,
      diffJson: diff as any,
      confidence: 1,
      needsConfirmation: false,
      warnings: [],
      restoredFromVersionId: version.id,
      createdById: userId,
    },
  })

  return { agent: updatedAgent, version: newVersion, diff }
}