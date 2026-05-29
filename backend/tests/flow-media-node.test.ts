import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getRequiredFlowMediaUrl,
  hasFlowReplyButtons,
  isFlowKeywordTriggerMessage,
  buildFlowButtonMessage,
  buildFlowCarouselMessage,
  appendFlowExecutionTrace,
  buildFlowExecutionSnapshot,
  normalizeFlowButtons,
  normalizeFlowCarouselCards,
  resolveFlowInteractiveOutputHandle,
  resolveFlowInteractiveRoute,
  resolveFlowNextNodeIds,
  resolveFlowNextNodeId,
  shouldKeepFlowSessionWaitingOnMissingEdge,
  shouldSkipFlowMediaNode,
} from '../src/modules/flows/flow.engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const flowRoutesSource = readFileSync(
  path.join(__dirname, '../src/modules/flows/flow.routes.ts'),
  'utf8',
)
const flowEngineSource = readFileSync(
  path.join(__dirname, '../src/modules/flows/flow.engine.ts'),
  'utf8',
)
const schemaSource = readFileSync(
  path.join(__dirname, '../prisma/schema.prisma'),
  'utf8',
)

assert.match(
  flowRoutesSource,
  /where:\s*\{\s*flowId:\s*id\s*\}/,
  'flow sessions endpoint should list the execution history for the flow',
)

