import { prisma } from '../../config/database.js'
import { Flow, FlowNode, FlowSession, FlowNodeType } from '@prisma/client'
import { trackTokenUsage } from '../ai/token-tracker.js'
import * as vm from 'vm'

interface MessageContext {
  instanceId: string
  remoteJid: string
  message: string
  messageType: 'text' | 'button_reply' | 'list_reply' | 'image' | 'audio' | 'video' | 'document'
  buttonId?: string
  listRowId?: string
  quotedMessageId?: string
  pushName?: string // Nome do contato no WhatsApp
}

interface SendMessageFn {
  (to: string, content: any, type: string): Promise<void>
}

type FlowWithRelations = Flow & {
  nodes: FlowNode[]
  edges: Array<{
    id: string
    sourceNodeId: string
    targetNodeId: string
    sourceHandle: string | null
    targetHandle: string | null
    label?: string | null
    condition: any
  }>
}

type SessionWithFlow = FlowSession & {
  flow: FlowWithRelations
}

const FLOW_MEDIA_NODE_TYPES = new Set<string>(['IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT'])
const FLOW_INTERACTIVE_WAIT_NODE_TYPES = new Set<string>(['BUTTONS', 'CAROUSEL', 'LIST', 'MENU'])
const FLOW_BUTTON_TYPES = new Set<string>(['reply', 'url', 'copy', 'call', 'pix'])
const FLOW_CAROUSEL_BUTTON_TYPES = new Set<string>(['reply', 'url', 'copy', 'call'])
const FLOW_INTERACTIVE_HISTORY_LIMIT = 10
const FLOW_RECENT_INTERACTIVE_SESSION_MS = 30 * 60 * 1000
const FLOW_EXECUTION_TRACE_LIMIT = 100

type FlowRoutingEdge = {
  targetNodeId: string
  sourceHandle?: string | null
  sourceNodeId?: string | null
}

type FlowRoutingNode = {
  id: string
  type: FlowNodeType | string
  data: any
}

type FlowInteractiveRoute = {
  sourceNodeId: string
  outputHandle: string
  targetNodeIds: string[]
}

type FlowInteractiveContext = {
  message: string
  messageType: string
  buttonId?: string
  listRowId?: string
}

export function appendFlowExecutionTrace(
  context: any,
  nodeId: string,
  at: Date = new Date()
): Record<string, any> {
  const baseContext =
    context && typeof context === 'object' && !Array.isArray(context)
      ? { ...context }
      : {}
  const trace = Array.isArray(baseContext.executionTrace)
    ? baseContext.executionTrace
    : []

  return {
    ...baseContext,
    executionTrace: [
      ...trace,
      { nodeId, at: at.toISOString() },
    ].slice(-FLOW_EXECUTION_TRACE_LIMIT),
  }
}

function cloneFlowExecutionJson(value: any): any {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

export function buildFlowExecutionSnapshot(flow: Pick<FlowWithRelations, 'nodes' | 'edges'>) {
  return {
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      positionX: node.positionX,
      positionY: node.positionY,
      data: cloneFlowExecutionJson(node.data),
    })),
    edges: flow.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      condition: cloneFlowExecutionJson(edge.condition),
    })),
  }
}

export function isFlowKeywordTriggerMessage(
  triggerType: string | null | undefined,
  triggerValue: string | null | undefined,
  message: string
): boolean {
  if (triggerType !== 'KEYWORD' || !triggerValue) return false

  const keywords = triggerValue.split(',').map((keyword: string) => keyword.trim().toLowerCase()).filter(Boolean)
  const msgLower = message.toLowerCase().trim()
  return keywords.some((keyword: string) => msgLower === keyword || msgLower.startsWith(keyword + ' '))
}

export function getRequiredFlowMediaUrl(data: Record<string, any>): string | null {
  const mediaUrl = data?.mediaUrl
  if (typeof mediaUrl !== 'string') return null

  const trimmed = mediaUrl.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function shouldSkipFlowMediaNode(nodeType: FlowNodeType | string, data: Record<string, any>): boolean {
  return FLOW_MEDIA_NODE_TYPES.has(String(nodeType)) && !getRequiredFlowMediaUrl(data)
}

export function shouldKeepFlowSessionWaitingOnMissingEdge(
  nodeType: FlowNodeType | string,
  outputHandle?: string | null
): boolean {
  const clean = typeof outputHandle === 'string' ? outputHandle.trim() : ''
  return !!clean && FLOW_INTERACTIVE_WAIT_NODE_TYPES.has(String(nodeType))
}

function cleanFlowHandleValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getNestedFlowValue(obj: any, path: string): any {
  if (!obj || !path) return undefined

  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }

  return current
}

function replaceFlowVariablesForMatch(text: unknown, variables: Record<string, any>): string {
  if (typeof text !== 'string') return ''

  return text.replace(/\{\{([\w.]+)\}\}/g, (match, varPath) => {
    const value = getNestedFlowValue(variables, varPath)
    return value !== undefined ? String(value) : match
  })
}

function uniqueFlowHandleCandidates(values: unknown[]): string[] {
  return values
    .map(cleanFlowHandleValue)
    .filter((value, index, all) => value && all.indexOf(value) === index)
}

function resolveOptionHandleByIdOrTitle(
  options: Array<{ id: unknown; title: unknown }>,
  candidates: string[],
  variables: Record<string, any>
): string | undefined {
  for (const candidate of candidates) {
    const idMatch = options.find(option => cleanFlowHandleValue(option.id) === candidate)
    const id = cleanFlowHandleValue(idMatch?.id)
    if (id) return id
  }

  for (const candidate of candidates) {
    const titleMatches = options.filter(option =>
      cleanFlowHandleValue(replaceFlowVariablesForMatch(option.title, variables)) === candidate
    )
    if (titleMatches.length === 1) {
      const id = cleanFlowHandleValue(titleMatches[0].id)
      if (id) return id
    }
  }

  return candidates[0]
}

function getFlowButtonType(button: any): string {
  const type = cleanFlowHandleValue(button?.buttonType || button?.type).toLowerCase()
  return FLOW_BUTTON_TYPES.has(type) ? type : 'reply'
}

function getFlowButtonText(button: any): string {
  return cleanFlowHandleValue(
    button?.text ||
    button?.displayText ||
    button?.title ||
    button?.buttonText?.displayText
  )
}

function getFlowCarouselButtonType(button: any): string {
  const rawType = cleanFlowHandleValue(button?.buttonType || button?.type).toLowerCase()
  return FLOW_CAROUSEL_BUTTON_TYPES.has(rawType) ? rawType : 'reply'
}

function getFlowCarouselButtonText(button: any): string {
  return cleanFlowHandleValue(
    button?.displayText ||
    button?.text ||
    button?.title ||
    button?.buttonText?.displayText
  )
}

function getFlowCarouselCards(data: Record<string, any>): any[] {
  return Array.isArray(data.carouselCards)
    ? data.carouselCards
    : Array.isArray(data.cards)
      ? data.cards
      : []
}

export function hasFlowReplyButtons(buttons: any[]): boolean {
  return (Array.isArray(buttons) ? buttons : []).some(button => getFlowButtonType(button) === 'reply')
}

export function hasFlowCarouselReplyButtons(cards: any[]): boolean {
  return (Array.isArray(cards) ? cards : []).some(card =>
    (Array.isArray(card?.buttons) ? card.buttons : []).some((button: any) => getFlowCarouselButtonType(button) === 'reply')
  )
}

export function normalizeFlowButtons(
  buttons: any[],
  replaceValue: (value: string) => string = value => value
): any[] {
  return (Array.isArray(buttons) ? buttons : [])
    .map((button, index) => {
      const type = getFlowButtonType(button)

      if (type === 'pix') {
        return {
          type: 'pix',
          currency: replaceValue(cleanFlowHandleValue(button.currency || 'BRL')),
          name: replaceValue(cleanFlowHandleValue(button.name)),
          keyType: cleanFlowHandleValue(button.keyType || 'random'),
          key: replaceValue(cleanFlowHandleValue(button.key)),
        }
      }

      const displayText = replaceValue(getFlowButtonText(button))
      if (!displayText) return null

      const id = cleanFlowHandleValue(button.id || button.buttonId) || `btn_${index + 1}`

      if (type === 'reply') return { type: 'reply', displayText, id }
      if (type === 'url') return { type: 'url', displayText, url: replaceValue(cleanFlowHandleValue(button.url)) }
      if (type === 'copy') {
        return {
          type: 'copy',
          displayText,
          copyCode: replaceValue(cleanFlowHandleValue(button.copyCode || button.copy_code || id)),
        }
      }
      if (type === 'call') return { type: 'call', displayText, phoneNumber: replaceValue(cleanFlowHandleValue(button.phoneNumber)) }

      return null
    })
    .filter(Boolean)
}

