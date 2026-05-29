# Modificações FlowBuilder - Botões Interativos e Carrossel

> Gerado em: 2026-05-20
> Escopo: documentação das alterações que adicionaram múltiplos tipos de botões ao nó `BUTTONS` e o novo nó `CAROUSEL` ao FlowBuilder em `/flows`.

---

## 1. Resumo

O FlowBuilder passou a suportar cinco tipos de botão no nó `BUTTONS`:

| Tipo | Uso | Gera rota no fluxo? | Observação |
|---|---|---:|---|
| `reply` | Resposta rápida do usuário | Sim | Mantém o comportamento original. |
| `copy` | Botão para copiar código/texto | Não | Ação local no WhatsApp. |
| `url` | Botão para abrir link | Não | Ação local no WhatsApp. |
| `call` | Botão para ligar | Não | Ação local no WhatsApp. |
| `pix` | Botão/dados de pagamento PIX | Não | Tratado como caso especial e exclusivo no nó. |

O objetivo da alteração foi alinhar o FlowBuilder ao formato usado pelo Evo Go em `/send/button`, que aceita `PIX`, `reply`, `copy`, `URL` e `call`.

Além disso, o FlowBuilder passou a ter o nó `CAROUSEL`, que envia cards interativos pela API Evo Go em `/send/carousel`.

---

## 2. Status do Banco de Dados

### Botões

**Não há migration de banco necessária para os novos tipos de botão.**

Motivo:

- A configuração do nó já é persistida em `flow_nodes.data`, coluna `Json` no Prisma e `JSONB` no Postgres.
- Os novos campos dos botões (`buttonType`, `url`, `copyCode`, `phoneNumber`, `currency`, `name`, `keyType`, `key`) ficam dentro desse JSON.
- As conexões de saída já usam `flow_edges.sourceHandle String?`, suficiente para handles dinâmicos como `btn_1` e `right-btn_1`.
- Não houve criação de nova entidade relacional, índice, enum Prisma ou coluna obrigatória.

Arquivos relevantes:

- `backend/prisma/schema.prisma`
  - `FlowNode.data Json`
  - `FlowEdge.sourceHandle String?`
- Migration histórica que criou `flow_nodes.data` como `JSONB`:
  - `backend/prisma/migrations/20260330232731_add_labels_custom_attrs_canned_responses_filters_automations_macros/migration.sql`

### Quando uma migration seria necessária

Criar migration apenas se a aplicação passar a precisar de algo que o JSON não cobre bem, por exemplo:

- Relatórios SQL filtrando por tipo de botão.
- Índices por `buttonType`.
- Validação forte no banco para impedir mistura de tipos.
- Histórico/auditoria individual de cada botão.
- Reuso de botões como entidades independentes.

Enquanto os botões forem apenas configuração do canvas, o modelo atual é suficiente.

### Carrossel

**Há migration necessária para o novo nó `CAROUSEL`.**

Motivo:

- `FlowNode.type` usa o enum Prisma/Postgres `FlowNodeType`.
- Um novo tipo de nó precisa existir nesse enum para poder ser salvo em `flow_nodes.type`.
- A configuração interna do carrossel continua em `flow_nodes.data` como JSON.

Arquivos aplicados:

- `backend/prisma/schema.prisma`
  - adiciona `CAROUSEL` em `enum FlowNodeType`
- `backend/prisma/migrations/20260520_add_flow_carousel_node/migration.sql`
  - adiciona `CAROUSEL` ao enum Postgres de forma idempotente

---

## 3. Modelo de Dados no Frontend

Os tipos foram definidos em:

```ts
// frontend/src/types/index.ts
export type FlowButtonType = 'reply' | 'copy' | 'url' | 'call' | 'pix'

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

export type FlowCarouselButtonType = 'reply' | 'copy' | 'url' | 'call'

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
  body: { text: string }
  footer?: string
  buttons?: FlowCarouselButton[]
}
```

Compatibilidade:

- Botões antigos sem `buttonType` continuam sendo tratados como `reply`.
- O campo `text` continua sendo o rótulo exibido no editor.
- O `id` continua sendo usado como identificador de resposta rápida e handle de roteamento.

---

## 4. Alterações no Nó `BUTTONS`

Arquivo principal:

