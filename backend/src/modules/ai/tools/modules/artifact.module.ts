/**
 * Artifact Module — Outputs versionáveis do agente.
 *
 * Quando o agente gera um RELATÓRIO, CÓDIGO, CONTRATO, TABELA, JSON estruturado
 * ou qualquer documento que vale a pena persistir além do histórico de mensagens,
 * ele salva como ARTEFATO. Permite versionar (cada update cria nova versão),
 * revisar, aprovar e reutilizar em conversas futuras.
 *
 * Inspirado no padrão "Artifacts" do Claude/ChatGPT Canvas.
 *
 * Config esperada em agent.settings.artifacts:
 *   { enabled: boolean, maxArtifactsPerConversation?: number }
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'
import { io } from '../../../../server.js'
import { instanceRoom } from '../../../../config/socket-rooms.js'

export interface ArtifactToolConfig {
  enabled?: boolean
  maxArtifactsPerConversation?: number // default 20
}

const ALLOWED_TYPES = ['markdown', 'json', 'html', 'table', 'code', 'image_url', 'pdf_url', 'other'] as const

const SAVE_ARTIFACT_TOOL: AIToolDefinition = {
  name: 'save_artifact',
  description:
    'Salva um ARTEFATO (documento estruturado/persistente) gerado por você. ' +
    'Use para: relatórios, contratos, propostas, código gerado, tabelas, JSONs estruturados, ' +
    'qualquer output que o usuário pode querer ver/editar/reusar depois. ' +
    'NÃO use para mensagens normais de conversa.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome curto/descritivo. Ex: "Proposta Cliente XYZ", "Script Python análise vendas".' },
      type: { type: 'string', enum: [...ALLOWED_TYPES], description: 'Tipo do conteúdo.' },
      content: { type: 'string', description: 'O conteúdo do artefato (texto, JSON serializado, código, URL).' },
      description: { type: 'string', description: 'Resumo de 1 frase do que é (opcional).' },
      mimeType: { type: 'string', description: 'MIME type (opcional). Ex: "text/markdown", "application/json".' },
    },
    required: ['name', 'type', 'content'],
  },
}

const UPDATE_ARTIFACT_TOOL: AIToolDefinition = {
  name: 'update_artifact',
  description:
    'Cria uma NOVA VERSÃO de um artefato existente. O original é preservado; a nova versão fica linkada como filha. ' +
    'Use quando o usuário pedir alterações em um artefato salvo anteriormente.',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'ID do artefato pai (visível em list_artifacts ou retornado em save_artifact).' },
      content: { type: 'string', description: 'Novo conteúdo completo.' },
      changeNote: { type: 'string', description: 'O que mudou nesta versão (opcional, para histórico).' },
    },
    required: ['artifactId', 'content'],
  },
}

const LIST_ARTIFACTS_TOOL: AIToolDefinition = {
  name: 'list_artifacts',
  description: 'Lista artefatos salvos (próprios e do contato atual quando aplicável).',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...ALLOWED_TYPES], description: 'Filtrar por tipo (opcional).' },
      scope: { type: 'string', enum: ['contact', 'agent_all'], description: 'contact = só do contato atual (default); agent_all = todos do agente.' },
      limit: { type: 'number', description: 'Máx 50 (default 20).' },
    },
  },
}

const GET_ARTIFACT_TOOL: AIToolDefinition = {
  name: 'get_artifact',
  description: 'Recupera o conteúdo completo de um artefato pelo ID.',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'ID do artefato.' },
    },
    required: ['artifactId'],
  },
}

function jsonOk(d: any) { return JSON.stringify({ success: true, ...d }) }
function jsonErr(m: string, code = 'artifact_error') { return JSON.stringify({ success: false, error: code, message: m }) }

function emitArtifact(ctx: ToolExecutionContext, action: string, artifact: any) {
  try {
    io.to(instanceRoom(ctx.companyId, ctx.instanceId)).emit('ai-artifact-updated', {
      action,
      instanceId: ctx.instanceId,
      remoteJid: ctx.remoteJid,
      agentId: ctx.agentId,
      artifact: { id: artifact.id, name: artifact.name, type: artifact.type, version: artifact.version },
      timestamp: new Date().toISOString(),
    })
  } catch { /* noop */ }
}