export function normalizeFlowCarouselCards(
  cards: any[],
  replaceValue: (value: string) => string = value => value
): any[] {
  return (Array.isArray(cards) ? cards : [])
    .slice(0, 10)
    .map((card) => {
      const title = replaceValue(cleanFlowHandleValue(card?.header?.title || card?.title))
      const subtitle = replaceValue(cleanFlowHandleValue(card?.header?.subtitle || card?.subtitle))
      const imageUrl = replaceValue(cleanFlowHandleValue(card?.header?.imageUrl || card?.imageUrl))
      const videoUrl = replaceValue(cleanFlowHandleValue(card?.header?.videoUrl || card?.videoUrl))
      const bodyText = replaceValue(cleanFlowHandleValue(card?.body?.text || card?.text || card?.body))
      if (!bodyText) return null

      const header: Record<string, string> = {}
      if (title) header.title = title
      if (subtitle) header.subtitle = subtitle
      if (imageUrl) header.imageUrl = imageUrl
      if (!imageUrl && videoUrl) header.videoUrl = videoUrl

      const buttons = (Array.isArray(card?.buttons) ? card.buttons : [])
        .slice(0, 3)
        .map((button: any, index: number) => {
          const type = getFlowCarouselButtonType(button)
          const displayText = replaceValue(getFlowCarouselButtonText(button))
          if (!displayText) return null

          const id = replaceValue(cleanFlowHandleValue(button.id || button.buttonId)) || `card_btn_${index + 1}`
          if (type === 'reply') return { type: 'REPLY', displayText, id }
          if (type === 'url') {
            const url = replaceValue(cleanFlowHandleValue(button.url || button.id))
            return url ? { type: 'URL', displayText, id: url } : null
          }
          if (type === 'call') {
            const phoneNumber = replaceValue(cleanFlowHandleValue(button.phoneNumber || button.id))
            return phoneNumber ? { type: 'CALL', displayText, id: phoneNumber } : null
          }
          if (type === 'copy') {
            const copyCode = replaceValue(cleanFlowHandleValue(button.copyCode || button.copy_code || button.id))
            return copyCode ? { type: 'COPY', displayText, copyCode } : null
          }

          return null
        })
        .filter(Boolean)

      const normalizedCard: Record<string, any> = {
        header,
        body: { text: bodyText },
      }
      const footer = replaceValue(cleanFlowHandleValue(card?.footer))
      if (footer) normalizedCard.footer = footer
      if (buttons.length > 0) normalizedCard.buttons = buttons
      return normalizedCard
    })
    .filter(Boolean)
}

export function buildFlowButtonMessage(
  data: Record<string, any>,
  replaceValue: (value: string) => string = value => value
): { type: 'buttons' | 'pix'; content: any; waitForInput: boolean } {
  const buttons = normalizeFlowButtons(data.buttons || [], replaceValue)
  const pixButton = buttons.find(button => button?.type === 'pix')

  if (pixButton) {
    return {
      type: 'pix',
      content: {
        pixKey: pixButton.key,
        keyType: pixButton.keyType || 'random',
        merchantName: pixButton.name,
        headerTitle: data.header ? replaceValue(String(data.header)) : undefined,
        bodyText: undefined,
        footerText: undefined,
      },
      waitForInput: false,
    }
  }

  return {
    type: 'buttons',
    content: {
      text: replaceValue(String(data.content || '')),
      buttons,
      footer: data.footer ? replaceValue(String(data.footer)) : undefined,
      header: data.header ? replaceValue(String(data.header)) : undefined,
    },
    waitForInput: hasFlowReplyButtons(data.buttons || []),
  }
}

export function buildFlowCarouselMessage(
  data: Record<string, any>,
  replaceValue: (value: string) => string = value => value
): { type: 'carousel'; content: any; waitForInput: boolean } {
  const rawCards = getFlowCarouselCards(data)
  const cards = normalizeFlowCarouselCards(rawCards, replaceValue)
  return {
    type: 'carousel',
    content: {
      body: replaceValue(String(data.content || data.body || '')),
      footer: data.footer ? replaceValue(String(data.footer)) : '',
      cards,
    },
    waitForInput: hasFlowCarouselReplyButtons(rawCards),
  }
}

export function resolveFlowInteractiveOutputHandle(
  nodeType: FlowNodeType | string,
  data: Record<string, any>,
  context: FlowInteractiveContext,
  variables: Record<string, any> = {}
): string | undefined {
  const type = String(nodeType)

  if (type === 'LIST' && (context.messageType === 'list_reply' || context.listRowId)) {
    const rows = (data.listSections || []).flatMap((section: any) =>
      (section.rows || []).map((row: any) => ({ id: row.id, title: row.title }))
    )
    const candidates = uniqueFlowHandleCandidates([context.listRowId, context.message])
    return resolveOptionHandleByIdOrTitle(rows, candidates, variables)
  }

  if (type === 'BUTTONS' && (context.messageType === 'button_reply' || context.buttonId)) {
    const buttons = (data.buttons || [])
      .filter((button: any) => getFlowButtonType(button) === 'reply')
      .map((button: any) => ({ id: button.id, title: button.text }))
    const candidates = uniqueFlowHandleCandidates([context.buttonId, context.message])
    return resolveOptionHandleByIdOrTitle(buttons, candidates, variables)
  }

  if (type === 'CAROUSEL' && (context.messageType === 'button_reply' || context.buttonId)) {
    const buttons = getFlowCarouselCards(data)
      .flatMap((card: any) => Array.isArray(card?.buttons) ? card.buttons : [])
      .filter((button: any) => getFlowCarouselButtonType(button) === 'reply')
      .map((button: any) => ({
        id: button.id || button.buttonId,
        title: button.text || button.displayText || button.title,
      }))
    const candidates = uniqueFlowHandleCandidates([context.buttonId, context.message])
    return resolveOptionHandleByIdOrTitle(buttons, candidates, variables)
  }

  const buttonId = cleanFlowHandleValue(context.buttonId)
  if (buttonId) return buttonId

  const listRowId = cleanFlowHandleValue(context.listRowId)
  if (listRowId) return listRowId

  return undefined
}

function getFlowOutputHandleCandidates(outputHandle: string): string[] {
  const cleanHandle = outputHandle.trim()
  const candidates = [cleanHandle]

  if (cleanHandle.startsWith('right-')) {
    candidates.push(cleanHandle.slice(6))
  } else {
    candidates.push(`right-${cleanHandle}`)
  }

  if (cleanHandle !== 'fallback') {
    candidates.push('fallback', 'right-fallback')
  }

  return candidates.filter((candidate, index, all) => candidate && all.indexOf(candidate) === index)
}

export function resolveFlowNextNodeIds(edges: FlowRoutingEdge[], outputHandle?: string | null): string[] {
  if (edges.length === 0) return []

  const cleanHandle = typeof outputHandle === 'string' ? outputHandle.trim() : ''
  if (!cleanHandle) {
    return edges
      .map(edge => edge.targetNodeId)
      .filter((targetNodeId, index, all) => targetNodeId && all.indexOf(targetNodeId) === index)
  }

  const candidates = getFlowOutputHandleCandidates(cleanHandle)
  return edges
    .filter(edge => edge.sourceHandle && candidates.includes(edge.sourceHandle))
    .map(edge => edge.targetNodeId)
    .filter((targetNodeId, index, all) => targetNodeId && all.indexOf(targetNodeId) === index)
}

export function resolveFlowNextNodeId(edges: FlowRoutingEdge[], outputHandle?: string | null): string | null {
  return resolveFlowNextNodeIds(edges, outputHandle)[0] || null
}

export function resolveFlowInteractiveRoute(
  nodes: FlowRoutingNode[],
  edges: FlowRoutingEdge[],
  context: FlowInteractiveContext,
  variables: Record<string, any> = {},
  candidateSourceNodeIds?: string[]
): FlowInteractiveRoute | null {
  const candidateIdSet = candidateSourceNodeIds?.length ? new Set(candidateSourceNodeIds) : null
  const routes: FlowInteractiveRoute[] = []

  for (const node of nodes) {
    if (candidateIdSet && !candidateIdSet.has(node.id)) continue

    const outputHandle = resolveFlowInteractiveOutputHandle(node.type, node.data || {}, context, variables)
    if (!outputHandle) continue

    const targetNodeIds = resolveFlowNextNodeIds(
      edges.filter(edge => edge.sourceNodeId === node.id),
      outputHandle
    )

    if (targetNodeIds.length > 0) {
      routes.push({ sourceNodeId: node.id, outputHandle, targetNodeIds })
    }
  }

  return routes.length === 1 ? routes[0] : null
}

export class FlowEngine {
  private sendMessage: SendMessageFn

  constructor(sendMessage: SendMessageFn) {
    this.sendMessage = sendMessage
  }