- `frontend/src/components/flow-builder/NodeProperties.tsx`

O painel de propriedades do nó `BUTTONS` passou a ter:

- Seletor de tipo por botão: `Reply`, `Copiar`, `URL`, `Ligar`, `PIX`.
- Campos condicionais:
  - `url`: campo de URL.
  - `copy`: campo `copyCode`.
  - `call`: campo `phoneNumber`.
  - `pix`: campos `currency`, `keyType`, `name`, `key`.
- Limite de até 3 botões para botões não PIX.
- Aviso quando botões `reply` são misturados com botões de ação.
- Caso especial para PIX:
  - Força o nó a manter apenas um botão.
  - Limpa `content`, `header` e `footer`.
  - Remove a necessidade de aguardar resposta do usuário.

Exemplo de configuração salva em `FlowNode.data`:

```json
{
  "label": "BUTTONS",
  "header": "Escolha uma opção",
  "content": "Como deseja continuar?",
  "footer": "Atendimento IMPA",
  "buttons": [
    {
      "id": "btn_1",
      "text": "Falar com atendente",
      "buttonType": "reply"
    },
    {
      "id": "btn_2",
      "text": "Abrir portal",
      "buttonType": "url",
      "url": "https://exemplo.com"
    },
    {
      "id": "btn_3",
      "text": "Copiar código",
      "buttonType": "copy",
      "copyCode": "ABC123"
    }
  ]
}
```

Exemplo de configuração PIX:

```json
{
  "label": "BUTTONS",
  "buttons": [
    {
      "id": "pix_1",
      "text": "PIX",
      "buttonType": "pix",
      "currency": "BRL",
      "name": "Empresa Ltda",
      "keyType": "email",
      "key": "pix@example.com"
    }
  ]
}
```

---

## 5. Renderização no Canvas

Arquivo principal:

- `frontend/src/components/flow-builder/CustomNodes.tsx`

Comportamento visual:

- O nó mostra a lista de botões com o tipo em destaque.
- Se existir botão PIX, `header`, `content` e `footer` não são renderizados no card.
- Apenas botões `reply` geram handles de saída individuais.
- Botões `copy`, `url`, `call` e `pix` são ações de mensagem e não devem criar ramificações no fluxo.

Isso evita que o fluxo fique aguardando uma resposta que o WhatsApp não envia para botões de ação.

---

## 6. Salvamento do Canvas

Arquivos:

- `frontend/src/pages/FlowEditor.tsx`
- `backend/src/modules/flows/flow.routes.ts`

Fluxo de persistência:

1. O React Flow mantém o nó com `node.data.buttons`.
2. Ao salvar, o frontend envia `node.data` inteiro para `PUT /api/flows/:id/canvas`.
3. O backend aceita `data` com schema flexível (`z.record(z.any())`).
4. O backend recria os nós e arestas do canvas dentro de uma transaction.
5. `FlowNode.data` guarda os campos novos em JSON.

Não há conversão especial no banco.

---

## 7. Execução no FlowEngine

Arquivo principal:

- `backend/src/modules/flows/flow.engine.ts`

Funções relevantes:

- `getFlowButtonType`
- `hasFlowReplyButtons`
- `normalizeFlowButtons`
- `buildFlowButtonMessage`
- `resolveFlowInteractiveOutputHandle`

Comportamento:

- `buttonType` inválido ou ausente vira `reply`.
- `reply` é normalizado para `{ type: 'reply', displayText, id }`.
- `url` é normalizado para `{ type: 'url', displayText, url }`.
- `copy` é normalizado para `{ type: 'copy', displayText, copyCode }`.
- `call` é normalizado para `{ type: 'call', displayText, phoneNumber }`.
- `pix` é normalizado para `{ type: 'pix', currency, name, keyType, key }`.
- Se houver PIX, o FlowEngine envia mensagem do tipo `pix` e não espera input.
- Se houver pelo menos um `reply`, o FlowEngine salva o nó como interativo e espera a resposta.
- Na resposta de botão, somente botões `reply` participam da resolução da próxima rota.

Roteamento:

- Handles gerados por botões `reply` usam o `id` do botão.
- O resolver aceita também o formato com prefixo `right-`, usado pelos handles laterais do canvas.
- Se a resposta não tiver aresta compatível, a sessão pode permanecer aguardando no mesmo nó interativo.

