# ImpaGo API — Documento Técnico de Referência e Proposta Arquitetural

> **Documento preparatório para criação do serviço ImpaGo API**  
> Baseado em análise profunda da Evolution Go (Evo Go) como referência técnica  
> **Data:** Abril 2026 | **Linguagem alvo:** Go | **Status:** Análise e Design

---

## Sumário

1. [Análise Profunda da Evolution Go](#1-análise-profunda-da-evolution-go)
   - 1.1 Visão Geral
   - 1.2 Arquitetura Atual
   - 1.3 Organização de Pastas e Módulos
   - 1.4 Modelo de Dados
   - 1.5 Fluxo de Autenticação e API Keys
   - 1.6 Gestão de Instâncias
   - 1.7 Conexão com WhatsApp via Whatsmeow
   - 1.8 Envio de Mensagens
   - 1.9 Recebimento de Eventos
   - 1.10 Webhooks e Sistema de Filas
   - 1.11 Tratamento de Mídia
   - 1.12 Reconexão e Resiliência
   - 1.13 Persistência e Banco de Dados
   - 1.14 Mapa Completo de Endpoints
2. [Pontos Fortes da Evo Go](#2-pontos-fortes-da-evo-go)
3. [Pontos Fracos, Limitações e Problemas](#3-pontos-fracos-limitações-e-problemas)
4. [Proposta Arquitetural — ImpaGo API](#4-proposta-arquitetural--impago-api)
   - 4.1 Visão de Produto
   - 4.2 Princípios Arquiteturais
   - 4.3 Stack Tecnológica
   - 4.4 Arquitetura de Camadas
   - 4.5 Organização de Módulos
   - 4.6 Decisão: Banco de Dados Único vs Dual
   - 4.7 Decisão: Nome da Instância como Identificador
5. [Proposta de API — Redesign Completo](#5-proposta-de-api--redesign-completo)
   - 5.1 Convenções Gerais
   - 5.2 Autenticação
   - 5.3 Endpoints Administrativos
   - 5.4 Endpoints Operacionais
   - 5.5 Contratos de Payload
6. [Fluxos Principais da ImpaGo API](#6-fluxos-principais-da-impago-api)
7. [Sistema de Eventos e Webhooks](#7-sistema-de-eventos-e-webhooks)
8. [Naming e Identidade Técnica](#8-naming-e-identidade-técnica)
9. [Recomendações para Implementação](#9-recomendações-para-implementação)

---

## 1. Análise Profunda da Evolution Go

### 1.1 Visão Geral

A Evolution Go (Evo Go) é um gateway de API para WhatsApp escrito em Go. Ela usa a biblioteca **whatsmeow** (implementação não-oficial do protocolo WhatsApp Web em Go) para conectar ao WhatsApp e expõe uma API REST que permite:

- Criar e gerenciar múltiplas instâncias de WhatsApp
- Conectar cada instância ao WhatsApp via QR Code ou Pairing Code
- Enviar mensagens de texto, mídia, enquetes, botões, listas, stickers, localização, contatos, carrossel e PIX
- Receber eventos em tempo real via Webhook, RabbitMQ, NATS ou WebSocket
- Gerenciar grupos, comunidades, newsletters, labels, contatos e chamadas
- Armazenar mídia em S3/MinIO ou base64

É essencialmente um **proxy HTTP para o protocolo WhatsApp**, onde cada "instância" representa uma sessão autenticada de WhatsApp (um número de telefone conectado).

### 1.2 Arquitetura Atual

A Evo Go segue uma arquitetura em **3 camadas** por módulo:

```
┌─────────────────────────────────────────────┐
│                 HTTP Layer                   │
│            (Gin Framework)                   │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │Handler │ │Handler │ │Handler │ ...       │
│  └───┬────┘ └───┬────┘ └───┬────┘          │
│      │          │          │                 │
│  ┌───┴────┐ ┌───┴────┐ ┌───┴────┐          │
│  │Service │ │Service │ │Service │ ...       │
│  └───┬────┘ └───┬────┘ └───┬────┘          │
│      │          │          │                 │
│  ┌───┴────┐                                  │
│  │  Repo  │  (apenas instance, message,      │
│  └───┬────┘   label têm repositório)         │
│      │                                       │
├──────┼───────────────────────────────────────┤
│      │         Whatsmeow Service             │
│      │    (Módulo central monolítico)        │
│      │  ┌─────────────────────────────┐      │
│      │  │ StartClient / EventHandler  │      │
│      │  │ QR Code / Pairing           │      │
│      │  │ Media Download/Upload       │      │
│      │  │ Webhook Routing             │      │
│      │  └─────────────────────────────┘      │
│      │                                       │
├──────┼───────────────────────────────────────┤
│      │          Data Layer                   │
│  ┌───┴────┐  ┌───────────┐                  │
│  │ GORM   │  │ Whatsmeow │                  │
│  │PostgreSQL│ │  sqlstore │                  │
│  │(users) │  │(auth/keys)│                  │
│  └────────┘  └───────────┘                  │
│                                              │
├──────────────────────────────────────────────┤
│           Event Producers                    │
│  ┌─────────┐ ┌──────┐ ┌───────┐ ┌────────┐ │
│  │RabbitMQ │ │ NATS │ │Webhook│ │WebSocket│ │
│  └─────────┘ └──────┘ └───────┘ └────────┘ │
│                                              │
├──────────────────────────────────────────────┤
│           Media Storage                      │
│  ┌──────────┐  ┌────────┐                   │
│  │  MinIO   │  │ Base64 │                   │
│  │ (S3)     │  │(inline)│                   │
│  └──────────┘  └────────┘                   │
└──────────────────────────────────────────────┘
```

**Componentes principais:**
- **Gin** como framework HTTP
- **GORM** como ORM para PostgreSQL (dados de aplicação)
- **whatsmeow sqlstore** para persistência de sessão WhatsApp (pode ser SQLite ou PostgreSQL)
- **4 producers** de eventos independentes (RabbitMQ, NATS, Webhook, WebSocket)
- **MinIO** para storage de mídia (opcional)
- **go-cache** para caching em memória (deduplicação, user info)

### 1.3 Organização de Pastas e Módulos

```
evolution-go/
├── cmd/evolution-go/
│   └── main.go                    # Entry point, wiring de dependências
├── pkg/
│   ├── config/
│   │   ├── config.go              # Struct Config + Load() + DB creation
│   │   └── env/
│   │       └── env.go             # 46 constantes de variáveis de ambiente
│   ├── instance/
│   │   ├── handler/handler.go     # 18 HTTP handlers
│   │   ├── service/service.go     # 15 métodos de negócio
│   │   ├── repository/repo.go     # 14 queries DB
│   │   └── model/model.go         # Struct Instance (21 campos)
│   ├── whatsmeow/
│   │   └── service/service.go     # ~3000 linhas — MÓDULO MONOLÍTICO CENTRAL
│   ├── sendMessage/
│   │   ├── handler/handler.go     # 11 handlers de envio
│   │   └── service/service.go     # 11 tipos de mensagem
│   ├── message/
│   │   ├── handler/handler.go     # 7 handlers (react, markread, etc.)
│   │   ├── service/service.go     # 7 operações
│   │   ├── repository/repo.go     # CRUD mensagens
│   │   └── model/model.go         # Struct Message
│   ├── events/
│   │   ├── interfaces/            # Interface Producer
│   │   ├── rabbitmq/              # RabbitMQ producer
│   │   ├── nats/                  # NATS producer
│   │   ├── webhook/               # HTTP webhook producer
│   │   └── websocket/             # WebSocket producer
│   ├── storage/
│   │   ├── interfaces/            # Interface MediaStorage
│   │   └── minio/                 # Implementação MinIO/S3
│   ├── group/                     # 14 operações de grupo
│   ├── user/                      # 12 operações de usuário
│   ├── chat/                      # 7 operações de chat
│   ├── label/                     # 6 operações + DB
│   ├── call/                      # 1 operação (reject)
│   ├── community/                 # 3 operações
│   ├── newsletter/                # 6 operações
│   ├── middleware/
│   │   ├── auth_middleware.go     # Auth + AuthAdmin
│   │   └── jid_validation.go     # Validação de JID
│   ├── routes/routes.go           # Registro de todas as rotas
│   ├── logger/                    # Logger por instância (JSON, rotação)
│   ├── telemetry/                 # Telemetria para evolution-api.com
│   ├── server/                    # Health check
│   ├── internal/                  # Event types internos
│   └── utils/                     # JID, proxy, OS detection
└── docker-compose.yml
```

**Contagem total: ~80+ endpoints, 12 módulos, ~8.000-10.000 linhas de código Go**

### 1.4 Modelo de Dados

#### Instance (tabela principal)

| Campo | Tipo | Propósito |
|-------|------|-----------|
| `Id` | UUID (PK) | Identificador principal, gerado automaticamente |
| `Name` | string | Nome amigável da instância |
| `Token` | string (UNIQUE) | API key da instância |
| `Webhook` | string | URL de webhook para receber eventos |
| `RabbitmqEnable` | string | "enabled"/"true"/"false" |
| `WebSocketEnable` | string | Flag para WebSocket |
| `NatsEnable` | string | Flag para NATS |
| `Jid` | string | WhatsApp JID (ex: `5511999999999@s.whatsapp.net`) |
| `Qrcode` | text | QR code em formato `"base64_image|texto_código"` |
| `Connected` | bool | Status de conexão real |
| `Expiration` | int64 | Timestamp de expiração |
| `DisconnectReason` | string | Motivo da última desconexão |
| `Events` | string | CSV de eventos subscritos (ex: `"MESSAGE,QRCODE"`) |
| `OsName` | string | Nome do OS simulado |
| `Proxy` | string | JSON serializado com config de proxy |
| `ClientName` | string | Multi-tenancy |
| `AlwaysOnline` | bool | Parecer sempre online |
| `RejectCall` | bool | Rejeitar chamadas |
| `MsgRejectCall` | string | Mensagem de rejeição |
| `ReadMessages` | bool | Auto-marcar como lido |
| `IgnoreGroups` | bool | Ignorar mensagens de grupos |
| `IgnoreStatus` | bool | Ignorar atualizações de status |

#### Message

| Campo | Tipo | Propósito |
|-------|------|-----------|
| `Id` | UUID (PK) | Identificador interno |
| `MessageID` | string (UNIQUE) | ID da mensagem WhatsApp |
| `Timestamp` | string | Horário |
| `Status` | string | Status da mensagem |
| `Source` | string | Dados brutos JSON |

#### Label

| Campo | Tipo | Propósito |
|-------|------|-----------|
| `Id` | UUID (PK) | Identificador interno |
| `InstanceID` | string | FK para instância |
| `LabelID` | string | ID do label no WhatsApp |
| `LabelName` | string | Nome do label |
| `LabelColor` | int | Cor (índice numérico) |
| `PredefinedId` | string | ID de predefinido |

### 1.5 Fluxo de Autenticação e API Keys

A Evo Go implementa **dois níveis de autenticação**:

**1. Global API Key (`AuthAdmin`):**
- Header: `apikey: <GLOBAL_API_KEY>`
- Acesso total: criar, listar, deletar instâncias
- Uma única chave para todo o sistema
- Definida via variável de ambiente

**2. Instance Token (`Auth`):**
- Header: `apikey: <instance_token>`
- Acesso por instância: enviar mensagens, status, QR code
- Token definido pelo cliente na criação da instância
- Armazenado **em texto plano** no banco (sem hash)

**Problema crítico:** Não há diferenciação clara entre esses dois modelos no header. Ambos usam `apikey`. O middleware tenta primeiro buscar uma instância com aquele token; se não encontrar, verifica contra a global key.

### 1.6 Gestão de Instâncias

**Ciclo de vida completo:**

```
CREATE → CONNECT → [QR/PAIR] → AUTHENTICATED → OPERATIONAL
                                                    │
                                    ┌───────────────┼───────────────┐
                                    │               │               │
                                RECONNECT     DISCONNECT         LOGOUT
                                    │               │               │
                                    └───────────────┘          [DELETABLE]
                                                                    │
                                                                 DELETE
```

**Detalhes:**
- **Create:** Insere no BD com `connected=false`. NÃO inicia cliente whatsmeow.
- **Connect:** Atualiza configurações de webhook/eventos, cria `killChannel`, inicia goroutine `StartClient()`.
- **QR Code:** Gerado pelo whatsmeow, armazenado como base64 no BD, enviado via webhook.
- **Pair:** Pareamento via código numérico (alternativa ao QR).
- **Reconnect:** Reinicia via `whatsmeowService.ReconnectClient()`.
- **Disconnect:** Envia sinal pelo `killChannel`, limpa eventos, mantém registro no BD.
- **Logout:** Chama `client.Logout()`, remove da memória, mas mantém no BD.
- **Delete:** Faz logout se necessário, limpa cache session whatsmeow, deleta do BD em cascata (labels + messages).

**Gerenciamento em memória:**
```go
clientPointer  map[string]*whatsmeow.Client  // Cliente WhatsApp ativo
myClientPointer map[string]*MyClient          // Wrapper com metadados
killChannel    map[string](chan bool)         // Canal de sinalização
```

⚠️ **SEM mutex** — Race conditions possíveis em acesso concorrente a esses maps.

### 1.7 Conexão com WhatsApp via Whatsmeow

**O módulo `pkg/whatsmeow/service/service.go` é o coração da aplicação.** Com ~3000 linhas, ele:

1. **Cria o store de persistência** (SQLite ou PostgreSQL) para a sessão WhatsApp
2. **Recupera ou cria device** (se já logado, recupera; se novo, cria)
3. **Configura device props** (platform Chrome, versão WhatsApp, OS)
4. **Busca versão WhatsApp** dinamicamente de `web.whatsapp.com/sw.js`
5. **Cria o cliente whatsmeow** com configurações de proxy se necessário
6. **Registra event handler** que processa 30+ tipos de evento
7. **Entra em loop de manutenção** com `killChannel` para controle de lifecycle

**Configuração do cliente:**
```go
client.EnableAutoReconnect = false   // Reconexão manual
client.AutoTrustIdentity = true      // Aceita mudanças de identidade
client.SendReportingTokens = true    // Tokens de report
```

**Suporte a proxy:** SOCKS5, configurável por instância ou global.

**Presença automática:** Goroutine que alterna `available/unavailable` a cada 1-3 horas (6h-23h59 no horário de São Paulo) para simular comportamento humano.

### 1.8 Envio de Mensagens

11 tipos de mensagem suportados:

| Tipo | Endpoint Evo Go | Descrição |
|------|-----------------|-----------|
| Text | `POST /send/text` | Texto simples ou com mentions |
| Link | `POST /send/link` | URL com preview (título, descrição, thumbnail) |
| Media | `POST /send/media` | Imagem, vídeo, áudio ou documento |
| Poll | `POST /send/poll` | Enquete com opções |
| Sticker | `POST /send/sticker` | Sticker WebP |
| Location | `POST /send/location` | Coordenadas GPS |
| Contact | `POST /send/contact` | VCard |
| Button | `POST /send/button` | Botões interativos (reply, payment, mixed) |
| List | `POST /send/list` | Lista dropdown |
| Carousel | `POST /send/carousel` | Cards com mídia + botões |
| PIX | `POST /send/pix` | Pagamento PIX via NativeFlow |

**Recursos transversais:**
- Retry automático: 3 tentativas com backoff (1s → 2s → 3s)
- Quoted messages (respostas) via `ContextInfo`
- Mentions (@person ou @all em grupos)
- Delay de digitação simulado (composing → paused)
- Validação de número via `CheckUser` (opcional)
- Conversão de áudio para Opus/OGG via FFmpeg ou API externa

### 1.9 Recebimento de Eventos

O event handler processa **30+ tipos de evento do WhatsApp:**

| Evento | Descrição | Webhook? |
|--------|-----------|----------|
| `Connected` | Conectado ao WhatsApp | ✅ |
| `PairSuccess` | Pareamento via QR bem-sucedido | ✅ |
| `Message` | Nova mensagem recebida | ✅ |
| `Receipt` | Confirmação de entrega/leitura | ✅ |
| `Presence` | Status online/offline | ✅ |
| `ChatPresence` | Digitando, gravando | ✅ |
| `HistorySync` | Sincronização de histórico | ✅ |
| `LoggedOut` | Deslogado | ✅ |
| `Disconnected` | Desconectado (trigger reconnect) | ✅ |
| `TemporaryBan` | Banimento temporário | ✅ |
| `ConnectFailure` | Falha de conexão | ✅ |
| `CallOffer/Accept/Terminate` | Chamadas | ✅ |
| `LabelEdit/Association` | Labels | ✅ |
| `GroupInfo/JoinedGroup` | Grupos | ✅ |
| `Contact/PushName` | Contatos | ✅ |
| `Newsletter*` | Newsletters | ✅ |
| `UndecryptableMessage` | Mensagem não decifrável | Condicional |

**Processamento de Message:**
1. Deduplicação via cache em memória (30 min TTL)
2. Correção de JID (LID vs WhatsApp JID swap)
3. Filtros: ignorar grupos, ignorar status, ignorar broadcast
4. Auto-read se configurado
5. Extração de quoted messages (replies)
6. Detecção de poll votes
7. Detecção de mensagen editada/revogada
8. Download e armazenamento de mídia (se habilitado)
9. Enriquecimento com dados de grupo (se for grupo)
10. Envio para webhook/filas

### 1.10 Webhooks e Sistema de Filas

4 canais de distribuição de eventos, habilitáveis por instância:

**Webhook HTTP:**
- POST JSON para URL configurada
- Retry: 5 tentativas com intervalo de 30s
- Suporta URL global + URL específica por instância

**RabbitMQ:**
- Queues com formato: `{instanceId}.{eventType}` (minúsculo)
- Configuração: durable=true, quorum=true, ha-policy=all
- Suporta queues globais (compartilhadas) e por instância
- Reconnect automático com 3 tentativas + heartbeat 30s
- Publish retry: 3 tentativas com backoff

**NATS:**
- Subjects dinâmicos (sem pré-criação)
- Modos: global (compartilhado) ou enabled (por instância)

**WebSocket:**
- Conexão em `/ws?token=<apikey>&instanceId=<id>`
- Broadcast para todos ou específico por instância
- Thread-safe com RWMutex

**Roteamento por tipos de evento (subscrição):**
- A instância define quais eventos receber via `Events` (CSV)
- Opção `ALL` para receber tudo
- Ex: `"MESSAGE,CONNECTION,QRCODE"` → recebe apenas esses 3

### 1.11 Tratamento de Mídia

**Recebimento:**
1. Detecta tipo de mídia (image, audio, document, video, sticker)
2. Download com timeout de 5 minutos
3. Conversão WebP → PNG para stickers
4. Armazenamento em MinIO/S3 → retorna URL pré-assinada (7 dias)
5. Ou codifica em base64 inline (dev mode)

**Envio:**
1. Aceita URL HTTP, base64 ou arquivo local
2. Para áudio: converte para Opus/OGG via FFmpeg (30 flags específicas)
3. Upload para WhatsApp via `client.Upload()`
4. Retry 3 tentativas com backoff

### 1.12 Reconexão e Resiliência

**Estratégias:**
- `EnableAutoReconnect = false` → Reconexão manual controlada
- Ao receber `events.Disconnected` → goroutine de reconnect automático
- Ao receber `events.LoggedOut` → envia kill signal → restart
- EOF no WebSocket → retry após 5s
- Falha de proxy auth → tenta sem proxy
- QR timeout → mata canal → reinicia fluxo
- Limite máximo de QR codes configurável

**Loop de manutenção:**
```go
for {
    select {
    case <-killChannel[id]:
        // Disconnect, cleanup, restart
    default:
        time.Sleep(1s)  // Poll
    }
}
```

⚠️ **Polling de 1s** em vez de `select` bloqueante mais eficiente.

### 1.13 Persistência e Banco de Dados

**A Evo Go usa DOIS bancos de dados separados:**

| Banco | Propósito | Conteúdo |
|-------|-----------|----------|
| `evogo_auth` | Sessões WhatsApp (whatsmeow) | Chaves E2E, identidades, pre-keys, sessões, device store |
| `evogo_users` | Dados da aplicação (GORM) | Instances, Messages, Labels |

**Por que dois bancos?**
A justificativa técnica é que o `whatsmeow` gerencia seu próprio schema usando `sqlstore.Container`. O schema do whatsmeow é diferente do schema da aplicação e é auto-gerenciado pela biblioteca. Separar evita conflitos de migration.

**Na prática, isso é questionável.** O whatsmeow cria tabelas com prefixo `whatsmeow_*` (ex: `whatsmeow_device`, `whatsmeow_sessions`, `whatsmeow_identities`). Isso poderia coexistir no mesmo banco sem conflitos. A separação em dois bancos adiciona complexidade operacional sem benefício real.

**Alternativa SQLite:** Se PostgreSQL não for configurado, usa SQLite em `/dbdata/main.db` com WAL mode para melhor concorrência.

**Pool de conexões:**
```
MaxOpenConns: 25
MaxIdleConns: 5
ConnMaxLifetime: 5 min
ConnMaxIdleTime: 1 min
```

### 1.14 Mapa Completo de Endpoints

#### Administração (requer Global API Key)

| Método | Endpoint | Operação |
|--------|----------|----------|
| POST | `/instance/create` | Criar instância |
| GET | `/instance/all` | Listar todas |
| GET | `/instance/info/:instanceId` | Info de uma instância |
| DELETE | `/instance/delete/:instanceId` | Deletar instância |
| POST | `/instance/proxy/:instanceId` | Configurar proxy |
| DELETE | `/instance/proxy/:instanceId` | Remover proxy |
| POST | `/instance/forcereconnect/:instanceId` | Forçar reconexão |
| GET | `/instance/logs/:instanceId` | Ver logs |

#### Instância (requer Instance Token)

| Método | Endpoint | Operação |
|--------|----------|----------|
| POST | `/instance/connect` | Conectar instância |
| GET | `/instance/status` | Status de conexão |
| GET | `/instance/qr` | Obter QR code |
| POST | `/instance/pair` | Parear por código |
| POST | `/instance/disconnect` | Desconectar |
| POST | `/instance/reconnect` | Reconectar |
| DELETE | `/instance/logout` | Fazer logout |
| GET | `/instance/:id/advanced-settings` | Config avançada |
| PUT | `/instance/:id/advanced-settings` | Atualizar config |

#### Envio de Mensagens

| Método | Endpoint | Tipo |
|--------|----------|------|
| POST | `/send/text` | Texto |
| POST | `/send/link` | Link com preview |
| POST | `/send/media` | Mídia (img/video/audio/doc) |
| POST | `/send/poll` | Enquete |
| POST | `/send/sticker` | Sticker |
| POST | `/send/location` | Localização |
| POST | `/send/contact` | Contato VCard |
| POST | `/send/button` | Botões interativos |
| POST | `/send/list` | Lista dropdown |
| POST | `/send/carousel` | Carrossel |
| POST | `/send/pix` | Pagamento PIX |

#### Operações em Mensagens

| Método | Endpoint | Operação |
|--------|----------|----------|
| POST | `/message/react` | Reagir com emoji |
| POST | `/message/presence` | Status digitando |
| POST | `/message/markread` | Marcar como lido |
| POST | `/message/downloadmedia` | Baixar mídia |
| POST | `/message/status` | Status da mensagem |
| POST | `/message/delete` | Deletar para todos |
| POST | `/message/edit` | Editar mensagem |

#### Usuário, Grupo, Chat, Label, Call, Community, Newsletter

(49 endpoints adicionais — detalhados na análise completa acima)

---

## 2. Pontos Fortes da Evo Go

1. **Cobertura funcional ampla:** Implementa praticamente toda a API do WhatsApp exposta pelo whatsmeow (mensagens, grupos, labels, newsletters, comunidades, chamadas).

2. **Sistema multi-canal de eventos:** Suportar 4 backends simultaneamente (Webhook, RabbitMQ, NATS, WebSocket) é robusto e flexível.

3. **Retry com backoff:** Mensagens e conexões têm retry automático com backoff progressivo.

4. **Deduplicação de mensagens:** Cache em memória para evitar processar mensagens duplicadas após reconexões.

5. **Suporte a proxy per-instance:** SOCKS5 proxy configurável por instância, útil para multi-número com IPs diferentes.

6. **MinIO/S3 para mídia:** Abstração de storage com URLs pré-assinadas.

7. **Logging por instância:** Logs separados por instância em arquivos JSON com rotação.

8. **Conversão de áudio:** FFmpeg integrado para converter áudio em formato compatível com WhatsApp.

9. **Correção de LID/JID:** Lida com a inversão de `Sender` e `SenderAlt` que ocorre em alguns cenários do WhatsApp.

10. **Limite de QR codes:** Evita loops infinitos de geração de QR code.

---

## 3. Pontos Fracos, Limitações e Problemas

### 🔴 Críticos

**3.1 — Módulo whatsmeow monolítico com ~3000 linhas**
O `pkg/whatsmeow/service/service.go` concentra TODA a lógica: conexão, eventos, mídia, webhook routing, presença, QR code. Deveria ser dividido em pelo menos 5-6 módulos menores.

**3.2 — Race conditions em maps globais**
Os maps `clientPointer`, `myClientPointer` e `killChannel` são compartilhados entre goroutines sem nenhum `sync.Mutex` ou `sync.RWMutex`. Isso causa race conditions reais em cenários de requisições concorrentes.

**3.3 — Token armazenado sem hash**
A API key de cada instância é armazenada em texto plano no banco de dados. Se o banco for comprometido, todas as chaves ficam expostas.

**3.4 — Identificação por UUID interno obrigatória**
Operações administrativas usam `instanceId` (UUID) na URL. Nenhum endpoint aceita nome da instância como identificador. Isso é ruim para DX — ninguém memoriza UUIDs.

**3.5 — Polling de 1 segundo no loop de manutenção**
```go
default:
    time.Sleep(1s) // Desperdiça CPU
```
Um `select` bloqueante seria mais eficiente.

### 🟡 Moderados

**3.6 — Eventos como CSV em campo string**
`Events = "MESSAGE,QRCODE,CONNECTION"` armazenado como CSV em um campo de texto. Deveria ser uma tabela relacional ou array PostgreSQL.

**3.7 — Flags como strings em vez de booleans**
`RabbitmqEnable`, `WebSocketEnable`, `NatsEnable` são strings (`"enabled"/"true"/"false"`) em vez de booleans.

**3.8 — Proxy como JSON em campo string**
Config de proxy é serializada como JSON string no campo `Proxy`. Sem validação de schema, sem tipo seguro.

**3.9 — Dois bancos de dados sem necessidade clara**
`evogo_auth` e `evogo_users` poderiam coexistir no mesmo banco. As tabelas do whatsmeow têm prefixo `whatsmeow_*` e não colidem.

**3.10 — Naming inconsistente**
- Mix de `instanceId` e `userID` para o mesmo conceito
- `sendMessage` (camelCase) como nome de pacote Go (deveria ser `sendmessage` ou `send`)
- Headers aceitam `apikey` e `ApiKey` com case-insensitive inconsistente
- Endpoints não seguem convenção REST (POST para operações que deveriam ser GET)

**3.11 — Sem rate limiting**
Nenhum rate limiting configurado. Um cliente pode enviar requests ilimitados.

**3.12 — Telemetria para servidor externo**
O módulo de telemetria envia dados de uso para `https://log.evolution-api.com/telemetry`. Isso é inaceitável em um serviço próprio.

**3.13 — Validação de licença contra servidor externo**
O `main.go` sugere validação de licença. Isso não deve existir na ImpaGo API.

### 🟠 Menores

**3.14 — CORS wildcard (`*`)**
`Access-Control-Allow-Origin: *` em produção é inseguro.

**3.15 — Nome da instância sem constraint UNIQUE**
`GetInstanceByName()` existe no repository, mas o campo `Name` não tem constraint UNIQUE no banco.

**3.16 — Sem versionamento de API**
Endpoints não têm prefixo de versão (`/v1/`, `/v2/`).

**3.17 — Sem paginação na listagem**
`GET /instance/all` retorna todas as instâncias sem paginação.

**3.18 — Sem documentação inline consistente**
Swagger annotations incompletas.

---

## 4. Proposta Arquitetural — ImpaGo API

### 4.1 Visão de Produto

**ImpaGo API** é um serviço independente, especializado em conexão WhatsApp via Whatsmeow, projetado para:

1. **Uso nativo no CRM IMPA:** O backend do CRM se comunica com a ImpaGo API via HTTP, recebendo eventos via webhook. A ImpaGo API gerencia as sessões WhatsApp e entrega/recebe mensagens.

2. **Uso externo independente:** Qualquer desenvolvedor pode usar a ImpaGo API como um serviço standalone para conectar ao WhatsApp, independente do CRM.

**Diferença fundamental da Evo Go:**
- A ImpaGo API nasce com mentalidade de **produto desacoplado**, não de componente interno
- Identificação por **nome da instância** (slug), não por UUID
- API consistente e bem documentada
- Sem telemetria externa, sem validação de licença
- Arquitetura modular desde o início
- Banco de dados único

### 4.2 Princípios Arquiteturais

| Princípio | Descrição |
|-----------|-----------|
| **Desacoplamento** | Serviço 100% independente. Conexão com CRM via HTTP/Webhook. |
| **API-First** | Contratos claros, versionados, com documentação OpenAPI completa. |
| **Nome como ID** | Instâncias identificadas por slug (nome) em vez de UUID. |
| **Banco único** | Um PostgreSQL, sem separação artificial. |
| **Modularidade** | Módulos pequenos com responsabilidade única. |
| **Concorrência segura** | Mutex para maps compartilhados. ID-level locks. |
| **DX (Developer Experience)** | Payloads consistentes, erros descritivos, naming claro. |
| **Sem vendor lock-in** | Zero dependência de serviços externos do fornecedor original. |
| **Resiliência** | Reconnect automático, circuit breaker, health checks. |
| **Observabilidade** | Logs estruturados, métricas, tracing. |

### 4.3 Stack Tecnológica

| Componente | Tecnologia | Justificativa |
|------------|------------|---------------|
| Linguagem | **Go 1.22+** | Performance, concorrência nativa, mesma base do whatsmeow |
| Framework HTTP | **Fiber** ou **Chi** | Mais leve e idiomático que Gin. Chi é 100% `net/http` compatible |
| WhatsApp | **whatsmeow** | Melhor lib Go para WhatsApp Web |
| ORM | **GORM** ou **sqlx** | GORM para produtividade; sqlx se preferir queries puras |
| Banco de dados | **PostgreSQL 16** | Único banco, sem SQLite em produção |
| Cache | **sync.Map** ou **ristretto** | Cache thread-safe nativo |
| Mídia | **MinIO/S3** | Storage de mídia com URLs pré-assinadas |
| Filas | **RabbitMQ** (opcional) | Para distribuição de eventos |
| Logging | **zerolog** ou **slog** | Logging estruturado nativo de Go 1.21+ |
| Config | **viper** ou **envconfig** | Carregamento de configuração |
| Documentação | **swag** | OpenAPI/Swagger gerado do código |
| Container | **Docker** | Multi-stage build, alpine final |

### 4.4 Arquitetura de Camadas

```
┌─────────────────────────────────────────────────────┐
│                    ImpaGo API                        │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │            HTTP Router (Chi/Fiber)             │  │
│  │  /v1/connections, /v1/messages, /v1/groups...  │  │
│  └─────────────────┬──────────────────────────────┘  │
│                    │                                  │
│  ┌─────────────────┴──────────────────────────────┐  │
│  │              Middleware Layer                    │  │
│  │  Auth │ RateLimit │ CORS │ RequestID │ Logger  │  │
│  └─────────────────┬──────────────────────────────┘  │
│                    │                                  │
│  ┌─────────────────┴──────────────────────────────┐  │
│  │              Handler Layer                      │  │
│  │  Valida request → Chama service → Formata resp │  │
│  └─────────────────┬──────────────────────────────┘  │
│                    │                                  │
│  ┌─────────────────┴──────────────────────────────┐  │
│  │              Service Layer                      │  │
│  │  Lógica de negócio, orquestração               │  │
│  └───────┬─────────┬──────────────┬───────────────┘  │
│          │         │              │                   │
│  ┌───────┴───┐ ┌───┴──────┐ ┌────┴──────────────┐   │
│  │  Session  │ │ Repository│ │  WhatsApp Engine  │   │
│  │  Manager  │ │  (GORM)   │ │  (Whatsmeow)     │   │
│  │           │ │           │ │                    │   │
│  │ Gerencia  │ │  CRUD DB  │ │ Conexão, eventos, │   │
│  │ clientes  │ │           │ │ mídia, sessões    │   │
│  │ em memória│ │           │ │                    │   │
│  └───────────┘ └───────────┘ └────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           Event Dispatcher                      │  │
│  │  Webhook │ RabbitMQ │ WebSocket (futuro)       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           Media Storage                         │  │
│  │  MinIO/S3 │ Local Filesystem (dev)             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           PostgreSQL (único)                    │  │
│  │  connections │ messages │ labels │ whatsmeow_* │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 4.5 Organização de Módulos

```
impago/
├── cmd/
│   └── impago/
│       └── main.go                    # Entry point
├── internal/
│   ├── config/
│   │   └── config.go                  # Configuração do serviço
│   ├── server/
│   │   └── server.go                  # Setup HTTP server + graceful shutdown
│   ├── router/
│   │   └── router.go                  # Registro de todas as rotas
│   ├── middleware/
│   │   ├── auth.go                    # Autenticação (admin key + connection token)
│   │   ├── ratelimit.go               # Rate limiting
│   │   ├── cors.go                    # CORS configurável
│   │   ├── requestid.go               # Request ID para tracing
│   │   └── logger.go                  # Request logging
│   ├── connection/                    # <<< Módulo "Connection" (antes "Instance")
│   │   ├── handler.go                 # HTTP handlers
│   │   ├── service.go                 # Lógica de negócio
│   │   ├── repository.go             # Queries DB
│   │   └── model.go                   # Struct Connection
│   ├── messaging/                     # <<< Módulo de envio de mensagens
│   │   ├── handler.go
│   │   ├── service.go                 # Envio de texto, mídia, poll, etc.
│   │   └── types.go                   # Structs de request/response
│   ├── chat/                          # <<< Operações de chat
│   │   ├── handler.go
│   │   └── service.go                 # React, markread, edit, delete, presence
│   ├── group/                         # <<< Operações de grupo
│   │   ├── handler.go
│   │   └── service.go
│   ├── contact/                       # <<< Operações de contato/usuário
│   │   ├── handler.go
│   │   └── service.go
│   ├── label/                         # <<< Operações de label
│   │   ├── handler.go
│   │   ├── service.go
│   │   ├── repository.go
│   │   └── model.go
│   ├── community/                     # <<< Comunidades
│   │   ├── handler.go
│   │   └── service.go
│   ├── newsletter/                    # <<< Newsletters
│   │   ├── handler.go
│   │   └── service.go
│   ├── engine/                        # <<< Motor WhatsApp (substitui whatsmeow monolítico)
│   │   ├── manager.go                 # Gerenciamento de sessões com mutex
│   │   ├── client.go                  # Wrapper do cliente whatsmeow
│   │   ├── events.go                  # Handlers de eventos WhatsApp
│   │   ├── media.go                   # Download/upload de mídia
│   │   ├── presence.go                # Lógica de presença automática
│   │   └── qrcode.go                  # Fluxo de QR code e pairing
│   ├── dispatcher/                    # <<< Sistema de eventos
│   │   ├── dispatcher.go             # Interface + roteamento por subscrição
│   │   ├── webhook.go                 # HTTP webhook producer
│   │   ├── rabbitmq.go               # RabbitMQ producer
│   │   └── websocket.go              # WebSocket producer
│   ├── storage/                       # <<< Storage de mídia
│   │   ├── storage.go                 # Interface
│   │   ├── s3.go                      # MinIO/S3
│   │   └── local.go                   # Filesystem local (dev)
│   └── pkg/                           # <<< Utilitários internos
│       ├── jid/                        # Formatação e validação de JID
│       ├── response/                   # Response helpers padronizados
│       └── validator/                  # Validação de payloads
├── migrations/                         # Migrations SQL (golang-migrate)
├── docs/                               # Swagger/OpenAPI gerado
├── Dockerfile
├── docker-compose.yml
├── go.mod
└── README.md
```

**Diferenças-chave em relação à Evo Go:**
- `instance` renomeado para `connection` (mais descritivo)
- `whatsmeow/service` monolítico dividido em `engine/` com 6 arquivos
- `sendMessage` renomeado para `messaging`
- `events/` renomeado para `dispatcher/`
- `user/` renomeado para `contact/`
- Uso de `internal/` para impedir imports externos indevidos
- `pkg/` como utilitários reutilizáveis

### 4.6 Decisão: Banco de Dados Único vs Dual

**Decisão: BANCO ÚNICO.**

**Justificativa técnica:**

1. O whatsmeow cria tabelas com prefixo `whatsmeow_*`. Não há conflito com tabelas da aplicação.
2. Ter dois bancos dobra a complexidade operacional (backups, monitoring, connection pools, migrations).
3. Em cenário de crash, ter dados correlacionados no mesmo banco facilita recovery.
4. As tabelas do whatsmeow são pequenas e de baixo tráfego — não justificam separação.

**Schema proposto:**

```sql
-- Tabelas da aplicação ImpaGo
CREATE TABLE connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,          -- slug, identificador principal
    token VARCHAR(255) UNIQUE NOT NULL,          -- API key (hash bcrypt)
    token_hint VARCHAR(8),                       -- Últimos 8 chars para identificação
    webhook_url TEXT,
    jid VARCHAR(50),
    connected BOOLEAN DEFAULT FALSE,
    disconnect_reason TEXT,
    settings JSONB DEFAULT '{}',                 -- Advanced settings
    events TEXT[] DEFAULT '{}',                  -- Array PostgreSQL nativo
    proxy JSONB,                                 -- Proxy config tipada
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ,
    status VARCHAR(20),
    direction VARCHAR(10),                       -- 'inbound' | 'outbound'
    source JSONB
);

CREATE TABLE labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
    label_id VARCHAR(50) NOT NULL,
    name VARCHAR(100),
    color INTEGER,
    UNIQUE(connection_id, label_id)
);

-- Tabelas do whatsmeow (auto-criadas pela biblioteca)
-- whatsmeow_device, whatsmeow_identities, whatsmeow_prekeys, etc.
```

### 4.7 Decisão: Nome da Instância como Identificador

**Decisão: SIM, usar nome (slug) como identificador principal da API.**

**Implementação:**

1. **O nome é o identificador na API (URL path e queries)**
2. O UUID continua existindo internamente como PK do banco
3. O nome tem constraint `UNIQUE NOT NULL` com validação de slug
4. Regras do slug: `^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$` (letras, números, hífens, 1-100 chars)

**Comparação antes/depois:**

| Evo Go | ImpaGo API |
|--------|------------|
| `GET /instance/info/a1b2c3d4-e5f6-...` | `GET /v1/connections/minha-loja` |
| `DELETE /instance/delete/a1b2c3d4-...` | `DELETE /v1/connections/minha-loja` |
| `POST /instance/proxy/a1b2c3d4-...` | `PUT /v1/connections/minha-loja/proxy` |

**Por que é seguro:**
- Nome é UNIQUE no banco → sem ambiguidade
- Slug validado → sem injection ou chars especiais
- UUID interno disponível para referências cruzadas se necessário
- Token continua sendo a autenticação (não o nome)

---

## 5. Proposta de API — Redesign Completo

### 5.1 Convenções Gerais

| Aspecto | Convenção |
|---------|-----------|
| Prefixo | `/v1/` |
| Formato | JSON (request e response) |
| Naming | kebab-case para URLs, camelCase para JSON |
| Identificação | Nome da connection no path |
| Autenticação | Header `Authorization: Bearer <token>` |
| Erros | RFC 7807 Problem Details |
| Paginação | `?page=1&perPage=20` |
| Timestamps | ISO 8601 (UTC) |
| IDs internos | UUID v4 |

### 5.2 Autenticação

Dois níveis:

**Admin (Master Key):**
```
Authorization: Bearer <IMPAGO_MASTER_KEY>
```
- Acesso total: criar, listar, deletar connections
- Definida via variável de ambiente `IMPAGO_MASTER_KEY`

**Connection Token:**
```
Authorization: Bearer <connection_token>
```
- Acesso à connection específica vinculada ao token
- Token gerado automaticamente na criação (UUID v4)
- Armazenado com hash bcrypt no banco
- Retornado em texto claro apenas uma vez (na criação)

### 5.3 Endpoints Administrativos

Requerem Master Key.

```
POST   /v1/connections                         Criar connection
GET    /v1/connections                         Listar connections (?page=&perPage=&status=)
GET    /v1/connections/:name                   Detalhes de uma connection
DELETE /v1/connections/:name                   Deletar connection
PATCH  /v1/connections/:name                   Atualizar connection (webhook, settings)
POST   /v1/connections/:name/token/rotate      Rotacionar token
PUT    /v1/connections/:name/proxy              Configurar proxy
DELETE /v1/connections/:name/proxy              Remover proxy
GET    /v1/connections/:name/logs               Ver logs (?start=&end=&level=&limit=)
GET    /v1/health                               Health check do serviço
```

### 5.4 Endpoints Operacionais

Requerem Connection Token (ou Master Key).

#### Lifecycle da Connection

```
POST   /v1/session/start                       Iniciar sessão (connect)
POST   /v1/session/stop                        Parar sessão (disconnect)
POST   /v1/session/restart                     Reiniciar sessão (reconnect)
POST   /v1/session/logout                      Logout do WhatsApp
GET    /v1/session/status                      Status da connection
GET    /v1/session/qrcode                      Obter QR code
POST   /v1/session/pair                        Pareamento por código
```

#### Envio de Mensagens

```
POST   /v1/messages/text                       Enviar texto
POST   /v1/messages/media                      Enviar mídia (imagem, vídeo, áudio, documento)
POST   /v1/messages/sticker                    Enviar sticker
POST   /v1/messages/location                   Enviar localização
POST   /v1/messages/contact                    Enviar contato (VCard)
POST   /v1/messages/poll                       Enviar enquete
POST   /v1/messages/button                     Enviar botões interativos
POST   /v1/messages/list                       Enviar lista dropdown
POST   /v1/messages/link                       Enviar link com preview
```

#### Operações em Mensagens

```
POST   /v1/messages/react                      Reagir com emoji
POST   /v1/messages/read                       Marcar como lido
POST   /v1/messages/delete                     Deletar para todos
POST   /v1/messages/edit                       Editar mensagem
POST   /v1/messages/download-media             Baixar mídia de mensagem
GET    /v1/messages/:messageId/status           Status de entrega
```

#### Chat

```
POST   /v1/chats/presence                      Enviar presença (digitando, gravando)
POST   /v1/chats/archive                       Arquivar chat
POST   /v1/chats/unarchive                     Desarquivar chat
POST   /v1/chats/pin                           Fixar chat
POST   /v1/chats/unpin                         Desafixar chat
POST   /v1/chats/mute                          Silenciar chat
POST   /v1/chats/unmute                        Reativar chat
POST   /v1/chats/history-sync                  Solicitar sincronização de histórico
```

#### Contatos

```
POST   /v1/contacts/check                      Verificar se número existe no WhatsApp
POST   /v1/contacts/info                       Informações de contato
POST   /v1/contacts/avatar                     Avatar do contato
GET    /v1/contacts                             Listar contatos
POST   /v1/contacts/block                      Bloquear contato
POST   /v1/contacts/unblock                    Desbloquear contato
GET    /v1/contacts/blocked                     Lista de bloqueados
```

#### Perfil

```
PUT    /v1/profile/name                        Atualizar nome
PUT    /v1/profile/status                      Atualizar status
PUT    /v1/profile/picture                     Atualizar foto
GET    /v1/profile/privacy                     Configurações de privacidade
PUT    /v1/profile/privacy                     Atualizar privacidade
```

#### Grupos

```
GET    /v1/groups                               Listar grupos
POST   /v1/groups                               Criar grupo
POST   /v1/groups/info                          Info do grupo
POST   /v1/groups/invite-link                   Link de convite
PUT    /v1/groups/name                          Alterar nome
PUT    /v1/groups/description                   Alterar descrição
PUT    /v1/groups/photo                         Alterar foto
POST   /v1/groups/participants                  Gerenciar participantes (add/remove/promote/demote)
PUT    /v1/groups/settings                      Configurações do grupo
POST   /v1/groups/join                          Entrar via link
POST   /v1/groups/leave                         Sair do grupo
GET    /v1/groups/requests                      Pedidos de entrada
POST   /v1/groups/requests/action               Aprovar/rejeitar pedidos
```

#### Labels

```
GET    /v1/labels                               Listar labels
POST   /v1/labels                               Criar/editar label
POST   /v1/labels/assign/chat                   Associar label a chat
POST   /v1/labels/assign/message                Associar label a mensagem
POST   /v1/labels/remove/chat                   Remover label de chat
POST   /v1/labels/remove/message                Remover label de mensagem
```

#### Chamadas

```
POST   /v1/calls/reject                        Rejeitar chamada
```

#### Comunidades

```
POST   /v1/communities                          Criar comunidade
POST   /v1/communities/groups/add               Adicionar grupo
POST   /v1/communities/groups/remove            Remover grupo
```

#### Newsletters

```
POST   /v1/newsletters                          Criar newsletter
GET    /v1/newsletters                          Listar newsletters
POST   /v1/newsletters/info                     Info da newsletter
POST   /v1/newsletters/invite-link              Link de convite
POST   /v1/newsletters/subscribe                Inscrever-se
GET    /v1/newsletters/messages                 Mensagens da newsletter
```

### 5.5 Contratos de Payload

#### Criar Connection

```http
POST /v1/connections
Authorization: Bearer <MASTER_KEY>

{
    "name": "loja-centro",
    "webhook": {
        "url": "https://meu-crm.com/webhooks/whatsapp",
        "events": ["message", "connection", "qrcode"]
    },
    "settings": {
        "rejectCalls": false,
        "readMessages": false,
        "ignoreGroups": false,
        "ignoreStatus": false,
        "alwaysOnline": false
    }
}
```

**Response (201 Created):**
```json
{
    "name": "loja-centro",
    "token": "impa_live_a1b2c3...xyz789",
    "tokenHint": "...xyz789",
    "status": "disconnected",
    "createdAt": "2026-04-12T14:30:00Z"
}
```

> **Atenção:** O `token` só é retornado **uma vez**, na criação. Deve ser salvo pelo cliente.

#### Iniciar Sessão

```http
POST /v1/session/start
Authorization: Bearer <connection_token>

{
    "events": ["message", "connection", "qrcode"],
    "webhook": {
        "url": "https://meu-crm.com/webhooks/whatsapp"
    }
}
```

**Response (200 OK):**
```json
{
    "status": "connecting",
    "qrcode": null,
    "message": "Sessão iniciada. Aguardando QR code."
}
```

#### Enviar Mensagem de Texto

```http
POST /v1/messages/text
Authorization: Bearer <connection_token>

{
    "to": "5511999999999",
    "text": "Olá! Como posso ajudar?",
    "options": {
        "delay": 2000,
        "quoted": {
            "messageId": "ABC123DEF456"
        },
        "mentions": ["5511888888888"]
    }
}
```

**Response (200 OK):**
```json
{
    "messageId": "3EB0A1B2C3D4",
    "status": "sent",
    "timestamp": "2026-04-12T14:31:00Z"
}
```

#### Enviar Mídia

```http
POST /v1/messages/media
Authorization: Bearer <connection_token>

{
    "to": "5511999999999",
    "type": "image",
    "media": {
        "url": "https://example.com/photo.jpg"
    },
    "caption": "Veja esta imagem",
    "options": {
        "delay": 1000
    }
}
```

Ou com base64:

```json
{
    "to": "5511999999999",
    "type": "document",
    "media": {
        "base64": "JVBERi0xLjQ...",
        "filename": "contrato.pdf",
        "mimetype": "application/pdf"
    }
}
```

#### Formato de Erro (RFC 7807)

```json
{
    "type": "https://impago.dev/errors/connection-not-found",
    "title": "Connection not found",
    "status": 404,
    "detail": "No connection found with name 'loja-inexistente'",
    "instance": "/v1/connections/loja-inexistente"
}
```

#### Formato de Evento Webhook

```json
{
    "event": "message",
    "timestamp": "2026-04-12T14:32:00Z",
    "connection": {
        "name": "loja-centro",
        "jid": "5511999999999@s.whatsapp.net"
    },
    "data": {
        "id": "3EB0A1B2C3D4",
        "from": "5511888888888@s.whatsapp.net",
        "to": "5511999999999@s.whatsapp.net",
        "timestamp": "2026-04-12T14:32:00Z",
        "type": "text",
        "body": "Oi, preciso de ajuda",
        "isGroup": false,
        "quoted": null,
        "media": null
    }
}
```

---

## 6. Fluxos Principais da ImpaGo API

### 6.1 Criação e Conexão

```
Cliente                     ImpaGo API                    WhatsApp
  │                             │                             │
  │  POST /v1/connections       │                             │
  │  {name: "loja-centro"}      │                             │
  │────────────────────────────>│                             │
  │                             │                             │
  │  201 {token: "impa_live_"}  │                             │
  │<────────────────────────────│                             │
  │                             │                             │
  │  POST /v1/session/start     │                             │
  │  Bearer: impa_live_xxx      │                             │
  │────────────────────────────>│                             │
  │                             │── StartClient() ───────────>│
  │                             │                             │
  │                             │<── QR Code event ──────────│
  │                             │                             │
  │  Webhook: event=qrcode     │                             │
  │<────────────────────────────│                             │
  │                             │                             │
  │  (Usuário escaneia QR)     │                             │
  │                             │<── PairSuccess ────────────│
  │                             │                             │
  │  Webhook: event=connected  │                             │
  │<────────────────────────────│                             │
  │                             │                             │
  │  GET /v1/session/status     │                             │
  │────────────────────────────>│                             │
  │  200 {status: "connected"}  │                             │
  │<────────────────────────────│                             │
```

### 6.2 Envio e Recebimento de Mensagens

```
Cliente                     ImpaGo API                    WhatsApp
  │                             │                             │
  │  POST /v1/messages/text     │                             │
  │  {to: "55...", text: "Oi"} │                             │
  │────────────────────────────>│                             │
  │                             │── client.SendMessage() ───>│
  │                             │                             │
  │  200 {messageId: "ABC123"}  │                             │
  │<────────────────────────────│                             │
  │                             │                             │
  │                             │<── events.Message ─────────│
  │                             │   (mensagem recebida)       │
  │                             │                             │
  │  Webhook: event=message    │                             │
  │  {from: "55...", text: ""} │                             │
  │<────────────────────────────│                             │
```

### 6.3 Reconexão Automática

```
                            ImpaGo API                    WhatsApp
                                │                             │
                                │<── events.Disconnected ────│
                                │                             │
                                │  (Engine detecta disconnect) │
                                │  → UpdateDB(connected=false) │
                                │  → Dispatch("disconnected")  │
                                │  → AutoReconnect()           │
                                │                             │
                                │── client.Connect() ────────>│
                                │                             │
                                │<── events.Connected ────────│
                                │                             │
                                │  → UpdateDB(connected=true)  │
                                │  → Dispatch("connected")     │
```

---

## 7. Sistema de Eventos e Webhooks

### 7.1 Tipos de Evento Propostos

| Tipo | Descrição | Inclui |
|------|-----------|--------|
| `message` | Mensagem recebida | Texto, mídia, poll, editada, revogada |
| `message.sent` | Mensagem enviada (confirmação) | ID, timestamp, status |
| `message.read` | Mensagem lida (receipt) | IDs, timestamp |
| `message.reaction` | Reação recebida | Emoji, messageId |
| `connection` | Mudanças de conexão | Connected, disconnected, logged_out, banned |
| `qrcode` | QR code gerado | Base64, texto, count |
| `presence` | Presença de contato | Online, offline, digitando |
| `group` | Eventos de grupo | Info alterada, participantes |
| `call` | Chamadas | Offer, accept, terminate |
| `label` | Labels | Criado, editado, associado |
| `contact` | Contatos | Sincronizado, pushname |
| `history.sync` | Sincronização de histórico | Mensagens históricas |

### 7.2 Subscrição de Eventos

Na criação ou ao iniciar sessão, o cliente define quais eventos quer receber:

```json
{
    "events": ["message", "connection", "qrcode"]
}
```

- `["*"]` ou `["all"]` → todos os eventos
- Lista vazia → apenas `message` (default)
- Filtragem feita pelo Dispatcher antes de enviar

### 7.3 Formato Padrão de Evento

```json
{
    "event": "message",
    "timestamp": "2026-04-12T14:32:00Z",
    "connection": {
        "name": "loja-centro",
        "jid": "5511999999999@s.whatsapp.net"
    },
    "data": { ... }
}
```

Sempre com: `event`, `timestamp`, `connection`, `data`.

---

## 8. Naming e Identidade Técnica

### 8.1 Comparação de Naming

| Conceito | Evo Go | ImpaGo API |
|----------|--------|------------|
| Sessão WhatsApp | instance | connection |
| Identificador | instanceId (UUID) | name (slug) |
| API key | token | token (com prefixo `impa_`) |
| Módulo central | whatsmeow/service | engine/ |
| Envio de mensagens | sendMessage | messaging |
| Operações em mensagens | message | chat |
| Informações de usuário | user | contact |
| Sistema de eventos | events | dispatcher |
| Endpoint base | `/instance/` | `/v1/connections/` |
| Envio | `/send/text` | `/v1/messages/text` |
| Status | `/instance/status` | `/v1/session/status` |
| QR Code | `/instance/qr` | `/v1/session/qrcode` |
| Autenticação | `apikey` header | `Authorization: Bearer` header |
| Eventos subscritos | CSV string | Array PostgreSQL |
| Proxy config | JSON string em campo text | JSONB tipado |
| Advanced settings | 6 campos separados na tabela | JSONB em campo `settings` |

### 8.2 Naming de Pacotes Go

| Evo Go | ImpaGo API |
|--------|------------|
| `pkg/instance/handler` | `internal/connection` |
| `pkg/whatsmeow/service` | `internal/engine` |
| `pkg/sendMessage/handler` | `internal/messaging` |
| `pkg/message/handler` | `internal/chat` |
| `pkg/user/handler` | `internal/contact` |
| `pkg/events/rabbitmq` | `internal/dispatcher` |
| `pkg/storage/minio` | `internal/storage` |
| `pkg/middleware` | `internal/middleware` |
| `pkg/config/env` | `internal/config` |

### 8.3 Prefixo de Token

Tokens seguem padrão identificável:
```
impa_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
impa_test_x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4
```

Formato: `impa_{env}_{random_36}` — Permite identificar facilmente se é um token ImpaGo e o ambiente.

---

## 9. Recomendações para Implementação

### 9.1 Prioridade de Implementação (Fases)

**Fase 1 — Core (MVP)**
1. Config, server, router, middleware (auth, CORS)
2. Connection CRUD (criar, listar, deletar, status)
3. Engine: StartClient, QR code, pairing, connect/disconnect
4. Envio de mensagens: text, media
5. Recebimento de mensagens via event handler
6. Webhook dispatcher
7. Docker + docker-compose

**Fase 2 — Mensagens Completas**
8. Todos os tipos de envio (poll, sticker, location, contact, button, list)
9. Operações: react, markread, edit, delete, download-media
10. Presença (digitando)

**Fase 3 — Funcionalidades Secundárias**
11. Grupos (criar, info, participantes, settings)
12. Contatos (check, info, avatar, privacy)
13. Labels
14. Perfil

**Fase 4 — Avançado**
15. RabbitMQ dispatcher
16. WebSocket dispatcher
17. MinIO/S3 storage
18. Logs por instância
19. Rate limiting
20. Comunidades, newsletters, chamadas

### 9.2 Padrões de Código

```go
// Mutex obrigatório para maps compartilhados
type SessionManager struct {
    mu       sync.RWMutex
    clients  map[string]*WhatsAppClient
    kills    map[string]chan struct{} // chan struct{} em vez de chan bool
}

func (sm *SessionManager) Get(name string) (*WhatsAppClient, bool) {
    sm.mu.RLock()
    defer sm.mu.RUnlock()
    c, ok := sm.clients[name]
    return c, ok
}

func (sm *SessionManager) Set(name string, c *WhatsAppClient) {
    sm.mu.Lock()
    defer sm.mu.Unlock()
    sm.clients[name] = c
}
```

```go
// Response padronizado
type APIResponse struct {
    Data    interface{} `json:"data,omitempty"`
    Message string      `json:"message,omitempty"`
    Error   *APIError   `json:"error,omitempty"`
}

type APIError struct {
    Type     string `json:"type"`
    Title    string `json:"title"`
    Status   int    `json:"status"`
    Detail   string `json:"detail"`
    Instance string `json:"instance,omitempty"`
}
```

```go
// Select bloqueante em vez de polling de 1s
select {
case <-killCh:
    // Graceful shutdown
case <-ctx.Done():
    // Context cancelado
}
```

### 9.3 Variáveis de Ambiente

```env
# Server
IMPAGO_PORT=4000
IMPAGO_MASTER_KEY=impa_master_xxxxxxxxxx

# Database (único)
IMPAGO_DATABASE_URL=postgresql://user:pass@localhost:5432/impago?sslmode=disable
IMPAGO_SAVE_MESSAGES=true

# WhatsApp
IMPAGO_CONNECT_ON_STARTUP=false
IMPAGO_QRCODE_MAX_COUNT=5
IMPAGO_CHECK_USER_EXISTS=true
IMPAGO_WA_DEBUG=

# Webhook
IMPAGO_WEBHOOK_URL=
IMPAGO_WEBHOOK_FILES=true

# Storage (S3/MinIO)
IMPAGO_S3_ENABLED=false
IMPAGO_S3_ENDPOINT=
IMPAGO_S3_ACCESS_KEY=
IMPAGO_S3_SECRET_KEY=
IMPAGO_S3_BUCKET=impago-media
IMPAGO_S3_REGION=us-east-1
IMPAGO_S3_USE_SSL=false

# RabbitMQ (opcional)
IMPAGO_AMQP_URL=
IMPAGO_AMQP_GLOBAL_ENABLED=false
IMPAGO_AMQP_EVENTS=

# Proxy (global default)
IMPAGO_PROXY_HOST=
IMPAGO_PROXY_PORT=
IMPAGO_PROXY_USER=
IMPAGO_PROXY_PASS=

# Logging
IMPAGO_LOG_LEVEL=info
IMPAGO_LOG_FORMAT=json
IMPAGO_LOG_DIR=./logs
```

### 9.4 Docker Compose

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: impago-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: impago
      POSTGRES_PASSWORD: impago_secret
      POSTGRES_DB: impago
    ports:
      - "5433:5432"
    volumes:
      - impago_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U impago"]
      interval: 5s
      timeout: 5s
      retries: 5

  impago:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: impago
    restart: unless-stopped
    ports:
      - "4000:4000"
    environment:
      IMPAGO_PORT: "4000"
      IMPAGO_MASTER_KEY: "impa_master_dev_local_123"
      IMPAGO_DATABASE_URL: "postgresql://impago:impago_secret@postgres:5432/impago?sslmode=disable"
      IMPAGO_SAVE_MESSAGES: "true"
      IMPAGO_LOG_LEVEL: "debug"
      IMPAGO_CONNECT_ON_STARTUP: "false"
      IMPAGO_WEBHOOK_FILES: "true"
      IMPAGO_QRCODE_MAX_COUNT: "5"
    volumes:
      - impago_logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  impago_pgdata:
  impago_logs:
```

### 9.5 Erros a NÃO Repetir da Evo Go

| Erro na Evo Go | Solução na ImpaGo API |
|-----------------|----------------------|
| Maps sem mutex | `sync.RWMutex` obrigatório |
| Polling 1s no loop | `select` bloqueante |
| Token sem hash | bcrypt com `token_hint` para identificação |
| Dois bancos de dados | Banco único PostgreSQL |
| UUID como identificador da API | Nome (slug) como identificador |
| `sendMessage` como nome de pacote | `messaging` |
| 3000 linhas em um arquivo | Módulo `engine/` dividido em 6 arquivos |
| Eventos como CSV string | `TEXT[]` nativo do PostgreSQL |
| Flags como strings | Boolean nativo |
| Proxy como JSON string | `JSONB` tipado |
| CORS wildcard | CORS configurável por origem |
| Sem versionamento de API | Prefixo `/v1/` |
| Sem paginação | Paginação em todas as listagens |
| Sem rate limiting | Rate limit configurável |
| Sem rotação de token | Endpoint `POST /token/rotate` |
| Telemetria para servidor externo | ZER0 telemetria externa |
| Header `apikey` genérico | `Authorization: Bearer` padrão |
| Validação de licença | Nenhuma |

---

## Conclusão

Este documento mapeia completamente a Evolution Go como referência técnica e propõe uma arquitetura **original, limpa e bem pensada** para a ImpaGo API.

A ImpaGo API não é um fork ou clone da Evo Go. É um serviço novo com:

- **Identidade própria**: naming, contratos, organização e princípios diferentes
- **Melhor DX**: nome como identificador, Bearer auth, erros RFC 7807, paginação
- **Melhor arquitetura**: módulo engine dividido, mutex para concorrência, banco único
- **Melhor segurança**: tokens com hash, CORS configurável, rate limiting
- **Melhor operação**: banco único, Docker simplificado, logs estruturados
- **Mesma potência**: Go + whatsmeow + PostgreSQL + suporte a todos os tipos de mensagem e evento

O próximo passo é iniciar a implementação da **Fase 1 (Core/MVP)**, que é o suficiente para o CRM IMPA começar a usar o serviço.
