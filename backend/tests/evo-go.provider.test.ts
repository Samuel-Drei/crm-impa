import assert from 'node:assert/strict'
import {
  buildEvoGoConnectPayload,
  buildEvoGoButtonPayload,
  buildEvoGoCarouselPayload,
  buildMediaLinkFallbackText,
  extractEvoGoFlowReply,
  EvoGoProvider,
  isEvoGoMessageEvent,
  normalizeEvoGoButtons,
  normalizeEvoGoCarouselCards,
  normalizeEvoGoButtonClickMessage,
  shouldSendMediaAsLink,
} from '../src/providers/evo-go/evo-go.provider.js'

const webhookUrl = 'http://host.docker.internal:3333/api/webhook/evo-go/instance-id'

assert.deepEqual(
  buildEvoGoConnectPayload(webhookUrl, ['ALL']),
  {
    webhookUrl,
    subscribe: ['MESSAGE'],
    events: 'MESSAGE',
  },
  'ALL must be normalized to MESSAGE so Evo Go does not store an empty subscription list',
)

assert.deepEqual(
  buildEvoGoConnectPayload(webhookUrl, ['MESSAGE']),
  {
    webhookUrl,
    subscribe: ['MESSAGE'],
    events: 'MESSAGE',
  },
  'MESSAGE subscription must be sent in the format accepted by Evo Go',
)

assert.deepEqual(
  buildEvoGoConnectPayload(),
  {},
  'connect without webhook URL should not alter webhook settings',
)

assert.equal(
  shouldSendMediaAsLink('video', 'https://www.youtube.com/watch?v=do1v8tcmDD0'),
  true,
  'YouTube video pages must be sent as links, not as media files',
)

assert.equal(
  shouldSendMediaAsLink('video', 'https://cdn.example.com/video.mp4'),
  false,
  'Direct video files should still be sent through the media endpoint',
)

assert.equal(
  buildMediaLinkFallbackText('https://www.youtube.com/watch?v=do1v8tcmDD0', 'Veja isso'),
  'Veja isso\nhttps://www.youtube.com/watch?v=do1v8tcmDD0',
  'caption should be preserved when falling back to a link message',
)

let fallbackCall: { to: string; text: string } | null = null
const provider = Object.create(EvoGoProvider.prototype) as EvoGoProvider
;(provider as any).sendLinkMessage = async (to: string, text: string) => {
  fallbackCall = { to, text }
  return { message: 'sent-as-link' }
}

assert.deepEqual(
  await provider.sendMediaMessage('5511999999999', 'video', 'https://youtu.be/do1v8tcmDD0', 'Video externo'),
  { message: 'sent-as-link' },
  'YouTube media sends should use link fallback result',
)

assert.deepEqual(
  fallbackCall,
  {
    to: '5511999999999',
    text: 'Video externo\nhttps://youtu.be/do1v8tcmDD0',
  },
  'sendMediaMessage should route YouTube video pages through sendLinkMessage',
)

const buttonPosts: Array<{ url: string; payload: any }> = []
const invisibleTitle = '\u200B'
const buttonProvider = Object.create(EvoGoProvider.prototype) as EvoGoProvider
;(buttonProvider as any).client = {
  post: async (url: string, payload: any) => {
    buttonPosts.push({ url, payload })
    return { data: { ok: true } }
  },
}

await buttonProvider.sendButtonMessage('5511999999999', '', 'Escolha uma opção', '', [
  { buttonId: 'sim', buttonText: { displayText: 'Sim' } },
])

assert.deepEqual(
  buttonPosts[0],
  {
    url: '/send/button',
    payload: {
      number: '5511999999999',
      title: 'Escolha uma opção',
      description: 'Escolha uma opção',
      footer: '',
      buttons: [{ type: 'reply', displayText: 'Sim', id: 'sim' }],
    },
  },
  'FlowEngine/Baileys-style buttons must be normalized to Evo Go send/button payload',
)