---

## 8. Envio por Canal

### Evo Go

Arquivo:

- `backend/src/providers/evo-go/evo-go.provider.ts`

Comportamento:

- `sendButtonMessage` envia para `/send/button`.
- `sendPixMessage` também usa `/send/button`, porque o pacote Evo Go expõe PIX como tipo de botão.
- `normalizeEvoGoButtons` adapta o formato do FlowBuilder para o payload esperado pelo Evo Go.
- Para botões CTA (`copy`, `url`, `call`) sem título, o provider usa título invisível para evitar duplicação visual de descrição.

### Baileys / WHATSMEOW

Arquivo:

- `backend/src/providers/baileys/baileys.manager.ts`

Comportamento:

- `reply` vira NativeFlow `quick_reply`.
- `url` vira NativeFlow `cta_url`.
- `copy` vira NativeFlow `cta_copy`.
- `call` vira NativeFlow `cta_call`.
- `pix` é enviado como texto com dados de pagamento, não como botão PIX nativo.

### Cloud API

Arquivo:

- `backend/src/modules/webhooks/webhook.routes.ts`

Estado atual:

- O envio do FlowEngine pela Cloud API usa mensagens interativas de botão.
- O suporte prático é voltado a botões de resposta (`reply`).
- Botões CTA e PIX dependem das limitações e formatos aceitos pela API oficial da Meta; eles não devem ser assumidos como equivalentes ao Evo Go.

---

## 9. Nó `CAROUSEL`

Arquivos principais:

- `frontend/src/types/index.ts`
- `frontend/src/components/flow-builder/NodesSidebar.tsx`
- `frontend/src/components/flow-builder/NodeProperties.tsx`
- `frontend/src/components/flow-builder/CustomNodes.tsx`
- `frontend/src/pages/FlowEditor.tsx`
- `backend/src/modules/flows/flow.engine.ts`
- `backend/src/providers/evo-go/evo-go.provider.ts`
- `backend/src/modules/webhooks/webhook.routes.ts`

Comportamento do editor:

- O nó aparece na categoria `Interacao` como `Carrossel`.
- Cada nó aceita até 10 cards.
- Cada card aceita `header.title`, `header.subtitle`, `header.imageUrl`, `header.videoUrl`, `body.text`, `footer` e até 3 botões.
- Botões de card aceitam `reply`, `url`, `call` e `copy`.
- `pix` não é aceito dentro de card de carrossel; a própria API Evo Go recomenda usar `/send/button` para PIX.
- Apenas botões `reply` geram handles de saída no canvas.

Contrato enviado ao Evo Go:

```json
{
  "number": "5511999999999",
  "body": "Confira nossas novidades",
  "footer": "IMPA",
  "cards": [
    {
      "header": {
        "title": "Produto A",
        "imageUrl": "https://cdn.example.com/a.jpg"
      },
      "body": {
        "text": "Descricao do produto A"
      },
      "buttons": [
        {
          "type": "REPLY",
          "displayText": "Quero",
          "id": "produto_a"
        },
        {
          "type": "URL",
          "displayText": "Comprar",
          "id": "https://example.com/produto-a"
        }
      ]
    }
  ]
}
```

Diferença importante em relação aos botões planos de `/send/button`:

- No carrossel, botão `URL` envia a URL no campo `id`.
- No carrossel, botão `CALL` envia o telefone no campo `id`.
- No carrossel, botão `COPY` envia o texto em `copyCode`.
- No carrossel, botão `REPLY` envia o payload em `id`.

Execução:

- `buildFlowCarouselMessage` monta a mensagem do FlowEngine.
- `normalizeFlowCarouselCards` converte a configuração do canvas para o contrato da Evo Go.
- `sendCarouselMessage` usa `POST /send/carousel`.
- Em Evo Go, o envio é nativo por `/send/carousel`.
- Em Baileys e Cloud API, o fallback atual é texto, pois o foco desta implementação é Evo Go.

---

## 10. Migração React Flow v12

Em 2026-05-20, o FlowBuilder foi migrado do pacote legado `reactflow@11.11.4` para `@xyflow/react@12.10.2`.

Motivo:

- `reactflow@11.11.4` era a última versão da linha antiga.
- A linha atual do React Flow usa o pacote `@xyflow/react`.
- A migração prepara o editor para evoluções como histórico local, undo/redo e melhorias futuras do canvas.

Alterações aplicadas:

- `frontend/package.json` removeu `reactflow` e adicionou `@xyflow/react`.
- `frontend/package-lock.json` foi regenerado com a árvore de dependências da v12.
- Imports de `reactflow` foram trocados por `@xyflow/react`.
- CSS global do canvas foi atualizado de `reactflow/dist/style.css` para `@xyflow/react/dist/style.css`.
- `FlowEditor.tsx` passou a tipar explicitamente `Node<FlowNodeData>`, `Edge` e `ReactFlowInstance`.
- `CustomNodes.tsx` passou a usar `NodeProps<Node<BaseNodeData>>`, compatível com o contrato da v12.
- `FlowNodeData` passou a estender `Record<string, unknown>`, exigência do tipo genérico `Node<Data>` da v12.

Arquivos principais:

- `frontend/src/pages/FlowEditor.tsx`
- `frontend/src/components/flow-builder/CustomNodes.tsx`
- `frontend/src/components/flow-builder/CustomEdge.tsx`
- `frontend/src/components/flow-builder/NodeProperties.tsx`
- `frontend/src/types/index.ts`
- `frontend/package.json`
- `frontend/package-lock.json`

Verificações feitas:

```powershell
cd frontend
npm run build
npm ls reactflow @xyflow/react
```

Smoke test visual:

- Editor real aberto em `/flows/:id`.
- Canvas `.react-flow` renderizado.
- Sidebar preservou o nó `Carrossel`.
- Botão `Salvar Layout` disponível.
- Nenhum erro relevante de runtime relacionado a React Flow/XYFlow.

Observação:

- Após a migração, reiniciar o servidor Vite de desenvolvimento para limpar o cache antigo de dependências.

---

## 11. Histórico local de desfazer/refazer

Em 2026-05-20, o FlowBuilder recebeu histórico local para o canvas usando a mesma ideia do Typebot: pilhas `past`, `present` e `future` para snapshots.

Escopo:

- O histórico cobre apenas o canvas: `nodes` e `edges` do `@xyflow/react`.
- Configurações do fluxo no modal, como nome, gatilho, instância e timeout, continuam fora do undo/redo.
- Mudanças transitórias de UI, como seleção, zoom, pan e abertura de painel, não entram no histórico.

Comportamentos registrados:

- Adicionar node por drag-and-drop.
- Conectar nodes.
- Excluir edge.
- Editar dados de node.
- Excluir node e suas conexões.
- Duplicar node.
- Mover node ao finalizar o drag.

Atalhos e UI:

- `Ctrl/Cmd + Z`: desfazer.
- `Ctrl/Cmd + Shift + Z` ou `Ctrl/Cmd + Y`: refazer.
- Botões `Desfazer` e `Refazer` adicionados no header do editor.
- Os atalhos ignoram campos de texto, `textarea`, `select` e regiões `contenteditable`, preservando o undo nativo durante edição de texto.

Arquivos principais:

- `frontend/src/lib/flowHistory.ts`
- `frontend/src/lib/flowHistory.test.mjs`
- `frontend/src/pages/FlowEditor.tsx`
- `frontend/package.json`

Verificações feitas:

```powershell
cd frontend
npm run test:flow-history
npm run build
```

Observação:

- O Browser plugin estava listado, mas a ferramenta Node REPL exigida pelo próprio plugin não estava exposta nesta sessão. A validação renderizada interativa não foi executada por esse motivo.

---

## 12. Menu de contexto em nodes

Em 2026-05-20, o FlowBuilder recebeu menu de contexto por botão direito nos nodes do canvas.

Comportamento:

- Clique com botão direito em um node abre um menu próximo ao cursor.
- O menu é reposicionado para não sair da viewport.
- Ações disponíveis: `Editar`, `Duplicar` e `Excluir`.
- `START` mantém as proteções existentes: duplicar e excluir ficam desabilitados.
- Clique fora do menu, `Escape`, blur da janela ou execução de uma ação fecha o menu.
- `Duplicar` e `Excluir` usam as mesmas ações do editor, portanto entram no histórico local de desfazer/refazer.