  async processMessage(context: MessageContext): Promise<boolean> {
    const { instanceId, remoteJid, message, messageType, buttonId, listRowId, pushName } = context

    // Check for active session first
    let session = await this.getActiveSession(instanceId, remoteJid)

    if (session && session.waitingInput) {
      if (isFlowKeywordTriggerMessage(session.flow.triggerType, session.flow.triggerValue, message)) {
        const initialVars = {
          _contactName: pushName || '',
          _contactPhone: remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', ''),
          _triggerMessage: message,
        }
        session = await this.startSession(session.flow, instanceId, remoteJid, initialVars)
        await this.executeFlow(session)
        return true
      }

      // Continue existing flow
      await this.continueFlow(session, context)
      return true
    }

    if (!session && this.isInteractiveReplyContext(context)) {
      const recentSession = await this.getRecentInteractiveSession(instanceId, remoteJid)
      if (recentSession && await this.resumeRecentInteractiveSession(recentSession, context)) {
        return true
      }
    }

    // Look for matching flow trigger
    const flow = await this.findMatchingFlow(instanceId, message, messageType, buttonId, listRowId)

    if (!flow) {
      return false // No flow matched
    }

    // Start new flow session with initial variables
    const initialVars = {
      _contactName: pushName || '',
      _contactPhone: remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', ''),
      _triggerMessage: message,
    }
    session = await this.startSession(flow, instanceId, remoteJid, initialVars)

    await this.executeFlow(session)

    return true
  }

  private async getActiveSession(instanceId: string, remoteJid: string): Promise<SessionWithFlow | null> {
    const session = await prisma.flowSession.findFirst({
      where: {
        instanceId,
        remoteJid,
        isActive: true,
      },
      include: {
        flow: {
          include: {
            nodes: true,
            edges: true,
          },
        },
      },
      orderBy: { lastActivity: 'desc' },
    })

    return session as SessionWithFlow | null
  }

  private isInteractiveReplyContext(context: MessageContext): boolean {
    return context.messageType === 'button_reply' || context.messageType === 'list_reply' || !!context.buttonId || !!context.listRowId
  }