assert.deepEqual(
  buildEvoGoButtonPayload('5511999999999', '', 'Mensagem Copy, URL, CALL', '', [
    { type: 'copy', displayText: 'Site', copyCode: 'https://appstream.site' },
    { type: 'url', displayText: 'Url', url: 'https://appstream.site' },
    { type: 'call', displayText: 'Me Ligue', phoneNumber: '5524992969830' },
  ]),
  {
    number: '5511999999999',
    title: invisibleTitle,
    description: 'Mensagem Copy, URL, CALL',
    footer: '',
    buttons: [
      { type: 'copy', displayText: 'Site', copyCode: 'https://appstream.site' },
      { type: 'url', displayText: 'Url', url: 'https://appstream.site' },
      { type: 'call', displayText: 'Me Ligue', phoneNumber: '5524992969830' },
    ],
  },
  'CTA buttons without a configured header must not duplicate description into title',
)

assert.deepEqual(
  buildEvoGoButtonPayload('5511999999999', 'Titulo', 'Descrição', 'Mensagem Rodapé', [
    { type: 'copy', displayText: 'Site', copyCode: 'https://appstream.site' },
    { type: 'url', displayText: 'Url', url: 'https://appstream.site' },
    { type: 'call', displayText: 'Me Ligue', phoneNumber: '5524992969830' },
  ]),
  {
    number: '5511999999999',
    title: invisibleTitle,
    description: '*Titulo*\n\nDescrição',
    footer: 'Mensagem Rodapé',
    buttons: [
      { type: 'copy', displayText: 'Site', copyCode: 'https://appstream.site' },
      { type: 'url', displayText: 'Url', url: 'https://appstream.site' },
      { type: 'call', displayText: 'Me Ligue', phoneNumber: '5524992969830' },
    ],
  },
  'CTA button payloads with a configured title must render the title once instead of letting Evo Go duplicate it',
)

assert.deepEqual(
  normalizeEvoGoButtons([
    { buttonType: 'pix', currency: 'BRL', name: 'Empresa Ltda', keyType: 'email', key: 'pix@example.com' },
  ]),
  [
    { type: 'pix', currency: 'BRL', name: 'Empresa Ltda', keyType: 'email', key: 'pix@example.com' },
  ],
  'PIX buttons must follow the Evolution Go node format and must not be dropped for missing displayText',
)

const pixPosts: Array<{ url: string; payload: any }> = []
const pixProvider = Object.create(EvoGoProvider.prototype) as EvoGoProvider
;(pixProvider as any).client = {
  post: async (url: string, payload: any) => {
    pixPosts.push({ url, payload })
    return { data: { ok: true } }
  },
}

await pixProvider.sendPixMessage('5511999999999', 'pix@example.com', 'email', 'Empresa Ltda', undefined, 'Pagamento', '')

assert.deepEqual(
  pixPosts[0],
  {
    url: '/send/button',
    payload: {
      number: '5511999999999',
      title: 'Pagamento',
      description: 'Pagamento',
      footer: '',
      buttons: [{ type: 'pix', currency: 'BRL', name: 'Empresa Ltda', keyType: 'email', key: 'pix@example.com' }],
    },
  },
  'Evo Go PIX sends should use /send/button because this Evo Go package exposes PIX as a button type',
)

await pixProvider.sendPixMessage('5511999999999', 'pix@example.com', 'email', 'Empresa Ltda')

assert.deepEqual(
  pixPosts[1],
  {
    url: '/send/button',
    payload: {
      number: '5511999999999',
      title: 'Empresa Ltda',
      description: 'Empresa Ltda',
      footer: '',
      buttons: [{ type: 'pix', currency: 'BRL', name: 'Empresa Ltda', keyType: 'email', key: 'pix@example.com' }],
    },
  },
  'Evo Go PIX sends without message text should use the merchant name as required title and description',
)