export const artifactModule: ToolModule = {
  type: 'artifact',
  name: 'Versioned Artifacts',

  getTools(config: ArtifactToolConfig | null | undefined): AIToolDefinition[] {
    if (!config || config.enabled === false) return []
    return [SAVE_ARTIFACT_TOOL, UPDATE_ARTIFACT_TOOL, LIST_ARTIFACTS_TOOL, GET_ARTIFACT_TOOL]
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: ArtifactToolConfig | null | undefined,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      const { companyId, agentId, remoteJid, sessionId } = ctx
      if (!companyId) return { success: false, result: jsonErr('Contexto incompleto') }
      const maxPerConv = config?.maxArtifactsPerConversation ?? 20

      if (toolName === 'save_artifact') {
        const name = String(args.name || '').trim().substring(0, 200)
        const type = String(args.type || '')
        const content = String(args.content ?? '')
        if (!name || !content) return { success: false, result: jsonErr('"name" e "content" são obrigatórios') }
        if (!(ALLOWED_TYPES as readonly string[]).includes(type)) return { success: false, result: jsonErr(`type inválido. Use: ${ALLOWED_TYPES.join('|')}`) }

        // Limite por conversa
        if (remoteJid) {
          const count = await prisma.aIArtifact.count({ where: { companyId, remoteJid, parentArtifactId: null } })
          if (count >= maxPerConv) {
            return { success: false, result: jsonErr(`Limite de ${maxPerConv} artefatos por conversa atingido. Use update_artifact em algum existente.`, 'limit_reached') }
          }
        }

        const created = await prisma.aIArtifact.create({
          data: {
            companyId, agentId, sessionId: sessionId || null, remoteJid: remoteJid || null,
            name, type, content,
            description: args.description ? String(args.description).substring(0, 500) : null,
            mimeType: args.mimeType ? String(args.mimeType).substring(0, 100) : null,
          },
        })
        emitArtifact(ctx, 'created', created)
        return { success: true, result: jsonOk({ message: 'Artefato salvo.', artifactId: created.id, name: created.name, version: created.version }) }
      }

      if (toolName === 'update_artifact') {
        const parentId = String(args.artifactId || '')
        const content = String(args.content ?? '')
        if (!parentId || !content) return { success: false, result: jsonErr('"artifactId" e "content" são obrigatórios') }
        const parent = await prisma.aIArtifact.findFirst({ where: { id: parentId, companyId } })
        if (!parent) return { success: false, result: jsonErr('Artefato pai não encontrado', 'not_found') }

        // Próxima versão = max(versões existentes da cadeia) + 1
        const latest = await prisma.aIArtifact.findFirst({
          where: { companyId, OR: [{ id: parent.id }, { parentArtifactId: parent.parentArtifactId || parent.id }] },
          orderBy: { version: 'desc' },
        })
        const nextVersion = (latest?.version || parent.version) + 1

        const created = await prisma.aIArtifact.create({
          data: {
            companyId, agentId: agentId || parent.agentId, sessionId: sessionId || null, remoteJid: remoteJid || parent.remoteJid,
            name: parent.name, type: parent.type, mimeType: parent.mimeType,
            content,
            description: args.changeNote ? String(args.changeNote).substring(0, 500) : parent.description,
            version: nextVersion,
            parentArtifactId: parent.parentArtifactId || parent.id,
            metadata: args.changeNote ? { changeNote: String(args.changeNote) } : undefined,
          },
        })
        emitArtifact(ctx, 'updated', created)
        return { success: true, result: jsonOk({ message: 'Nova versão criada.', artifactId: created.id, version: created.version }) }
      }

      if (toolName === 'list_artifacts') {
        const where: any = { companyId }
        if (args.scope === 'agent_all') {
          if (agentId) where.agentId = agentId
        } else {
          if (remoteJid) where.remoteJid = remoteJid
        }
        if (args.type) where.type = args.type
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50)
        const list = await prisma.aIArtifact.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit })
        return {
          success: true,
          result: jsonOk({
            count: list.length,
            artifacts: list.map(a => ({
              id: a.id, name: a.name, type: a.type, version: a.version, status: a.status,
              description: a.description, parentArtifactId: a.parentArtifactId,
              createdAt: a.createdAt, contentPreview: a.content.substring(0, 200),
            })),
          }),
        }
      }

      if (toolName === 'get_artifact') {
        const id = String(args.artifactId || '')
        if (!id) return { success: false, result: jsonErr('"artifactId" é obrigatório') }
        const a = await prisma.aIArtifact.findFirst({ where: { id, companyId } })
        if (!a) return { success: false, result: jsonErr('Artefato não encontrado', 'not_found') }
        return { success: true, result: jsonOk({ artifact: { id: a.id, name: a.name, type: a.type, mimeType: a.mimeType, version: a.version, content: a.content, description: a.description, metadata: a.metadata } }) }
      }

      return { success: false, result: jsonErr(`Tool ${toolName} desconhecida`, 'tool_not_found') }
    } catch (err) {
      const msg = (err as Error).message
      console.error('[ArtifactTool] Falha:', msg)
      return { success: false, result: jsonErr(msg) }
    }
  },
}