Arquivos principais:

- `frontend/src/lib/flowContextMenu.ts`
- `frontend/src/lib/flowContextMenu.test.mjs`
- `frontend/src/pages/FlowEditor.tsx`
- `frontend/package.json`

Verificações feitas:

```powershell
cd frontend
npm run test:flow-builder
npm run build
```

---

## 13. Topologia dos handles

Em 2026-05-20, os handles visíveis do FlowBuilder foram simplificados para fluxo esquerda → direita.

Comportamento:

- `target` visível somente à esquerda (`target-left`).
- `source` visível somente à direita (`source-right` e saídas específicas `right-*`).
- Handles antigos de topo/base continuam existindo como compatibilidade invisível, reposicionados nas laterais:
  - `target-top` fica oculto na esquerda.
  - `source-bottom` fica oculto na direita.
  - saídas antigas sem prefixo, como `fallback`, `yes`, `no` e IDs de opções, ficam ocultas na direita.
- A compatibilidade evita quebrar edges já persistidas com `sourceHandle`/`targetHandle` antigos.
- O backend já aceita equivalência entre `right-*` e o ID sem prefixo no roteamento.
- Handles conectados recebem destaque visual no canvas:
  - `source` conectado fica verde.
  - `target` conectado fica amarelo.
  - handles desconectados mantêm a cor padrão.
  - o destaque considera IDs atuais e aliases antigos, como `source-right`/`source-bottom`, `target-left`/`target-top` e `right-*`/ID sem prefixo.

Arquivos principais:

- `frontend/src/components/flow-builder/CustomNodes.tsx`
- `frontend/src/lib/flowConnectedHandles.ts`
- `frontend/src/lib/flowHandleTopology.test.mjs`
- `frontend/src/lib/flowConnectedHandles.test.mjs`
- `frontend/package.json`

Verificações feitas:

```powershell
cd frontend
npm run test:flow-builder
npm run build
```

---

## 14. Configurações do Builder por usuário

Em 2026-05-20, o FlowBuilder recebeu preferências seguras de UX/UI por usuário.

Comportamento:

- O editor `/flows/:id` possui a aba `Aparência` dentro da toolbox de nós.
- As preferências são salvas por usuário e aplicadas a todos os fluxos dele.
- O editor usa defaults seguros quando ainda não existe configuração salva.
- As opções não alteram regras de execução nem regras de conexão do fluxo.

Opções disponíveis:

- Ajustar nodes à grade.
- Tamanho da grade.
- Fundo do canvas: pontos, linhas, cruzes ou nenhum.
- Espaçamento e tamanho do fundo.
- Mostrar/esconder controles.
- Mostrar/esconder mini mapa.
- Edges animadas por padrão.
- Estilo visual das edges: tracejada ou contínua.
- Tipo padrão das edges: `smoothstep`, `step`, `straight`, `bezier` ou `simpleBezier`.
- Aparência das edges: cor normal, cor selecionada, espessura e opacidade.
- Setas das edges: seta final e tamanho da seta.

Em seguida, ainda em 2026-05-20, o builder passou a registrar múltiplos `edgeTypes` próprios. Todos continuam usando o mesmo componente customizado com botão de exclusão, seleção, cor e estilo configurável.

Também em 2026-05-20, as configurações globais de edge passaram a aplicar `markerEnd` do `@xyflow/react`. A seta inicial foi removida para evitar ambiguidade visual sobre o sentido do fluxo. Essas preferências continuam por usuário e não são persistidas individualmente em cada edge do fluxo.

Tipos registrados:

- `smoothstep`
- `step`
- `straight`
- `bezier`
- `simpleBezier`
- `custom` como alias legado para compatibilidade.