assert.deepEqual(
  normalizeEvoGoCarouselCards([
    {
      header: { title: 'Produto A', imageUrl: 'https://cdn.example.com/a.jpg' },
      body: { text: 'Descricao A' },
      footer: 'Card footer',
      buttons: [
        { buttonType: 'reply', text: 'Quero', id: 'want_a' },
        { buttonType: 'url', text: 'Ver site', url: 'https://example.com/a' },
        { buttonType: 'call', text: 'Ligar', phoneNumber: '5524999999999' },
      ],
    },
    {
      header: { title: 'Produto B' },
      body: { text: 'Descricao B' },
      buttons: [
        { buttonType: 'copy', text: 'Copiar', copyCode: 'PROMO10' },
      ],
    },
  ]),
  [
    {
      header: { title: 'Produto A', imageUrl: 'https://cdn.example.com/a.jpg' },
      body: { text: 'Descricao A' },
      footer: 'Card footer',
      buttons: [
        { type: 'REPLY', displayText: 'Quero', id: 'want_a' },
        { type: 'URL', displayText: 'Ver site', id: 'https://example.com/a' },
        { type: 'CALL', displayText: 'Ligar', id: '5524999999999' },
      ],
    },
    {
      header: { title: 'Produto B' },
      body: { text: 'Descricao B' },
      buttons: [
        { type: 'COPY', displayText: 'Copiar', copyCode: 'PROMO10' },
      ],
    },
  ],
  'FlowBuilder carousel cards must be normalized to the Evo Go carousel card contract',
)

assert.deepEqual(
  buildEvoGoCarouselPayload('5511999999999', 'Produtos', 'Rodape', [
    {
      header: { title: 'Produto A' },
      body: { text: 'Descricao A' },
      buttons: [{ buttonType: 'url', text: 'Comprar', url: 'https://example.com/buy' }],
    },
  ]),
  {
    number: '5511999999999',
    body: 'Produtos',
    footer: 'Rodape',
    cards: [
      {
        header: { title: 'Produto A' },
        body: { text: 'Descricao A' },
        buttons: [{ type: 'URL', displayText: 'Comprar', id: 'https://example.com/buy' }],
      },
    ],
  },
  'Evo Go carousel payload should place URL/CALL targets in id as required by /send/carousel',
)

const carouselPosts: Array<{ url: string; payload: any }> = []
const carouselProvider = Object.create(EvoGoProvider.prototype) as EvoGoProvider
;(carouselProvider as any).client = {
  post: async (url: string, payload: any) => {
    carouselPosts.push({ url, payload })
    return { data: { ok: true } }
  },
}

await carouselProvider.sendCarouselMessage('5511999999999', 'Produtos', '', [
  {
    header: { title: 'Produto A' },
    body: { text: 'Descricao A' },
    buttons: [{ buttonType: 'reply', text: 'Quero', id: 'want_a' }],
  },
])

assert.deepEqual(
  carouselPosts[0],
  {
    url: '/send/carousel',
    payload: {
      number: '5511999999999',
      body: 'Produtos',
      footer: '',
      cards: [
        {
          header: { title: 'Produto A' },
          body: { text: 'Descricao A' },
          buttons: [{ type: 'REPLY', displayText: 'Quero', id: 'want_a' }],
        },
      ],
    },
  },
  'Evo Go carousel sends should post normalized cards to /send/carousel',
)

const listPosts: Array<{ url: string; payload: any }> = []
const listProvider = Object.create(EvoGoProvider.prototype) as EvoGoProvider
;(listProvider as any).client = {
  post: async (url: string, payload: any) => {
    listPosts.push({ url, payload })
    return { data: { ok: true } }
  },
}

await listProvider.sendListMessage('5511999999999', '', 'Escolha na lista', '', 'Menu', [
  { title: 'Seção', rows: [{ id: 'row_1', title: 'Primeiro' }] },
])

assert.deepEqual(
  listPosts[0],
  {
    url: '/send/list',
    payload: {
      number: '5511999999999',
      title: 'Escolha na lista',
      description: 'Escolha na lista',
      footerText: '',
      buttonText: 'Menu',
      sections: [{ title: 'Seção', rows: [{ title: 'Primeiro', description: '', rowId: 'row_1' }] }],
    },
  },
  'list rows must use rowId as expected by Evo Go send/list',
)

assert.deepEqual(
  extractEvoGoFlowReply({
    interactiveResponseMessage: {
      nativeFlowResponseMessage: {
        name: 'quick_reply',
        paramsJson: '{"id":"sim","display_text":"Sim"}',
      },
    },
  }),
  { content: 'Sim', messageType: 'button_reply', buttonId: 'sim' },
  'NativeFlow quick_reply responses must be routed as button replies',
)