assert.match(
  flowRoutesSource,
  /fastify\.delete\('\/:id\/sessions\/:sessionId'/,
  'flow sessions should expose a delete route for historical executions',
)

assert.match(
  flowRoutesSource,
  /requirePermission\('flows:manage'\)/,
  'deleting a flow execution should require flow management permission',
)

assert.match(
  flowRoutesSource,
  /prisma\.flowSession\.deleteMany\(\{\s*where:\s*\{\s*id:\s*sessionId,\s*flowId:\s*id,\s*isActive:\s*false,?\s*\}/s,
  'deleting a flow execution should only remove finalized sessions for the selected flow',
)

assert.match(
  flowRoutesSource,
  /fastify\.post\('\/:id\/sessions\/:sessionId\/stop'/,
  'flow sessions should expose a stop route for active executions',
)

assert.match(
  flowRoutesSource,
  /prisma\.flowSession\.updateMany\(\{\s*where:\s*\{\s*id:\s*sessionId,\s*flowId:\s*id,\s*isActive:\s*true,?\s*\}/s,
  'stopping a flow execution should only close active sessions for the selected flow',
)

assert.match(
  flowRoutesSource,
  /waitingInput:\s*false[\s\S]*completedAt:\s*now[\s\S]*lastActivity:\s*now/,
  'stopping a flow execution should finalize the session and clear waiting state',
)

assert.doesNotMatch(
  schemaSource,
  /@@unique\(\[flowId,\s*instanceId,\s*remoteJid\]\)/,
  'flow sessions must not be unique per contact because historical executions need separate rows',
)

assert.match(
  flowEngineSource,
  /prisma\.flowSession\.create/,
  'starting a flow should create a new historical execution row',
)

assert.doesNotMatch(
  flowEngineSource,
  /flowSession\.upsert|flowId_instanceId_remoteJid/,
  'starting a flow must not overwrite the previous execution for the same contact',
)

assert.equal(
  getRequiredFlowMediaUrl({ mediaUrl: '  https://cdn.example.com/file.pdf  ' }),
  'https://cdn.example.com/file.pdf',
  'mediaUrl should be trimmed before sending media',
)

assert.equal(
  getRequiredFlowMediaUrl({ label: 'DOCUMENT' }),
  null,
  'missing mediaUrl should be treated as invalid media configuration',
)

assert.equal(
  shouldSkipFlowMediaNode('DOCUMENT', { label: 'DOCUMENT' }),
  true,
  'document nodes without mediaUrl must be skipped instead of calling the provider',
)

assert.equal(
  shouldSkipFlowMediaNode('VIDEO', { mediaUrl: 'https://cdn.example.com/video.mp4' }),
  false,
  'media nodes with a valid URL should still be sent',
)

assert.equal(
  shouldSkipFlowMediaNode('MESSAGE', { content: 'Olá' }),
  false,
  'non-media nodes must not be skipped by the media guard',
)

assert.deepEqual(
  appendFlowExecutionTrace(
    { keep: true, executionTrace: [{ nodeId: 'start', at: '2026-05-20T00:00:00.000Z' }] },
    'next',
    new Date('2026-05-20T00:00:01.000Z'),
  ),
  {
    keep: true,
    executionTrace: [
      { nodeId: 'start', at: '2026-05-20T00:00:00.000Z' },
      { nodeId: 'next', at: '2026-05-20T00:00:01.000Z' },
    ],
  },
  'flow sessions should keep an execution trace in context for canvas replay',
)

assert.deepEqual(
  buildFlowExecutionSnapshot({
    nodes: [
      {
        id: 'node-at-execution-time',
        type: 'MESSAGE',
        positionX: 10,
        positionY: 20,
        data: { label: 'Texto antigo' },
      },
    ],
    edges: [
      {
        id: 'edge-at-execution-time',
        sourceNodeId: 'start-at-execution-time',
        targetNodeId: 'node-at-execution-time',
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
        label: 'Resposta antiga',
        condition: null,
      },
    ],
  }),
  {
    nodes: [
      {
        id: 'node-at-execution-time',
        type: 'MESSAGE',
        positionX: 10,
        positionY: 20,
        data: { label: 'Texto antigo' },
      },
    ],
    edges: [
      {
        id: 'edge-at-execution-time',
        sourceNodeId: 'start-at-execution-time',
        targetNodeId: 'node-at-execution-time',
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
        label: 'Resposta antiga',
        condition: null,
      },
    ],
  },
  'flow sessions should preserve the node and edge snapshot used by that execution',
)

assert.deepEqual(
  normalizeFlowButtons([
    { id: 'legacy', text: 'Legado' },
    { id: 'reply_1', text: 'Responder', buttonType: 'reply' },
    { id: 'site', text: 'Abrir site', buttonType: 'url', url: 'https://example.com' },
    { id: 'copy_1', text: 'Copiar codigo', buttonType: 'copy', copyCode: 'ABC123' },
    { id: 'call_1', text: 'Ligar', buttonType: 'call', phoneNumber: '5524999999999' },
    { id: 'pix_1', text: 'Pix', buttonType: 'pix', currency: 'BRL', name: 'Empresa Ltda', keyType: 'email', key: 'pix@example.com' },
  ]),
  [
    { type: 'reply', displayText: 'Legado', id: 'legacy' },
    { type: 'reply', displayText: 'Responder', id: 'reply_1' },
    { type: 'url', displayText: 'Abrir site', url: 'https://example.com' },
    { type: 'copy', displayText: 'Copiar codigo', copyCode: 'ABC123' },
    { type: 'call', displayText: 'Ligar', phoneNumber: '5524999999999' },
    { type: 'pix', currency: 'BRL', name: 'Empresa Ltda', keyType: 'email', key: 'pix@example.com' },
  ],
  'flow button nodes should normalize reply, url, copy, call and pix buttons for Evo Go',
)

assert.equal(
  hasFlowReplyButtons([{ id: 'legacy', text: 'Legado' }]),
  true,
  'legacy flow buttons without buttonType should still be treated as reply buttons',
)

assert.equal(
  hasFlowReplyButtons([{ id: 'site', text: 'Abrir site', buttonType: 'url', url: 'https://example.com' }]),
  false,
  'action-only button nodes should not wait for a WhatsApp reply that will never arrive',
)

assert.deepEqual(
  buildFlowButtonMessage({
    content: 'Meu PIX',
    footer: 'Rodape',
    buttons: [
      { id: 'pix_1', text: 'PIX', buttonType: 'pix', currency: 'BRL', name: 'Empresa Ltda', keyType: 'email', key: 'pix@example.com' },
      { id: 'reply_1', text: 'Responder', buttonType: 'reply' },
    ],
  }),
  {
    type: 'pix',
    content: {
      pixKey: 'pix@example.com',
      keyType: 'email',
      merchantName: 'Empresa Ltda',
      headerTitle: undefined,
      bodyText: undefined,
      footerText: undefined,
    },
    waitForInput: false,
  },
  'PIX button nodes should force PIX to be the only button and ignore configurable message text',
)

assert.deepEqual(
  normalizeFlowCarouselCards([
    {
      header: {
        title: 'Plano {{plan}}',
        subtitle: 'Oferta',
        imageUrl: 'https://cdn.example.com/{{plan}}.jpg',
      },
      body: { text: 'Descricao {{plan}}' },
      footer: 'Rodape {{plan}}',
      buttons: [
        { id: 'reply_{{plan}}', text: 'Quero', buttonType: 'reply' },
        { id: 'site_1', text: 'Abrir site', buttonType: 'url', url: 'https://example.com/{{plan}}' },
        { id: 'call_1', text: 'Ligar', buttonType: 'call', phoneNumber: '5524999999999' },
      ],
    },
    {
      header: { title: 'Cupom' },
      body: { text: 'Copie o cupom' },
      buttons: [
        { id: 'copy_1', text: 'Copiar', buttonType: 'copy', copyCode: 'PROMO-{{plan}}' },
      ],
    },
  ], value => value.replaceAll('{{plan}}', 'pro')),
  [
    {
      header: {
        title: 'Plano pro',
        subtitle: 'Oferta',
        imageUrl: 'https://cdn.example.com/pro.jpg',
      },
      body: { text: 'Descricao pro' },
      footer: 'Rodape pro',
      buttons: [
        { type: 'REPLY', displayText: 'Quero', id: 'reply_pro' },
        { type: 'URL', displayText: 'Abrir site', id: 'https://example.com/pro' },
        { type: 'CALL', displayText: 'Ligar', id: '5524999999999' },
      ],
    },
    {
      header: { title: 'Cupom' },
      body: { text: 'Copie o cupom' },
      buttons: [
        { type: 'COPY', displayText: 'Copiar', copyCode: 'PROMO-pro' },
      ],
    },
  ],
  'flow carousel cards should normalize reply and CTA buttons to the Evo Go carousel contract',
)

assert.deepEqual(
  buildFlowCarouselMessage({
    content: 'Veja os planos {{name}}',
    footer: 'Equipe IMPA',
    carouselCards: [
      {
        header: { title: 'Plano A' },
        body: { text: 'Descricao A' },
        buttons: [{ id: 'plan_a', text: 'Escolher', buttonType: 'reply' }],
      },
    ],
  }, value => value.replaceAll('{{name}}', 'Ana')),
  {
    type: 'carousel',
    content: {
      body: 'Veja os planos Ana',
      footer: 'Equipe IMPA',
      cards: [
        {
          header: { title: 'Plano A' },
          body: { text: 'Descricao A' },
          buttons: [{ type: 'REPLY', displayText: 'Escolher', id: 'plan_a' }],
        },
      ],
    },
    waitForInput: true,
  },
  'carousel nodes with reply buttons should send carousel content and wait for a button reply',
)

const listEdges = [
  { sourceNodeId: 'list', targetNodeId: 'node-one', sourceHandle: 'right-row_1', targetHandle: null, condition: null },
  { sourceNodeId: 'list', targetNodeId: 'node-two', sourceHandle: 'right-row_2', targetHandle: null, condition: null },
]

assert.equal(
  resolveFlowNextNodeId(listEdges, 'row_2'),
  'node-two',
  'list replies should route through the edge that matches the selected row id',
)

assert.equal(
  resolveFlowNextNodeId(listEdges, 'row_3'),
  null,
  'list replies without a matching row edge must not fall back to the first list option',
)

assert.equal(
  resolveFlowNextNodeId(listEdges),
  'node-one',
  'nodes without an explicit output handle should keep the existing default sequential edge behavior',
)

assert.deepEqual(
  resolveFlowNextNodeIds(listEdges),
  ['node-one', 'node-two'],
  'nodes without an explicit output handle should fan out through every connected edge',
)

const selectedHandleFanOutEdges = [
  { sourceNodeId: 'buttons', targetNodeId: 'node-a', sourceHandle: 'right-btn_1', targetHandle: null, condition: null },
  { sourceNodeId: 'buttons', targetNodeId: 'node-b', sourceHandle: 'right-btn_1', targetHandle: null, condition: null },
  { sourceNodeId: 'buttons', targetNodeId: 'node-c', sourceHandle: 'right-btn_2', targetHandle: null, condition: null },
]

assert.deepEqual(
  resolveFlowNextNodeIds(selectedHandleFanOutEdges, 'btn_1'),
  ['node-a', 'node-b'],
  'selected button or list handles should fan out only through edges matching the selected option',
)

assert.deepEqual(
  resolveFlowNextNodeIds(selectedHandleFanOutEdges, 'btn_3'),
  [],
  'selected button or list handles without matching edges must not fall back to another option',
)

const listNodeData = {
  listSections: [
    {
      title: 'Titulo da Seção 1',
      rows: [
        { id: 'row_1779230855503', title: '1' },
        { id: 'row_1779230859927', title: '2' },
      ],
    },
    {
      title: 'Titulo da Seção 2',
      rows: [
        { id: 'row_1779231339819', title: '1a' },
        { id: 'row_1779231340339', title: '2a' },
      ],
    },
  ],
}

assert.equal(
  resolveFlowInteractiveOutputHandle('LIST', listNodeData, {
    message: '2a',
    messageType: 'list_reply',
  }),
  'row_1779231340339',
  'list replies without selectedRowId should map the selected title back to the saved row id',
)

assert.equal(
  resolveFlowNextNodeId(listEdges, resolveFlowInteractiveOutputHandle('LIST', listNodeData, {
    message: '3',
    messageType: 'list_reply',
  })),
  null,
  'unknown list reply titles must still avoid the default first-edge route',
)

const carouselNodeData = {
  carouselCards: [
    {
      header: { title: 'Plano A' },
      body: { text: 'Descricao A' },
      buttons: [
        { id: 'plan_a', text: 'Escolher A', buttonType: 'reply' },
        { id: 'site_a', text: 'Abrir A', buttonType: 'url', url: 'https://example.com/a' },
      ],
    },
    {
      header: { title: 'Plano B' },
      body: { text: 'Descricao B' },
      buttons: [
        { id: 'plan_b', text: 'Escolher B', buttonType: 'reply' },
      ],
    },
  ],
}

assert.equal(
  resolveFlowInteractiveOutputHandle('CAROUSEL', carouselNodeData, {
    message: 'Escolher B',
    messageType: 'button_reply',
    buttonId: 'plan_b',
  }),
  'plan_b',
  'carousel reply buttons should resolve routes by reply button id across cards',
)

assert.equal(
  isFlowKeywordTriggerMessage('KEYWORD', 'Qqq', 'Qqq'),
  true,
  'sending the current keyword while a flow waits for input should be recognized as a restart trigger',
)

assert.equal(
  isFlowKeywordTriggerMessage('ALL', null, 'Qqq'),
  false,
  'generic ALL triggers must not restart active sessions on every text reply',
)

const buttonEdges = [
  { sourceNodeId: 'buttons', targetNodeId: 'image-node', sourceHandle: 'right-btn_3', targetHandle: null, condition: null },
]

assert.equal(
  resolveFlowNextNodeId(buttonEdges, 'btn_1'),
  null,
  'button replies without a connected edge must not route to another button',
)

assert.equal(
  shouldKeepFlowSessionWaitingOnMissingEdge('BUTTONS', 'btn_1'),
  true,
  'button nodes should keep waiting after an unconnected option so the user can tap a connected option next',
)

assert.equal(
  resolveFlowNextNodeId(buttonEdges, 'btn_3'),
  'image-node',
  'a later connected button reply should still resolve while the session remains on the button node',
)

assert.equal(
  shouldKeepFlowSessionWaitingOnMissingEdge('MESSAGE', 'anything'),
  false,
  'non-interactive nodes should keep the existing behavior when no edge is found',
)

const historicalRouteNodes = [
  {
    id: 'old-buttons',
    type: 'BUTTONS',
    data: {
      buttons: [
        { id: 'btn_reply_1', text: 'Reply 1', buttonType: 'reply' },
        { id: 'btn_reply_2', text: 'Reply 2', buttonType: 'reply' },
      ],
    },
  },
  {
    id: 'current-node',
    type: 'MESSAGE',
    data: { content: 'Fim do caminho 2' },
  },
]

const historicalRouteEdges = [
  { sourceNodeId: 'old-buttons', targetNodeId: 'reply-1-node', sourceHandle: 'right-btn_reply_1', targetHandle: null, condition: null },
  { sourceNodeId: 'old-buttons', targetNodeId: 'reply-2-node', sourceHandle: 'right-btn_reply_2', targetHandle: null, condition: null },
]

assert.deepEqual(
  resolveFlowInteractiveRoute(historicalRouteNodes, historicalRouteEdges, {
    message: 'btn_reply_1',
    messageType: 'button_reply',
    buttonId: 'btn_reply_1',
  }),
  {
    sourceNodeId: 'old-buttons',
    outputHandle: 'btn_reply_1',
    targetNodeIds: ['reply-1-node'],
  },
  'late taps from a previous reply button card should still resolve to the original button node edge',
)