Arquivos principais:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260520_add_user_builder_settings/migration.sql`
- `backend/src/modules/users/user.routes.ts`
- `frontend/src/lib/builderSettings.ts`
- `frontend/src/lib/builderSettings.test.mjs`
- `frontend/src/lib/flowEdgeTypes.test.mjs`
- `frontend/src/components/flow-builder/BuilderSettingsPanel.tsx`
- `frontend/src/components/flow-builder/NodesSidebar.tsx`
- `frontend/src/pages/FlowEditor.tsx`
- `frontend/src/components/flow-builder/CustomEdge.tsx`

Verificações feitas:

```powershell
cd frontend
npm run test:flow-builder
npm run build
```

Observação:

- `npm run build` do backend ainda possui erros TypeScript preexistentes em módulos de AI/fleet/conversations, sem erro novo em `backend/src/modules/users/user.routes.ts`.

---

## 15. Painel de configurações dentro da toolbox

Em 2026-05-20, o modal de configurações do Builder foi extraído para um painel reutilizável e passou a ficar disponível também dentro da toolbox de nós do editor.

Comportamento:

- A toolbox lateral ganhou alternância entre `Nós` e `Aparência`.
- A opção `Aparência` abre o painel no mesmo espaço da toolbox, mantendo o canvas visível.
- Alterações no painel aplicam preview em tempo real no canvas antes do salvamento.
- `Cancelar` descarta o preview e reaplica a configuração persistida do usuário.
- `Salvar` persiste as preferências em `PUT /api/users/me/builder-settings`.
- O preview de aparência não marca o layout do fluxo como alteração não salva, porque não altera nodes/edges persistidos do canvas.
- A página `/flows` não exibe mais o botão `Configurações do Builder`; o ajuste fica concentrado na toolbox do editor.

Arquivos principais:

- `frontend/src/components/flow-builder/BuilderSettingsPanel.tsx`
- `frontend/src/components/flow-builder/NodesSidebar.tsx`
- `frontend/src/pages/Flows.tsx`
- `frontend/src/pages/FlowEditor.tsx`
- `frontend/src/lib/builderSettingsPanel.test.mjs`
- `frontend/src/lib/flowEdgeTypes.test.mjs`
- `frontend/package.json`

Verificações feitas:

```powershell
cd frontend
npm run test:flow-builder
npm run build
```

Validação renderizada:

- Smoke test com Playwright no dev server `http://127.0.0.1:5454/flows/flow-1`.
- Confirmado que a edge muda de cor em preview ao alterar `builder-edge-color`.
- Confirmado que `Cancelar` reverte a cor para a preferência persistida.
- Confirmado que `Salvar` envia a nova preferência para `/users/me/builder-settings`.

---

## 16. Abas Editor e Execuções no canvas

Em 2026-05-20, o editor passou a ter uma alternância no topo do canvas inspirada no n8n: `Editor` e `Execuções`.

Comportamento:

- `Editor` mantém a experiência normal de edição do fluxo.
- `Execuções` coloca o canvas em modo leitura:
  - substitui a toolbox de criação de nós por uma sidebar esquerda de execuções, reaproveitando a estrutura visual da `NodesSidebar`;
  - bloqueia drag, conexão e edição de nodes/edges;
  - oculta o botão de remoção de edges;
  - mantém pan/zoom para inspeção.
- A aba `Execuções` consulta `GET /api/flows/:id/sessions` somente quando está ativa.
- O endpoint retorna o histórico do fluxo, ordenado por última atividade, para que o card não suma quando a execução termina.
- Cada nova execução cria uma nova linha em `flow_sessions`; o índice único antigo por `flowId + instanceId + remoteJid` foi removido pela migration `20260521010000_preserve_flow_execution_history`.
- O `FlowEngine` grava `context.executionTrace` na sessão a cada node executado, permitindo replay visual mesmo quando o fluxo executa rápido demais para o polling capturar todos os passos em tempo real.
- O `FlowEngine` grava `context.flowSnapshot` no início da execução, preservando os nodes e edges usados naquele momento. Assim, execuções antigas continuam mostrando o fluxo executado mesmo depois de o editor ser alterado.
- O painel lateral de execuções lista o histórico do fluxo, com:
  - contato/remote JID;
  - status da sessão;
  - node atual;
  - última atividade;
  - botão para atualizar;
  - botão de exclusão para execuções finalizadas.
- A exclusão de execução é individual e segura:
  - usa `DELETE /api/flows/:id/sessions/:sessionId`;
  - exige permissão `flows:manage`;
  - remove somente sessões do fluxo atual com `isActive: false`;
  - execuções em andamento não exibem a lixeira e o backend também bloqueia a remoção.