assert.deepEqual(
  extractEvoGoFlowReply({
    interactiveResponseMessage: {
      nativeFlowResponseMessage: {
        name: 'single_select',
        paramsJson: '{"id":"row_1","title":"Primeiro"}',
      },
    },
  }),
  { content: 'Primeiro', messageType: 'list_reply', listRowId: 'row_1' },
  'NativeFlow single_select responses must be routed as list replies',
)

assert.equal(
  isEvoGoMessageEvent('ButtonClick'),
  true,
  'ButtonClick must enter the same processing pipeline as Message events',
)

assert.deepEqual(
  extractEvoGoFlowReply({
    type: 'list_response',
    buttonId: 'row_1779230855503',
    displayText: '1',
  }),
  { content: '1', messageType: 'list_reply', listRowId: 'row_1779230855503' },
  'Evo Go ButtonClick list_response payloads must become list replies',
)

assert.deepEqual(
  normalizeEvoGoButtonClickMessage({
    Info: { ID: 'msg_1' },
    Message: {
      type: 'list_response',
      buttonId: 'row_1779230855503',
      displayText: '1',
    },
  }),
  {
    listResponseMessage: {
      title: '1',
      singleSelectReply: { selectedRowId: 'row_1779230855503' },
    },
  },
  'ButtonClick payloads should be converted to the message shape consumed by the webhook parser',
)

assert.deepEqual(
  extractEvoGoFlowReply({
    buttonsResponseMessage: {},
    type: 'buttons_response',
    buttonId: 'btn_1779233526042',
    displayText: 'Botao 3',
  }),
  { content: 'Botao 3', messageType: 'button_reply', buttonId: 'btn_1779233526042' },
  'Evo Go ButtonClick payloads with an empty buttonsResponseMessage must still use the direct buttonId',
)

assert.deepEqual(
  normalizeEvoGoButtonClickMessage({
    Info: { ID: 'msg_2' },
    Message: {
      buttonsResponseMessage: {},
      type: 'buttons_response',
      buttonId: 'btn_1779233526042',
      displayText: 'Botao 3',
    },
  }),
  {
    buttonsResponseMessage: {
      selectedDisplayText: 'Botao 3',
      selectedButtonId: 'btn_1779233526042',
    },
  },
  'ButtonClick button payloads should preserve the selected button id for flow edges',
)

assert.deepEqual(
  normalizeEvoGoButtonClickMessage({
    Info: { ID: 'msg_3' },
    type: 'buttons_response',
    buttonId: 'btn_1779233526042',
    displayText: 'Botao 3',
    Message: {
      buttonsResponseMessage: {},
    },
  }),
  {
    buttonsResponseMessage: {
      selectedDisplayText: 'Botao 3',
      selectedButtonId: 'btn_1779233526042',
    },
  },
  'ButtonClick wrappers must not stop at an empty buttonsResponseMessage before reading wrapper-level button fields',
)

const invalidMediaPosts: Array<{ url: string; payload: any }> = []
const invalidMediaProvider = Object.create(EvoGoProvider.prototype) as EvoGoProvider
;(invalidMediaProvider as any).client = {
  post: async (url: string, payload: any) => {
    invalidMediaPosts.push({ url, payload })
    if (url === '/send/media') {
      throw new Error("Invalid file format: 'text/html; charset=utf-8'. Only 'image/jpeg', 'image/png' and 'image/webp' are accepted")
    }
    return { data: { ok: true } }
  },
}

assert.deepEqual(
  await invalidMediaProvider.sendMediaMessage(
    '5511999999999',
    'image',
    'https://file-examples.com/storage/file_example_WEBP_50kB.webp',
    'imagem2',
  ),
  { ok: true },
  'invalid remote image files should fall back to a link message instead of throwing',
)

assert.deepEqual(
  invalidMediaPosts,
  [
    {
      url: '/send/media',
      payload: {
        number: '5511999999999',
        url: 'https://file-examples.com/storage/file_example_WEBP_50kB.webp',
        type: 'image',
        caption: 'imagem2',
      },
    },
    {
      url: '/send/link',
      payload: {
        number: '5511999999999',
        text: 'imagem2\nhttps://file-examples.com/storage/file_example_WEBP_50kB.webp',
      },
    },
  ],
  'sendMediaMessage should retry invalid remote media as a link message',
)