  private async getRecentInteractiveSession(instanceId: string, remoteJid: string): Promise<SessionWithFlow | null> {
    const session = await prisma.flowSession.findFirst({
      where: {
        instanceId,
        remoteJid,
        isActive: false,
        completedAt: {
          gte: new Date(Date.now() - FLOW_RECENT_INTERACTIVE_SESSION_MS),
        },
      },
      include: {
        flow: {
          include: {
            nodes: true,
            edges: true,
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    })

    return session as SessionWithFlow | null
  }

  private getInteractiveHistoryNodeIds(session: SessionWithFlow): string[] {
    const history = (session.context as any)?.interactiveNodes
    if (!Array.isArray(history)) return []

    return history
      .map((item: any) => typeof item === 'string' ? item : item?.nodeId)
      .filter((nodeId: any, index: number, all: any[]) => typeof nodeId === 'string' && nodeId && all.indexOf(nodeId) === index)
  }

  private rememberInteractiveNode(session: SessionWithFlow, node: FlowNode): void {
    const context = { ...((session.context as any) || {}) }
    const currentHistory = Array.isArray(context.interactiveNodes) ? context.interactiveNodes : []
    const withoutCurrent = currentHistory.filter((item: any) => (typeof item === 'string' ? item : item?.nodeId) !== node.id)

    context.interactiveNodes = [
      ...withoutCurrent,
      { nodeId: node.id, type: String(node.type), at: new Date().toISOString() },
    ].slice(-FLOW_INTERACTIVE_HISTORY_LIMIT)

    session.context = context
  }

  private resolveSessionInteractiveRoute(session: SessionWithFlow, context: MessageContext): FlowInteractiveRoute | null {
    const variables = (session.variables || {}) as Record<string, any>
    const historyNodeIds = this.getInteractiveHistoryNodeIds(session)

    return resolveFlowInteractiveRoute(
      session.flow.nodes,
      session.flow.edges,
      context,
      variables,
      historyNodeIds.length > 0 ? historyNodeIds : undefined
    )
  }

  private async resumeRecentInteractiveSession(session: SessionWithFlow, context: MessageContext): Promise<boolean> {
    const route = this.resolveSessionInteractiveRoute(session, context)
    if (!route) return false

    const variables = (session.variables || {}) as Record<string, any>
    variables['_lastInput'] = context.message
    variables['_lastInputType'] = context.messageType
    if (context.messageType === 'button_reply' || context.buttonId) variables['_buttonId'] = route.outputHandle
    if (context.messageType === 'list_reply' || context.listRowId) variables['_listRowId'] = route.outputHandle
    session.variables = variables

    await prisma.flowSession.update({
      where: { id: session.id },
      data: {
        currentNodeId: route.sourceNodeId,
        waitingInput: false,
        isActive: true,
        completedAt: null,
        lastActivity: new Date(),
        variables: session.variables as any,
        context: session.context as any,
      },
    })

    await this.executeFlow(session, route.targetNodeIds)
    return true
  }

  private async markCurrentExecutionNode(session: SessionWithFlow, nodeId: string): Promise<void> {
    const now = new Date()
    const context = appendFlowExecutionTrace(session.context, nodeId, now)

    session.currentNodeId = nodeId
    session.context = context as any

    await prisma.flowSession.update({
      where: { id: session.id },
      data: {
        currentNodeId: nodeId,
        waitingInput: false,
        isActive: true,
        lastActivity: now,
        variables: session.variables as any,
        context: session.context as any,
      },
    })
  }

  private async findNextNodes(
    session: SessionWithFlow,
    currentNode: FlowNode,
    outputHandle?: string
  ): Promise<string[]> {
    const edges = session.flow.edges.filter(e => e.sourceNodeId === currentNode.id)

    if (edges.length === 0) return []

    const nextNodeIds = resolveFlowNextNodeIds(edges, outputHandle)
    if (nextNodeIds.length === 0 && outputHandle) {
      console.warn(
        `[FlowEngine] Nenhuma aresta encontrada para handle "${outputHandle}" no node ${currentNode.id}; rota padrão não será usada.`
      )
    }
    return nextNodeIds
  }

  private async findMatchingFlow(
    instanceId: string,
    message: string,
    messageType: string,
    buttonId?: string,
    listRowId?: string
  ): Promise<FlowWithRelations | null> {
    // Get instance to find company
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      select: { companyId: true },
    })

    if (!instance) return null

    // Find active flows for this company - lightweight query (no nodes/edges)
    const flows = await prisma.flow.findMany({
      where: {
        companyId: instance.companyId,
        status: 'ACTIVE',
        OR: [
          { instanceId: null }, // Global flows
          { instanceId },       // Instance-specific flows
        ],
      },
      select: {
        id: true,
        triggerType: true,
        triggerValue: true,
        instanceId: true,
      },
      orderBy: [
        { instanceId: 'desc' }, // Instance-specific first
        { createdAt: 'asc' },
      ],
    })

    let matchedFlowId: string | null = null

    for (const flow of flows) {
      switch (flow.triggerType) {
        case 'KEYWORD':
          if (flow.triggerValue) {
            const keywords = flow.triggerValue.split(',').map((k: string) => k.trim().toLowerCase())
            const msgLower = message.toLowerCase().trim()
            if (keywords.some((k: string) => msgLower === k || msgLower.startsWith(k + ' '))) {
              matchedFlowId = flow.id
            }
          }
          break
        case 'ALL':
          if (messageType === 'text') matchedFlowId = flow.id
          break
        case 'BUTTON_REPLY':
          if (messageType === 'button_reply' && buttonId) {
            if (!flow.triggerValue || flow.triggerValue === buttonId) matchedFlowId = flow.id
          }
          break
        case 'LIST_REPLY':
          if (messageType === 'list_reply' && listRowId) {
            if (!flow.triggerValue || flow.triggerValue === listRowId) matchedFlowId = flow.id
          }
          break
      }
      if (matchedFlowId) break
    }

    if (!matchedFlowId) return null

    // Only load full flow (nodes + edges) for the matched flow
    const fullFlow = await prisma.flow.findUnique({
      where: { id: matchedFlowId },
      include: { nodes: true, edges: true },
    })

    return fullFlow as FlowWithRelations | null
  }

  private async startSession(
    flow: FlowWithRelations,
    instanceId: string,
    remoteJid: string,
    initialVars: Record<string, any> = {}
  ): Promise<SessionWithFlow> {
    // End any existing active sessions for this user
    await prisma.flowSession.updateMany({
      where: {
        instanceId,
        remoteJid,
        isActive: true,
      },
      data: {
        isActive: false,
        completedAt: new Date(),
        lastActivity: new Date(),
      },
    })

    // Find start node
    const startNode = flow.nodes.find(n => n.type === 'START')

    const session = await prisma.flowSession.create({
      data: {
        flowId: flow.id,
        instanceId,
        remoteJid,
        currentNodeId: startNode?.id,
        variables: initialVars,
        context: {
          flowSnapshot: buildFlowExecutionSnapshot(flow),
        },
      },
      include: {
        flow: {
          include: {
            nodes: true,
            edges: true,
          },
        },
      },
    })

    return session as SessionWithFlow
  }

  private async executeFlow(session: SessionWithFlow, startNodeIds?: string[]): Promise<void> {
    const nodeQueue = startNodeIds?.length ? [...startNodeIds] : session.currentNodeId ? [session.currentNodeId] : []
    let waitingNodeId: string | null = null

    while (nodeQueue.length > 0) {
      const currentNodeId = nodeQueue.shift()
      if (!currentNodeId) continue

      const currentNode = session.flow.nodes.find(n => n.id === currentNodeId)
      if (!currentNode) continue

      await this.markCurrentExecutionNode(session, currentNodeId)
      const result = await this.executeNode(session, currentNode)

      if (result.waitForInput) {
        if (waitingNodeId) {
          console.warn(
            `[FlowEngine] Mais de um node aguardando input no mesmo fan-out; mantendo o último node (${currentNodeId}).`
          )
        }
        waitingNodeId = currentNodeId
        continue
      }

      if (result.endFlow) {
        // End the session after the current node has already been recorded.
        await prisma.flowSession.update({
          where: { id: session.id },
          data: {
            isActive: false,
            completedAt: new Date(),
            lastActivity: new Date(),
            variables: session.variables as any,
            context: session.context as any,
          },
        })
        return
      }

      // Find next nodes after recording the current node for canvas replay.
      nodeQueue.push(...await this.findNextNodes(session, currentNode, result.outputHandle))
    }

    if (waitingNodeId) {
      // Update session to wait for input on the last node that requested it.
      await prisma.flowSession.update({
        where: { id: session.id },
        data: {
          currentNodeId: waitingNodeId,
          waitingInput: true,
          lastActivity: new Date(),
          variables: session.variables as any,
          context: session.context as any,
        },
      })
      return
    }

    // No more nodes, end session
    await prisma.flowSession.update({
      where: { id: session.id },
      data: {
        isActive: false,
        completedAt: new Date(),
        lastActivity: new Date(),
        variables: session.variables as any,
        context: session.context as any,
      },
    })
  }

  private async continueFlow(session: SessionWithFlow, context: MessageContext): Promise<void> {
    // Mark session as not waiting
    await prisma.flowSession.update({
      where: { id: session.id },
      data: { waitingInput: false, lastActivity: new Date() },
    })

    const currentNode = session.flow.nodes.find(n => n.id === session.currentNodeId)
    if (!currentNode) return

    // Process input and determine next node
    let outputHandle = await this.processInput(session, currentNode, context)

    // Find and execute next nodes
    let nextNodeIds = await this.findNextNodes(session, currentNode, outputHandle)

    if (nextNodeIds.length === 0 && this.isInteractiveReplyContext(context)) {
      const route = this.resolveSessionInteractiveRoute(session, context)
      if (route && route.sourceNodeId !== currentNode.id) {
        outputHandle = route.outputHandle
        nextNodeIds = route.targetNodeIds
        const variables = (session.variables || {}) as Record<string, any>
        if (context.messageType === 'button_reply' || context.buttonId) variables['_buttonId'] = route.outputHandle
        if (context.messageType === 'list_reply' || context.listRowId) variables['_listRowId'] = route.outputHandle
        session.variables = variables
        console.log(
          `[FlowEngine] Roteando clique de card anterior pelo node ${route.sourceNodeId} e handle "${route.outputHandle}".`
        )
      }
    }

    if (nextNodeIds.length > 0) {
      await this.executeFlow(session, nextNodeIds)
    } else if (shouldKeepFlowSessionWaitingOnMissingEdge(currentNode.type, outputHandle)) {
      // Keep the session on the same interactive node so another tap from the same WhatsApp card can continue.
      await prisma.flowSession.update({
        where: { id: session.id },
        data: {
          currentNodeId: currentNode.id,
          waitingInput: true,
          isActive: true,
          lastActivity: new Date(),
          variables: session.variables as any,
          context: session.context as any,
        },
      })
    } else {
      // End session
      await prisma.flowSession.update({
        where: { id: session.id },
        data: {
          isActive: false,
          completedAt: new Date(),
          lastActivity: new Date(),
          variables: session.variables as any,
          context: session.context as any,
        },
      })
    }
  }

  private async executeNode(
    session: SessionWithFlow,
    node: FlowNode
  ): Promise<{ waitForInput?: boolean; endFlow?: boolean; outputHandle?: string }> {
    const data = node.data as Record<string, any>
    const variables = (session.variables || {}) as Record<string, any>

    switch (String(node.type)) {
      case 'START':
        return {}

      case 'MESSAGE':
        const text = this.replaceVariables(data.content || '', variables)
        await this.sendMessage(session.remoteJid, { text }, 'text')
        if (data.waitForInput) {
          return { waitForInput: true }
        }
        return {}

      case 'IMAGE': {
        const imageUrl = getRequiredFlowMediaUrl(data)
        if (!imageUrl) {
          console.warn(`[FlowEngine] Nó IMAGE sem mediaUrl; ignorando node ${node.id}`)
          return {}
        }
        await this.sendMessage(session.remoteJid, {
          image: { url: imageUrl },
          caption: this.replaceVariables(data.content || '', variables),
        }, 'image')
        return {}
      }

      case 'AUDIO': {
        const audioUrl = getRequiredFlowMediaUrl(data)
        if (!audioUrl) {
          console.warn(`[FlowEngine] Nó AUDIO sem mediaUrl; ignorando node ${node.id}`)
          return {}
        }
        await this.sendMessage(session.remoteJid, {
          audio: { url: audioUrl },
          mimetype: 'audio/mp4',
        }, 'audio')
        return {}
      }

      case 'VIDEO': {
        const videoUrl = getRequiredFlowMediaUrl(data)
        if (!videoUrl) {
          console.warn(`[FlowEngine] Nó VIDEO sem mediaUrl; ignorando node ${node.id}`)
          return {}
        }
        await this.sendMessage(session.remoteJid, {
          video: { url: videoUrl },
          caption: this.replaceVariables(data.content || '', variables),
        }, 'video')
        return {}
      }

      case 'DOCUMENT': {
        const documentUrl = getRequiredFlowMediaUrl(data)
        if (!documentUrl) {
          console.warn(`[FlowEngine] Nó DOCUMENT sem mediaUrl; ignorando node ${node.id}`)
          return {}
        }
        await this.sendMessage(session.remoteJid, {
          document: { url: documentUrl },
          fileName: data.fileName || 'document',
          caption: this.replaceVariables(data.content || '', variables),
        }, 'document')
        return {}
      }

      case 'MENU':
        // Build text menu with numbered options
        const menuOptions = data.menuOptions || []
        let menuText = this.replaceVariables(data.content || '', variables)
        if (menuOptions.length > 0) {
          menuText += '\n\n'
          menuOptions.forEach((opt: any) => {
            menuText += `*${opt.trigger}* - ${this.replaceVariables(opt.label, variables)}\n`
          })
        }
        await this.sendMessage(session.remoteJid, { text: menuText.trim() }, 'text')
        // Save menu options in session context for later matching
        session.context = { ...(session.context as any || {}), menuOptions }
        this.rememberInteractiveNode(session, node)
        return { waitForInput: true }

      case 'BUTTONS':
        const buttonMessage = buildFlowButtonMessage(data, value => this.replaceVariables(value, variables))
        await this.sendMessage(session.remoteJid, buttonMessage.content, buttonMessage.type)
        if (buttonMessage.waitForInput) this.rememberInteractiveNode(session, node)
        return buttonMessage.waitForInput ? { waitForInput: true } : {}

      case 'CAROUSEL':
        const carouselMessage = buildFlowCarouselMessage(data, value => this.replaceVariables(value, variables))
        await this.sendMessage(session.remoteJid, carouselMessage.content, carouselMessage.type)
        if (carouselMessage.waitForInput) this.rememberInteractiveNode(session, node)
        return carouselMessage.waitForInput ? { waitForInput: true } : {}

      case 'LIST':
        const sections = (data.listSections || []).map((section: any) => ({
          title: this.replaceVariables(section.title, variables),
          rows: section.rows.map((row: any) => ({
            rowId: row.id,
            title: this.replaceVariables(row.title, variables),
            description: row.description ? this.replaceVariables(row.description, variables) : undefined,
          })),
        }))
        await this.sendMessage(session.remoteJid, {
          text: this.replaceVariables(data.content || '', variables),
          buttonText: data.buttonText || 'Menu',
          sections,
        }, 'list')
        this.rememberInteractiveNode(session, node)
        return { waitForInput: true }

      case 'CONDITION':
        // New switch/case format with multiple cases
        if (data.condition?.cases && data.condition.cases.length > 0) {
          const matchedCase = this.evaluateConditionCases(data.condition, variables)
          return { outputHandle: matchedCase }
        }
        // Old yes/no format (backwards compatible)
        const condResult = this.evaluateCondition(data.condition, variables)
        return { outputHandle: condResult ? 'yes' : 'no' }

      case 'DELAY':
        const delayMs = (data.delay || 1) * 1000
        await new Promise(resolve => setTimeout(resolve, delayMs))
        return {}

      case 'SET_VARIABLE':
        if (data.variable) {
          variables[data.variable] = this.replaceVariables(data.value || '', variables)
          session.variables = variables
        }
        return {}

      case 'HTTP_REQUEST':
        try {
          const response = await this.executeHttpRequest(data.httpConfig, variables)

          // Save full response if responseVariable is set (legacy)
          if (data.httpConfig?.responseVariable) {
            variables[data.httpConfig.responseVariable] = response
          }

          // Process response mappings - extract specific fields
          if (data.httpConfig?.responseMappings && Array.isArray(data.httpConfig.responseMappings)) {
            for (const mapping of data.httpConfig.responseMappings) {
              if (mapping.path && mapping.variable) {
                const value = this.getNestedValue(response, mapping.path)
                variables[mapping.variable] = value !== undefined ? value : null
              }
            }
          }

          session.variables = variables
        } catch (error) {
          console.error('HTTP request failed:', error)
        }
        return {}

      case 'GO_TO_FLOW':
        if (data.targetFlowId) {
          // End current session and start new flow
          const targetFlow = await prisma.flow.findUnique({
            where: { id: data.targetFlowId },
            include: { nodes: true, edges: true },
          })
          if (targetFlow) {
            await prisma.flowSession.update({
              where: { id: session.id },
              data: { isActive: false, completedAt: new Date() },
            })
            const newSession = await this.startSession(
              targetFlow as FlowWithRelations,
              session.instanceId,
              session.remoteJid
            )
            await this.executeFlow(newSession)
          }
        }
        return { endFlow: true }

      case 'TRANSFER':
        // For now, just end the flow. Transfer logic can be added later.
        await this.sendMessage(session.remoteJid, {
          text: data.content || 'Transferindo para um atendente...',
        }, 'text')
        return { endFlow: true }

      case 'END':
        if (data.content) {
          await this.sendMessage(session.remoteJid, {
            text: this.replaceVariables(data.content, variables),
          }, 'text')
        }
        // Send audit if configured on the END node
        await this.sendAuditFromNode(data, session, variables)
        return { endFlow: true }

      // ─── IA Nodes ────────────────────────────────────────

      case 'LLM': {
        const provider = data.provider || 'openai'
        const model = data.model || 'gpt-4o-mini'
        const prompt = this.replaceVariables(data.prompt || '', variables)
        const systemPrompt = this.replaceVariables(data.systemPrompt || '', variables)
        const temperature = data.temperature ?? 0.7
        const maxTokens = data.maxTokens ?? 1000

        try {
          // Buscar credencial do provider
          const credential = await prisma.aIProvider.findFirst({
            where: { companyId: session.flow.companyId, name: provider, isActive: true },
          })
          if (!credential) {
            await this.setVariable(session, data.outputVariable || 'llm_result', '[Erro: credencial IA não configurada]')
            return {}
          }

          const apiKey = credential.apiKey
          let result = ''
          let promptTokens = 0, completionTokens = 0, totalTokens = 0

          if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
            const baseUrls: Record<string, string> = {
              openai: 'https://api.openai.com/v1',
              groq: 'https://api.groq.com/openai/v1',
              openrouter: 'https://openrouter.ai/api/v1',
            }
            const res = await fetch(`${baseUrls[provider]}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                model,
                messages: [
                  ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                  { role: 'user', content: prompt },
                ],
                temperature,
                max_tokens: maxTokens,
              }),
            })
            const json = await res.json() as any
            result = json.choices?.[0]?.message?.content || ''
            promptTokens = json.usage?.prompt_tokens || 0
            completionTokens = json.usage?.completion_tokens || 0
            totalTokens = json.usage?.total_tokens || 0
          } else if (provider === 'anthropic') {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model,
                max_tokens: maxTokens,
                ...(systemPrompt ? { system: systemPrompt } : {}),
                messages: [{ role: 'user', content: prompt }],
              }),
            })
            const json = await res.json() as any
            result = json.content?.[0]?.text || ''
            promptTokens = json.usage?.input_tokens || 0
            completionTokens = json.usage?.output_tokens || 0
            totalTokens = promptTokens + completionTokens
          }

          await this.setVariable(session, data.outputVariable || 'llm_result', result)

          // Track token usage
          trackTokenUsage({
            companyId: session.flow.companyId,
            agentId: '__flow_engine__',
            instanceId: session.instanceId || '__flow__',
            model,
            promptTokens,
            completionTokens,
            totalTokens,
          }).catch(() => {})
        } catch (err) {
          console.error('[FlowEngine] LLM error:', err)
          await this.setVariable(session, data.outputVariable || 'llm_result', '[Erro ao chamar IA]')
        }
        return {}
      }

      case 'AI_AGENT': {
        // Delegar para agente IA existente — execução real via runAgent()
        const agentId = data.agentId
        const inputVariable = data.inputVariable || '_triggerMessage'
        const messageText = String(variables[inputVariable] || data.messageText || '')
        if (!agentId) {
          await this.setVariable(session, data.outputVariable || 'agent_result', '[Erro: agente não configurado]')
          return {}
        }
        try {
          const { runAgent } = await import('../ai/agent-builder.js')
          const companyId = session.flow.companyId
          const agentResult = await runAgent({
            agentId,
            context: { companyId, instanceId: session.instanceId, remoteJid: session.remoteJid, contactName: variables._contactName as string || '' },
            messages: [],
            messageText,
            sessionId: `flow:${session.id}`,
          })
          await this.setVariable(session, data.outputVariable || 'agent_result', agentResult.reply || '')
        } catch (err: any) {
          console.error('[FlowEngine] AI_AGENT error:', err.message)
          await this.setVariable(session, data.outputVariable || 'agent_result', `[Erro ao chamar agente: ${err.message}]`)
        }
        return {}
      }

      case 'KNOWLEDGE_RETRIEVAL': {
        const query = this.replaceVariables(data.query || '', variables)
        const agentId = data.agentId
        const companyId = session.flow.companyId
        if (!query) {
          await this.setVariable(session, data.outputVariable || 'rag_result', '')
          return {}
        }
        try {
          if (agentId) {
            // Busca via agente (usa knowledge bases vinculadas ao agente)
            const { retrieveForAgent } = await import('../ai/rag/retrieval.service.js')
            const result = await retrieveForAgent(agentId, companyId, query, { topK: data.topK || 5 })
            await this.setVariable(session, data.outputVariable || 'rag_result', result.formattedContext || '')
          } else {
            await this.setVariable(session, data.outputVariable || 'rag_result', '[Erro: configure o campo agentId no nó KNOWLEDGE_RETRIEVAL]')
          }
        } catch (err: any) {
          console.error('[FlowEngine] KNOWLEDGE_RETRIEVAL error:', err.message)
          await this.setVariable(session, data.outputVariable || 'rag_result', `[Erro RAG: ${err.message}]`)
        }
        return {}
      }

      case 'CODE': {
        // Executa código JS em sandbox isolado (node:vm) com timeout.
        // Acesso APENAS a `variables` (read) + `console.log` (capturado em logs).
        // SEM require, fs, process, network, child_process, etc.
        // data: { code: string, outputVariable?: string, timeoutMs?: number }
        const code = String(data.code || '')
        const timeoutMs = Math.min(Number(data.timeoutMs) || 3000, 10000)
        const logs: string[] = []
        try {
          const sandbox: any = {
            variables: JSON.parse(JSON.stringify(variables)), // cópia read-only-like
            console: {
              log: (...args: any[]) => logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')),
            },
            JSON,
            Math,
            Date,
            String,
            Number,
            Array,
            Object,
            Boolean,
            RegExp,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            __result: undefined,
          }
          const ctx = vm.createContext(sandbox)
          // Wrap em IIFE async para permitir await
          const wrapped = `(async () => { ${code} \n})().then(r => { __result = r })`
          const script = new vm.Script(wrapped)
          await script.runInContext(ctx, { timeout: timeoutMs, displayErrors: true })
          // Aguardar a promise interna concluir (timeout extra para a microtask)
          await new Promise(resolve => setImmediate(resolve))
          const result = sandbox.__result
          if (logs.length > 0) console.log('[FlowEngine][CODE] logs:', logs.join(' | '))
          await this.setVariable(session, data.outputVariable || 'code_result', result != null ? (typeof result === 'string' ? result : JSON.stringify(result)) : '')
        } catch (err: any) {
          console.error('[FlowEngine] CODE sandbox error:', err.message)
          await this.setVariable(session, data.outputVariable || 'code_result', `[Erro: ${err.message}]`)
        }
        return {}
      }

      case 'TEMPLATE': {
        const template = data.template || ''
        const result = this.replaceVariables(template, variables)
        await this.setVariable(session, data.outputVariable || 'template_result', result)
        return {}
      }

      case 'ITERATION': {
        // Itera sobre uma lista (variável array) e executa um sub-agente para cada item.
        // Expõe {item, index, total} no input do sub-agente.
        // data: {
        //   inputVariable: string (nome da var contendo array),
        //   itemTemplate: string (template com {{item}}, {{index}} para input do agente),
        //   agentId: string,
        //   outputVariable?: string (resultado: array de respostas),
        //   maxItems?: number (default 50, teto 200),
        //   stopOnError?: boolean,
        // }
        const inputVar = String(data.inputVariable || 'items')
        const itemTemplate = String(data.itemTemplate || 'Processe o item: {{item}}')
        const agentId = data.agentId as string | undefined
        const maxItems = Math.min(Number(data.maxItems) || 50, 200)
        const stopOnError = !!data.stopOnError

        if (!agentId) {
          await this.setVariable(session, data.outputVariable || 'iteration_results', '[Erro: configure agentId no nó ITERATION]')
          return {}
        }

        let items: any[] = []
        const raw = variables[inputVar]
        if (Array.isArray(raw)) items = raw
        else if (typeof raw === 'string') {
          try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) items = parsed } catch {}
        }

        if (items.length === 0) {
          await this.setVariable(session, data.outputVariable || 'iteration_results', JSON.stringify([]))
          return {}
        }

        const limited = items.slice(0, maxItems)
        const results: any[] = []
        const { runAgent } = await import('../ai/agent-builder.js')
        const ctx = { companyId: session.flow.companyId, instanceId: session.instanceId, remoteJid: session.remoteJid, contactName: String(variables._contactName || '') }

        for (let i = 0; i < limited.length; i++) {
          const item = limited[i]
          const itemStr = typeof item === 'string' ? item : JSON.stringify(item)
          const input = itemTemplate
            .replace(/\{\{\s*item\s*\}\}/g, itemStr)
            .replace(/\{\{\s*index\s*\}\}/g, String(i))
            .replace(/\{\{\s*total\s*\}\}/g, String(limited.length))
          try {
            const r = await runAgent({
              agentId,
              context: ctx,
              messages: [],
              messageText: input,
              sessionId: `flow:${session.id}:iter:${i}`,
            })
            results.push({ index: i, item, reply: r.reply || '', success: true })
          } catch (err: any) {
            console.error(`[FlowEngine] ITERATION item ${i} error:`, err.message)
            results.push({ index: i, item, error: err.message, success: false })
            if (stopOnError) break
          }
        }

        await this.setVariable(session, data.outputVariable || 'iteration_results', JSON.stringify(results))
        await this.setVariable(session, `${data.outputVariable || 'iteration_results'}_count`, results.length)
        return {}
      }

      case 'HUMAN_INPUT':
      case 'APPROVAL': {
        // Pausa o flow e aguarda input/aprovação humana via UI.
        // data: {
        //   formSchema?: any (HUMAN_INPUT) ou message?: string (APPROVAL),
        //   timeoutHours?: number (default 24, opcional),
        //   onTimeout?: 'approve' | 'reject' | 'continue' (default continue),
        //   outputVariable?: string (default 'human_input' ou 'approval'),
        // }
        // O FlowSession fica em waitingInput=true até alguém chamar a API
        // POST /api/flows/sessions/:id/human-input com { value, approved? }
        const outputVar = String(data.outputVariable || (node.type === 'APPROVAL' ? 'approval' : 'human_input'))
        const timeoutHours = Math.min(Math.max(Number(data.timeoutHours) || 24, 1), 168)
        const expiresAt = new Date(Date.now() + timeoutHours * 3600 * 1000)

        // Marcar sessão aguardando + emitir socket pra UI
        await prisma.flowSession.update({
          where: { id: session.id },
          data: {
            waitingInput: true,
            context: {
              ...(session.context as any || {}),
              awaitingHumanInput: {
                nodeId: node.id,
                nodeType: node.type,
                outputVariable: outputVar,
                formSchema: data.formSchema || null,
                message: data.message || (node.type === 'APPROVAL' ? 'Aprovação necessária' : 'Input necessário'),
                expiresAt: expiresAt.toISOString(),
                onTimeout: data.onTimeout || 'continue',
                createdAt: new Date().toISOString(),
              },
            } as any,
          },
        })

        // Notificar UI via socket (se houver)
        try {
          const { io } = await import('../../server.js')
          const { instanceRoom } = await import('../../config/socket-rooms.js')
          io.to(instanceRoom(session.flow.companyId, session.instanceId)).emit('flow-human-input-required', {
            sessionId: session.id,
            flowId: session.flowId,
            instanceId: session.instanceId,
            remoteJid: session.remoteJid,
            nodeId: node.id,
            nodeType: node.type,
            message: data.message || null,
            formSchema: data.formSchema || null,
            expiresAt: expiresAt.toISOString(),
          })
        } catch { /* socket pode não estar pronto */ }

        return { waitForInput: true }
      }

      case 'LOOP': {
        // Executa um sub-conjunto de nós repetidamente até condição ou maxIterations
        // data: { maxIterations: number, conditionVariable?: string, conditionValue?: string, subAgentId?: string, inputVariable?: string, outputVariable?: string }
        const maxIter = Math.min(Number(data.maxIterations) || 3, 10) // teto de 10 para evitar loops infinitos
        const inputVar = String(data.inputVariable || '_triggerMessage')
        const agentId = data.agentId as string | undefined
        if (!agentId) {
          await this.setVariable(session, data.outputVariable || 'loop_result', '[Erro: configure agentId no nó LOOP]')
          return {}
        }

        const { runAgent } = await import('../ai/agent-builder.js')
        let currentInput = String(variables[inputVar] || '')
        let lastReply = ''
        for (let i = 0; i < maxIter; i++) {
          try {
            const agentResult = await runAgent({
              agentId,
              context: { companyId: session.flow.companyId, instanceId: session.instanceId, remoteJid: session.remoteJid, contactName: String(variables._contactName || '') },
              messages: [],
              messageText: currentInput,
              sessionId: `flow:${session.id}:loop:${i}`,
            })
            lastReply = agentResult.reply || ''
            currentInput = lastReply
            // Verificar condição de parada
            if (data.stopCondition && lastReply.toLowerCase().includes(String(data.stopCondition).toLowerCase())) {
              break
            }
          } catch (err: any) {
            console.error(`[FlowEngine] LOOP iteration ${i} error:`, err.message)
            break
          }
        }
        await this.setVariable(session, data.outputVariable || 'loop_result', lastReply)
        return {}
      }

      case 'PARALLEL': {
        // Executa múltiplos sub-agentes em paralelo e combina as respostas
        // data: { agentIds: string[], inputVariable?: string, outputVariable?: string, combineMode?: 'concat' | 'json' }
        const agentIds = (data.agentIds as string[]) || []
        const inputVar = String(data.inputVariable || '_triggerMessage')
        const messageText = String(variables[inputVar] || '')
        const combineMode = String(data.combineMode || 'concat')

        if (agentIds.length === 0) {
          await this.setVariable(session, data.outputVariable || 'parallel_result', '[Erro: configure agentIds no nó PARALLEL]')
          return {}
        }

        const { runAgent } = await import('../ai/agent-builder.js')
        const context = { companyId: session.flow.companyId, instanceId: session.instanceId, remoteJid: session.remoteJid, contactName: String(variables._contactName || '') }

        const results = await Promise.allSettled(
          agentIds.map((agentId, i) =>
            runAgent({
              agentId,
              context,
              messages: [],
              messageText,
              sessionId: `flow:${session.id}:parallel:${i}`,
            })
          )
        )

        const replies = results.map((r, i) => {
          if (r.status === 'fulfilled') return r.value.reply || ''
          console.error(`[FlowEngine] PARALLEL agentId=${agentIds[i]} error:`, r.reason?.message)
          return `[Erro no agente ${i + 1}]`
        })

        let combined: string
        if (combineMode === 'json') {
          combined = JSON.stringify(replies)
        } else {
          combined = replies.join('\n\n---\n\n')
        }
        await this.setVariable(session, data.outputVariable || 'parallel_result', combined)
        return {}
      }

      case 'QUESTION_CLASSIFIER': {
        // Classifica a mensagem em uma das classes definidas e define variável com a classe
        // data: { classes: string[], agentId?: string, inputVariable?: string, outputVariable?: string }
        // Cada edge de saída deve ter sourceHandle igual ao nome da classe
        const classes = (data.classes as string[]) || []
        const inputVar = String(data.inputVariable || '_triggerMessage')
        const messageText = this.replaceVariables(String(variables[inputVar] || ''), variables)
        const outputVar = String(data.outputVariable || 'classified_intent')

        if (classes.length === 0) {
          await this.setVariable(session, outputVar, 'other')
          return {}
        }

        // Usar o agente configurado ou fazer uma chamada LLM direta via provider padrão
        let classified = 'other'
        try {
          if (data.agentId) {
            // Usar o provider do agente
            const { buildAgent } = await import('../ai/agent-builder.js')
            const built = await buildAgent(String(data.agentId), {
              companyId: session.flow.companyId,
              instanceId: session.instanceId,
              remoteJid: session.remoteJid,
              contactName: '',
            })
            const classListStr = classes.map((c, i) => `${i + 1}. ${c}`).join('\n')
            const prompt = `Você é um classificador de intenções. Classifique a mensagem abaixo em UMA das seguintes categorias. Responda APENAS com o nome exato da categoria, sem texto adicional.\n\nCategorias:\n${classListStr}\n\nMensagem: "${messageText}"\n\nResposta (apenas o nome da categoria):`
            const result = await built.provider.chat({
              model: built.model,
              messages: [{ role: 'user', content: prompt }],
              maxTokens: 50,
              temperature: 0,
              systemPrompt: 'Você classifica mensagens em categorias. Responda APENAS com o nome exato da categoria.',
            })
            const answer = (result.content || '').trim().toLowerCase()
            const match = classes.find(c => answer.includes(c.toLowerCase()))
            classified = match || 'other'
          }
        } catch (err: any) {
          console.error('[FlowEngine] QUESTION_CLASSIFIER error:', err.message)
        }
        await this.setVariable(session, outputVar, classified)
        return { outputHandle: classified }
      }

      // ─── CRM Nodes ──────────────────────────────────────

      case 'SEND_MESSAGE': {
        const to = this.replaceVariables(data.to || session.remoteJid, variables)
        const message = this.replaceVariables(data.message || '', variables)
        if (message) {
          await this.sendMessage(to, { text: message }, 'text')
        }
        return {}
      }

      case 'UPDATE_CONTACT': {
        const fields = data.contactFields || []
        try {
          const contact = await prisma.contact.findFirst({
            where: { phoneNumber: session.remoteJid.replace('@s.whatsapp.net', ''), companyId: session.flow.companyId },
          })
          if (contact) {
            const updateData: Record<string, any> = {}
            for (const f of fields) {
              const val = this.replaceVariables(f.value, variables)
              updateData[f.field] = val
            }
            await prisma.contact.update({ where: { id: contact.id }, data: updateData })
          }
        } catch (err) {
          console.error('[FlowEngine] UPDATE_CONTACT error:', err)
        }
        return {}
      }

      case 'ASSIGN_CONVERSATION': {
        try {
          const conversation = await prisma.conversation.findFirst({
            where: { contact: { phoneNumber: session.remoteJid.replace('@s.whatsapp.net', '') }, companyId: session.flow.companyId, status: { not: 'RESOLVED' } },
            orderBy: { updatedAt: 'desc' },
          })
          if (conversation) {
            const upd: Record<string, any> = {}
            if (data.assigneeId) upd.assigneeId = data.assigneeId
            if (data.teamId) upd.teamId = data.teamId
            await prisma.conversation.update({ where: { id: conversation.id }, data: upd })
          }
        } catch (err) {
          console.error('[FlowEngine] ASSIGN_CONVERSATION error:', err)
        }
        return {}
      }

      case 'ADD_TAG': {
        const tagName = this.replaceVariables(data.tagName || '', variables)
        if (!tagName) return {}
        try {
          const conversation = await prisma.conversation.findFirst({
            where: { contact: { phoneNumber: session.remoteJid.replace('@s.whatsapp.net', '') }, companyId: session.flow.companyId, status: { not: 'RESOLVED' } },
            orderBy: { updatedAt: 'desc' },
          })
          if (conversation) {
            // Find or create tag
            let tag = await prisma.label.findFirst({ where: { title: tagName, companyId: session.flow.companyId } })
            if (!tag) {
              tag = await prisma.label.create({ data: { title: tagName, color: '#6366f1', companyId: session.flow.companyId } })
            }
            // Add to conversation if not already there
            const existing = await prisma.conversationLabel.findFirst({
              where: { conversationId: conversation.id, labelId: tag.id },
            })
            if (!existing) {
              await prisma.conversationLabel.create({
                data: { conversationId: conversation.id, labelId: tag.id },
              })
            }
          }
        } catch (err) {
          console.error('[FlowEngine] ADD_TAG error:', err)
        }
        return {}
      }

      case 'MOVE_CARD': {
        try {
          const contact = await prisma.contact.findFirst({
            where: { phoneNumber: session.remoteJid.replace('@s.whatsapp.net', ''), companyId: session.flow.companyId },
          })
          if (contact && data.stageId) {
            const card = await prisma.card.findFirst({
              where: { contactId: contact.id, companyId: session.flow.companyId },
              orderBy: { updatedAt: 'desc' },
            })
            if (card) {
              await prisma.card.update({
                where: { id: card.id },
                data: { stageId: data.stageId },
              })
            }
          }
        } catch (err) {
          console.error('[FlowEngine] MOVE_CARD error:', err)
        }
        return {}
      }

      case 'CREATE_TASK': {
        try {
          const taskName = this.replaceVariables(data.taskTitle || 'Nova tarefa', variables)
          const description = this.replaceVariables(data.taskDescription || '', variables)
          await prisma.task.create({
            data: {
              name: taskName,
              description,
              companyId: session.flow.companyId,
              createdBy: 'flow-engine',
              status: 'NOT_STARTED',
            },
          })
        } catch (err) {
          console.error('[FlowEngine] CREATE_TASK error:', err)
        }
        return {}
      }

      case 'SEND_NOTIFICATION': {
        // Notificação interna — por enquanto logamos e salvamos como atividade
        try {
          const title = this.replaceVariables(data.notificationTitle || '', variables)
          const message = this.replaceVariables(data.notificationMessage || '', variables)
          console.log(`[FlowEngine] Notification: ${title} - ${message}`)
        } catch (err) {
          console.error('[FlowEngine] SEND_NOTIFICATION error:', err)
        }
        return {}
      }

      default:
        return {}
    }
  }

  private buildAuditVars(session: SessionWithFlow, variables: Record<string, any>): Record<string, any> {
    const now = new Date()
    const startedAt = session.createdAt
    const durationMs = now.getTime() - startedAt.getTime()
    const durationMin = Math.floor(durationMs / 60000)
    const durationSec = Math.floor((durationMs % 60000) / 1000)

    return {
      ...variables,
      _flowName: session.flow.name,
      _contactName: variables._contactName || '',
      _contactPhone: variables._contactPhone || '',
      _startedAt: startedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      _endedAt: now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      _duration: durationMin > 0 ? `${durationMin}min ${durationSec}s` : `${durationSec}s`,
    }
  }

  private async sendAuditFromNode(data: Record<string, any>, session: SessionWithFlow, variables: Record<string, any>): Promise<void> {
    const auditVars = this.buildAuditVars(session, variables)

    // 1. WhatsApp audit - send via baileysManager.sendTextMessage (uses @s.whatsapp.net, syncs to WhatsApp Web)
    if (data.auditEnabled && data.auditGroupJid) {
      try {
        const auditTemplate = data.auditMessage || ''
        if (auditTemplate) {
          const auditText = this.replaceVariables(auditTemplate, auditVars)
          const to = data.auditGroupJid.trim()
          // Use baileysManager directly via server export (proper @s.whatsapp.net JID, syncs WhatsApp Web)
          const server = await import('../../server.js')
          const manager = server.baileysManager
          if (manager) {
            await manager.sendTextMessage(session.instanceId, to, auditText)
            console.log(`[FlowEngine] WhatsApp audit sent to ${to} for session ${session.id}`)
          }
        }
      } catch (error: any) {
        console.error(`[FlowEngine] WhatsApp audit failed:`, error.message)
      }
    }

    // 2. Webhook HTTP audit
    if (data.auditWebhookEnabled && data.auditWebhookUrl) {
      try {
        const axios = (await import('axios')).default
        const url = this.replaceVariables(data.auditWebhookUrl, auditVars)
        const method = (data.auditWebhookMethod || 'POST').toUpperCase()

        // Parse headers
        let headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (data.auditWebhookHeaders) {
          try {
            const rawHeaders = this.replaceVariables(data.auditWebhookHeaders, auditVars)
            headers = { ...headers, ...JSON.parse(rawHeaders) }
          } catch (e) {
            console.error('[FlowEngine] Audit webhook headers parse error:', e)
          }
        }

        // Parse body
        let body: any = undefined
        if (data.auditWebhookBody && method !== 'GET') {
          try {
            const rawBody = this.replaceVariables(data.auditWebhookBody, auditVars)
            body = JSON.parse(rawBody)
          } catch (e) {
            // If not valid JSON, send as raw text
            body = this.replaceVariables(data.auditWebhookBody, auditVars)
          }
        }

        await axios({ method, url, headers, data: body, timeout: 15000 })
        console.log(`[FlowEngine] Webhook audit sent to ${url} for session ${session.id}`)
      } catch (error: any) {
        console.error(`[FlowEngine] Webhook audit failed:`, error.message)
      }
    }
  }

  private async processInput(
    session: SessionWithFlow,
    node: FlowNode,
    context: MessageContext
  ): Promise<string | undefined> {
    const data = node.data as Record<string, any>
    const variables = (session.variables || {}) as Record<string, any>
    const sessionContext = (session.context || {}) as Record<string, any>

    // Save the user's response
    variables['_lastInput'] = context.message
    variables['_lastInputType'] = context.messageType

    const interactiveOutputHandle = resolveFlowInteractiveOutputHandle(node.type, data, context, variables)
    if (interactiveOutputHandle) {
      if (context.messageType === 'button_reply' || context.buttonId) {
        variables['_buttonId'] = interactiveOutputHandle
      }
      if (context.messageType === 'list_reply' || context.listRowId) {
        variables['_listRowId'] = interactiveOutputHandle
      }
      session.variables = variables
      return interactiveOutputHandle
    }

    // Handle MESSAGE node with waitForInput - save response to variable
    if (node.type === 'MESSAGE' && data.waitForInput && data.inputVariable) {
      variables[data.inputVariable] = context.message.trim()
      session.variables = variables
      return undefined
    }

    // Handle MENU node - match user input against menu options
    if (node.type === 'MENU') {
      const menuOptions = sessionContext.menuOptions || data.menuOptions || []
      const userInput = context.message.trim().toLowerCase()

      // Find matching option
      const matchedOption = menuOptions.find((opt: any) =>
        opt.trigger.toLowerCase() === userInput
      )

      if (matchedOption) {
        variables['_menuSelection'] = matchedOption.trigger
        variables['_menuLabel'] = matchedOption.label
        session.variables = variables
        return matchedOption.id // Return option ID as output handle
      }

      // No match - return fallback
      session.variables = variables
      return 'fallback'
    }

    session.variables = variables
    return undefined
  }

  private async findNextNode(
    session: SessionWithFlow,
    currentNode: FlowNode,
    outputHandle?: string
  ): Promise<string | null> {
    // Find edges from current node
    const edges = session.flow.edges.filter(e => e.sourceNodeId === currentNode.id)

    if (edges.length === 0) return null

    return resolveFlowNextNodeId(edges, outputHandle) || edges[0].targetNodeId
  }

  private replaceVariables(text: string, variables: Record<string, any>): string {
    // Support both simple variables {{var}} and nested {{var.field.subfield}}
    return text.replace(/\{\{([\w.]+)\}\}/g, (match, varPath) => {
      const value = this.getNestedValue(variables, varPath)
      return value !== undefined ? String(value) : match
    })
  }

  private async setVariable(session: SessionWithFlow, name: string, value: any): Promise<void> {
    const variables = (session.variables || {}) as Record<string, any>
    variables[name] = value
    session.variables = variables
  }

  // Get nested value from object using dot notation (e.g., "data.user.name")
  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined

    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = current[part]
    }

    return current
  }

  private evaluateCondition(
    condition: { variable: string; operator: string; value?: string },
    variables: Record<string, any>
  ): boolean {
    if (!condition) return false

    const varValue = String(variables[condition.variable] || '')
    const compareValue = condition.value || ''

    switch (condition.operator) {
      case 'equals':
        return varValue.toLowerCase() === compareValue.toLowerCase()
      case 'contains':
        return varValue.toLowerCase().includes(compareValue.toLowerCase())
      case 'startsWith':
        return varValue.toLowerCase().startsWith(compareValue.toLowerCase())
      case 'endsWith':
        return varValue.toLowerCase().endsWith(compareValue.toLowerCase())
      case 'regex':
        try {
          return new RegExp(compareValue, 'i').test(varValue)
        } catch {
          return false
        }
      case 'exists':
        return varValue !== '' && varValue !== 'undefined'
      default:
        return false
    }
  }

  private evaluateConditionCases(
    condition: { variable: string; operator: string; cases: Array<{ id: string; value: string }> },
    variables: Record<string, any>
  ): string {
    if (!condition) return 'fallback'

    const varValue = String(variables[condition.variable] ?? '')

    for (const c of condition.cases) {
      // Replace variables in case value too (e.g. {{someVar}})
      const caseValue = this.replaceVariables(c.value || '', variables)

      let matches = false
      switch (condition.operator || 'equals') {
        case 'equals':
          matches = varValue.toLowerCase() === caseValue.toLowerCase()
          break
        case 'contains':
          matches = varValue.toLowerCase().includes(caseValue.toLowerCase())
          break
        case 'startsWith':
          matches = varValue.toLowerCase().startsWith(caseValue.toLowerCase())
          break
        case 'endsWith':
          matches = varValue.toLowerCase().endsWith(caseValue.toLowerCase())
          break
        case 'regex':
          try { matches = new RegExp(caseValue, 'i').test(varValue) } catch { matches = false }
          break
        case 'exists':
          matches = varValue !== '' && varValue !== 'undefined'
          break
      }

      if (matches) return c.id
    }

    return 'fallback'
  }

  private async executeHttpRequest(
    config: { method: string; url: string; headers?: Array<{ key: string; value: string }> | Record<string, string>; body?: string },
    variables: Record<string, any>
  ): Promise<any> {
    const url = this.replaceVariables(config.url, variables)
    const headersObj: Record<string, string> = {}

    // Handle headers as array or object (backwards compatible)
    if (Array.isArray(config.headers)) {
      // New format: array of {key, value}
      for (const header of config.headers) {
        if (header.key) {
          const val = this.replaceVariables(header.value || '', variables).trim()
          const authMatch = val.match(/^(Bearer|Basic)\s+(.+)$/i)
          headersObj[header.key.trim()] = authMatch
            ? `${authMatch[1]} ${authMatch[2].replace(/\s+/g, '')}`
            : val
        }
      }
    } else if (config.headers) {
      // Old format: Record<string, string>
      for (const key in config.headers) {
        const val = this.replaceVariables(config.headers[key], variables).trim()
        const authMatch = val.match(/^(Bearer|Basic)\s+(.+)$/i)
        headersObj[key.trim()] = authMatch
          ? `${authMatch[1]} ${authMatch[2].replace(/\s+/g, '')}`
          : val
      }
    }

    const options: RequestInit = {
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        ...headersObj,
      },
    }

    if (config.body && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
      options.body = this.replaceVariables(config.body, variables)
    }

    const response = await fetch(url, options)

    // Try to parse as JSON, fallback to text
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      return response.json()
    }
    return response.text()
  }

  /**
   * Resume um FlowSession pausado em HUMAN_INPUT/APPROVAL com a resposta humana.
   * Salva a resposta em variables[outputVariable] e avança usando outputHandle:
   *   - APPROVAL: 'approved' | 'rejected' (baseado em params.approved)
   *   - HUMAN_INPUT: 'submitted' (sempre)
   */
  async resumeWithHumanInput(sessionId: string, params: { value?: any; approved?: boolean; reviewedByUserId?: string; reviewerName?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = await prisma.flowSession.findUnique({
      where: { id: sessionId },
      include: { flow: { include: { nodes: true, edges: true } } },
    })
    if (!session) return { ok: false, error: 'Sessão não encontrada' }
    if (!session.isActive) return { ok: false, error: 'Sessão inativa' }
    if (!session.waitingInput) return { ok: false, error: 'Sessão não está aguardando input' }

    const ctx = (session.context as any) || {}
    const pending = ctx.awaitingHumanInput
    if (!pending) return { ok: false, error: 'Sessão não está em HUMAN_INPUT/APPROVAL' }

    const currentNode = session.flow.nodes.find(n => n.id === pending.nodeId)
    if (!currentNode) return { ok: false, error: 'Nó atual não encontrado' }

    const outputVar = pending.outputVariable || (pending.nodeType === 'APPROVAL' ? 'approval' : 'human_input')
    const value = pending.nodeType === 'APPROVAL'
      ? { approved: !!params.approved, reviewedByUserId: params.reviewedByUserId || null, reviewerName: params.reviewerName || null, reviewedAt: new Date().toISOString() }
      : (params.value !== undefined ? params.value : null)

    const newVariables = { ...((session.variables as any) || {}), [outputVar]: value }
    const newContext = { ...ctx }
    delete newContext.awaitingHumanInput
    newContext.lastHumanInput = { nodeId: pending.nodeId, value, at: new Date().toISOString() }

    await prisma.flowSession.update({
      where: { id: session.id },
      data: { waitingInput: false, variables: newVariables, context: newContext, lastActivity: new Date() },
    })

    const updatedSession = { ...session, waitingInput: false, variables: newVariables, context: newContext } as SessionWithFlow

    const outputHandle = pending.nodeType === 'APPROVAL'
      ? (params.approved ? 'approved' : 'rejected')
      : 'submitted'
    const nextNodeIds = await this.findNextNodes(updatedSession, currentNode, outputHandle)

    if (nextNodeIds.length === 0) {
      await prisma.flowSession.update({
        where: { id: session.id },
        data: { isActive: false, completedAt: new Date() },
      })
      return { ok: true }
    }

    updatedSession.currentNodeId = nextNodeIds[0]
    await prisma.flowSession.update({ where: { id: session.id }, data: { currentNodeId: nextNodeIds[0] } })
    await this.executeFlow(updatedSession, nextNodeIds)
    return { ok: true }
  }
}

// Singleton instance
let flowEngineInstance: FlowEngine | null = null

export function initFlowEngine(sendMessage: SendMessageFn): FlowEngine {
  flowEngineInstance = new FlowEngine(sendMessage)
  return flowEngineInstance
}

export function getFlowEngine(): FlowEngine | null {
  return flowEngineInstance
}