- Execuções em andamento podem ser paradas pela sidebar:
  - usa `POST /api/flows/:id/sessions/:sessionId/stop`;
  - exige permissão `flows:manage`;
  - atualiza a sessão para `isActive: false`, `waitingInput: false`, `completedAt` e `lastActivity`;
  - preserva o registro no histórico para inspeção posterior.
- Ao selecionar uma execução ativa, o canvas destaca o `currentNodeId`:
  - verde animado para execução em andamento;
  - amarelo animado quando está aguardando resposta;
  - nodes e edges não relacionados ficam esmaecidos;
  - edges ligadas ao node atual ficam verdes com dash animado para indicar o trecho percorrido.
- Ao selecionar uma execução finalizada, o canvas usa o snapshot histórico e mostra somente o caminho percorrido:
  - nodes visitados ficam marcados em verde estático;
  - edges percorridas ficam verdes sem animação;
  - nodes e edges fora do caminho ficam esmaecidos.
- Quando uma execução ativa possui `executionTrace`, o editor reproduz localmente a sequência de nodes no canvas, em vez de ficar preso no node inicial.

Arquivos principais:

- `frontend/src/pages/FlowEditor.tsx`
- `backend/src/modules/flows/flow.engine.ts`
- `backend/src/modules/flows/flow.routes.ts`
- `frontend/src/components/flow-builder/CustomEdge.tsx`
- `frontend/src/lib/flowExecutionView.ts`
- `frontend/src/lib/flowExecutionView.test.mjs`
- `backend/tests/flow-media-node.test.ts`
- `frontend/src/index.css`
- `frontend/package.json`

Verificações feitas:

```powershell
cd frontend
npm run test:flow-builder
npm run build
cd ../backend
npx tsx tests/flow-media-node.test.ts
npx prisma validate
npx prisma migrate deploy
```

---

## 17. Testes Existentes

Arquivos:

- `backend/tests/flow-media-node.test.ts`
- `backend/tests/evo-go.provider.test.ts`

Cobertura relevante:

- Normalização de `reply`, `url`, `copy`, `call` e `pix`.
- Compatibilidade com botões antigos sem `buttonType`.
- Botões de ação não deixam o fluxo aguardando resposta.
- PIX força mensagem do tipo `pix`, sem espera de input.
- Payload de Evo Go para CTA evita duplicação de título/descrição.
- PIX via Evo Go usa `/send/button`.
- Normalização de cards e botões de carrossel.
- Roteamento de botões `reply` em carrossel.
- Payload de Evo Go para `/send/carousel`.

Comandos de validação:

```powershell
cd backend
npx tsx tests/flow-media-node.test.ts
npx tsx tests/evo-go.provider.test.ts
```

---

## 18. Checklist para Manutenção

Ao alterar botões no FlowBuilder:

- Atualizar `FlowButtonType` e `FlowButton` no frontend.
- Para carrossel, atualizar também `FlowCarouselButtonType`, `FlowCarouselButton` e `FlowCarouselCard`.
- Atualizar o editor em `NodeProperties.tsx`.
- Atualizar a renderização e handles em `CustomNodes.tsx`.
- Atualizar `normalizeFlowButtons` e `buildFlowButtonMessage`.
- Para carrossel, atualizar `normalizeFlowCarouselCards` e `buildFlowCarouselMessage`.
- Atualizar providers por canal, principalmente Evo Go e Baileys.
- Adicionar teste de normalização no FlowEngine.
- Adicionar teste de payload no provider afetado.
- Só criar migration se a mudança exigir consulta, índice, enum, coluna ou relacionamento no banco.

---

## 19. Decisão Técnica Registrada

Os novos tipos de botão permanecem como configuração JSON do nó, não como estrutura relacional.

Essa decisão mantém compatibilidade com fluxos antigos, evita migration desnecessária e preserva a flexibilidade do canvas. A aplicação já possui os pontos necessários para persistir a alteração:

- `flow_nodes.data` armazena a configuração completa do nó.
- `flow_edges.sourceHandle` armazena as rotas de botões `reply`.
- O backend normaliza os dados no momento da execução.

Resultado:

- Botões: nenhuma alteração de banco foi aplicada porque os campos novos ficam em JSON.
- Carrossel: migration aplicada apenas para adicionar o novo valor `CAROUSEL` ao enum `FlowNodeType`.
