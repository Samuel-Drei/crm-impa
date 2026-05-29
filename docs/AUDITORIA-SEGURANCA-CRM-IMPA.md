# AUDITORIA DE SEGURANÇA — CRM IMPA
**Data:** 16 de abril de 2026  
**Classificação:** CONFIDENCIAL  
**Auditor:** Application Security Review (Automated Deep Audit)  
**Versão do Sistema:** 2.2.1  
**Stack:** Node.js / Fastify / Prisma / PostgreSQL / Redis / React / Docker  
**Tipo:** CRM SaaS Multi-Tenant

---

## 1. RESUMO EXECUTIVO

O CRM IMPA apresenta uma arquitetura funcional e bem estruturada, com uso de boas práticas em diversas áreas (validação via Zod, RBAC com permissões granulares, separação de módulos). Entretanto, a auditoria revelou **vulnerabilidades graves** que **impedem o sistema de ir para produção com segurança** no estado atual.

### Principais Riscos
- **SQL Injection** confirmada via `$queryRawUnsafe` com interpolação de variáveis do JWT
- **WebSocket sem autenticação** — qualquer cliente pode se conectar e ouvir eventos de qualquer instância/pipeline
- **Diretório `/uploads/` público** sem autenticação — acesso a arquivos de qualquer tenant
- **Token JWT armazenado em localStorage** — vulnerável a XSS
- **Ausência total de security headers** (Helmet, CSP, HSTS, etc.)
- **JWT com validade de 7 dias** sem refresh token rotation
- **Credenciais sensíveis (API keys, tokens, webhookSecret) retornadas para o frontend**
- **Logs de debug escritos em `/tmp/`** com dados sensíveis
- **Webhook Evo Go sem validação de assinatura**
- **Uploads sem validação de MIME type ou extensão**

### Nota Geral de Maturidade
| Área | Nota |
|------|------|
| Autenticação | 5/10 |
| Autorização (RBAC) | 7/10 |
| Multi-Tenancy | 6/10 |
| Proteção contra Injeções | 3/10 |
| Segurança de Transporte | 3/10 |
| Segurança de Uploads | 2/10 |
| Webhooks e Integrações | 4/10 |
| Frontend Security | 3/10 |
| Hardening de Infraestrutura | 3/10 |

### Veredicto
**❌ O sistema NÃO pode ir para produção no estado atual.** As vulnerabilidades críticas encontradas (SQL Injection, WebSocket sem auth, uploads públicos sem escopo) representam risco real de exploração por atacantes. É necessário corrigir pelo menos todos os achados de severidade CRÍTICA e ALTA antes de expor o sistema à internet.

---

## 2. MATRIZ DE RISCO

| ID | Título | Severidade | Categoria | Impacto | Facilidade | Módulos Afetados |
|----|--------|-----------|-----------|---------|-----------|-----------------|
| SEC-01 | SQL Injection via `$queryRawUnsafe` | 🔴 CRÍTICA | Injeção | Leitura/escrita total no BD | Média | messages |
| SEC-02 | WebSocket sem autenticação | 🔴 CRÍTICA | Autenticação | Interceptação de dados em tempo real de qualquer tenant | Trivial | server (Socket.IO) |
| SEC-03 | Uploads públicos sem autenticação nem escopo | 🔴 CRÍTICA | Multi-Tenancy / Controle de Acesso | Acesso a arquivos de qualquer empresa | Trivial | server, webhooks |
| SEC-04 | Credenciais retornadas na API (accessToken, evoApiKey, webhookSecret) | 🔴 CRÍTICA | Exposição de Dados | Comprometimento de integrações | Fácil | instances |
| SEC-05 | Webhook Evo Go sem validação de assinatura | 🔴 CRÍTICA | Webhooks | Injeção de mensagens falsas, automações | Fácil | webhooks |
| SEC-06 | JWT em localStorage (vulnerável a XSS) | 🟠 ALTA | Frontend | Roubo de sessão via XSS | Média | frontend auth |
| SEC-07 | JWT com validade de 7 dias sem revogação | 🟠 ALTA | Autenticação | Sessão ativa por 7 dias mesmo após troca de senha | Fácil | auth |
| SEC-08 | Ausência total de Security Headers (Helmet) | 🟠 ALTA | XSS / Clickjacking | XSS, clickjacking, MIME sniffing | Fácil | server |
| SEC-09 | Enumeração de usuários no registro | 🟠 ALTA | Autenticação | Descoberta de contas existentes | Trivial | auth |
| SEC-10 | Uploads sem validação de extensão/MIME | 🟠 ALTA | Uploads | Upload de arquivos maliciosos | Fácil | schedules, webhooks |
| SEC-11 | Debug logs em `/tmp/` com dados sensíveis | 🟠 ALTA | Exposição de Dados | Vazamento de payloads, tokens, números | Fácil | automations, messages |
| SEC-12 | Rate limit com fallback FAIL OPEN | 🟠 ALTA | DoS | Rate limit desativado se Redis cair | Média | shared-links |
| SEC-13 | Timing attack na comparação de webhook token | 🟡 MÉDIA | Webhooks | Descoberta de token por timing | Alta (muitas requests) | webhook-entrada |
| SEC-14 | Rotas públicas de proposta/contrato expõem dados internos | 🟡 MÉDIA | Exposição de Dados | Notas internas, atividades visíveis | Fácil | proposals, contracts |
| SEC-15 | Redis sem autenticação | 🟡 MÉDIA | Infraestrutura | Acesso total a cache/filas | Requer acesso à rede | config |
| SEC-16 | bcrypt com 10 rounds (abaixo do recomendado) | 🟡 MÉDIA | Autenticação | Hash cracking facilitado | Alta (offline) | auth |
| SEC-17 | JWT fallback via query parameter | 🟡 MÉDIA | Autenticação | Token exposto em logs, referrers | Fácil | auth middleware |
| SEC-18 | `child_process.exec()` em admin routes | 🟡 MÉDIA | RCE | Se comandos puderem ser manipulados | Protegido por superAdmin | admin |
| SEC-19 | Error handler expõe `error.message` em 500 | 🟡 MÉDIA | Exposição de Dados | Stack traces e detalhes internos | Trivial | server |
| SEC-20 | CORS com URLs localhost hardcoded | 🟢 BAIXA | CORS | Permitir origens em dev | Requer rede local | server |
| SEC-21 | Senha DB fraca e hardcoded no docker-compose | 🟢 BAIXA | Infraestrutura | Acesso ao BD | Requer acesso ao código | infra |
| SEC-22 | API tokens sem expiração | 🟡 MÉDIA | Autenticação | Token vazado = acesso permanente | Fácil | auth middleware |
| SEC-23 | Lead `findUnique` sem `companyId` | 🟡 MÉDIA | Multi-Tenancy | Enumeração cross-tenant de leads | Média | leads |
| SEC-24 | `NODE_ENV: 'development'` forçado no admin exec | 🟡 MÉDIA | Segurança de Configuração | Instala devDependencies em prod | Médio | admin |
| SEC-25 | Sem rate limiting em login/register | 🟠 ALTA | Brute Force | Ataques de força bruta | Trivial | auth |
| SEC-26 | Webhook de pagamento (Asaas) sem assinatura | 🟠 ALTA | Webhooks/Financeiro | Fraude: marcar faturas como pagas | Fácil | payments |

---

## 3. ACHADOS DETALHADOS

### SEC-01 — SQL Injection via `$queryRawUnsafe` com Interpolação de Variáveis
- **Severidade:** 🔴 CRÍTICA
- **Categoria:** Injeção SQL
- **Local:** `backend/src/modules/messages/message.routes.ts`, linhas 416-493
- **Descrição:** A query Raw utiliza interpolação direta de variáveis (`userId`, `teamIds`) extraídas do JWT do usuário. Embora esses valores venham do JWT (e não diretamente do input), se um atacante comprometer o JWT_SECRET ou se houver qualquer mecanismo que permita injetar valores maliciosos nos claims do JWT, a injeção SQL se torna viável. Além disso, a variável `showDeleted` (derivada de query param) é usada em condicional interpolada diretamente.
- **Evidência:**
```typescript
// Linha 418-424
let scopeSQL = ''
if (convScope === 'OWN') {
  scopeSQL = ` AND (conv."assigneeId" = '${userId}' OR conv."assigneeId" IS NULL)`
} else if (convScope === 'TEAM' && teamIds.length > 0) {
  const tids = teamIds.map(t => `'${t}'`).join(',')
  scopeSQL = ` AND (conv."teamId" IN (${tids}) OR conv."assigneeId" = '${userId}' ...`
}

// Linha 426:
const conversations = await prisma.$queryRawUnsafe(`...${scopeSQL}...`, instanceId)
```
- **Cenário de exploração:** Um atacante que consiga forjar um JWT (via JWT_SECRET fraco ou vazado) pode injetar SQL arbitrário nos campos `sub`, `teamIds` ou `conversationScope`. Mesmo sem forjar o JWT, se a tabela `users` ou `team_memberships` for comprometida, os valores que alimentam o JWT podem conter payloads SQL.
- **Impacto real:** Leitura total do banco de dados (inclusive dados de todos os tenants), possível escrita, possível RCE via extensões PostgreSQL.
- **Correção recomendada:** Substituir `$queryRawUnsafe` por `$queryRaw` (tagged template literal do Prisma, que parametriza automaticamente), ou usar Prisma.sql com placeholders.
- **Patch sugerido:**
```typescript
import { Prisma } from '@prisma/client'

// Usar tagged template literals do Prisma
let scopeCondition = Prisma.sql`TRUE`
if (convScope === 'OWN') {
  scopeCondition = Prisma.sql`(conv."assigneeId" = ${userId} OR conv."assigneeId" IS NULL)`
} else if (convScope === 'TEAM' && teamIds.length > 0) {
  scopeCondition = Prisma.sql`(conv."teamId" = ANY(${teamIds}) OR conv."assigneeId" = ${userId} OR conv."assigneeId" IS NULL)`
}

const conversations = await prisma.$queryRaw`
  SELECT ... FROM conversations conv
  WHERE conv."instanceId" = ${instanceId}
  AND ${showDeleted ? Prisma.sql`conv."deletedAt" IS NOT NULL` : Prisma.sql`conv."deletedAt" IS NULL`}
  AND ${scopeCondition}
`
```
- **Como validar:** Testar com valores maliciosos nos campos do JWT (ex: `teamIds: ["'; DROP TABLE users;--"]`), verificar que a query é parametrizada via logs do Prisma.

---

### SEC-02 — WebSocket (Socket.IO) Sem Autenticação
- **Severidade:** 🔴 CRÍTICA
- **Categoria:** Autenticação / Multi-Tenancy
- **Local:** `backend/src/server.ts`, linhas 235-258
- **Descrição:** O Socket.IO aceita conexões de qualquer cliente sem verificar JWT ou qualquer credencial. Qualquer pessoa que conheça o endpoint pode se conectar e se inscrever em canais de qualquer instância ou pipeline.
- **Evidência:**
```typescript
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)
  
  socket.on('join-instance', (instanceId: string) => {
    socket.join(`instance:${instanceId}`)  // ❌ SEM verificação de permissão
  })
  
  socket.on('join-pipeline', (pipelineId: string) => {
    socket.join(`pipeline:${pipelineId}`)  // ❌ SEM verificação de permissão
  })
})
```
- **Cenário de exploração:** Um atacante abre uma conexão WebSocket ao servidor, emite `join-instance` com IDs de instâncias de outras empresas (UUIDs podem ser enumerados ou adivinhados), e recebe em tempo real todas as mensagens, status de conversas, atualizações de pipeline, etc.
- **Impacto real:** Interceptação total de dados em tempo real de QUALQUER empresa — mensagens, conversas, cards de pipeline, notificações.
- **Correção recomendada:**
```typescript
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1]
  if (!token) return next(new Error('Authentication required'))
  
  try {
    const decoded = fastify.jwt.verify(token)
    socket.data.user = decoded
    next()
  } catch {
    next(new Error('Invalid token'))
  }
})

io.on('connection', (socket) => {
  const user = socket.data.user
  
  socket.on('join-instance', async (instanceId) => {
    // Verificar que a instância pertence à empresa do usuário
    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, companyId: user.companyId }
    })
    if (!instance) return socket.emit('error', 'Forbidden')
    socket.join(`instance:${instanceId}`)
  })
  
  socket.on('join-pipeline', async (pipelineId) => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, companyId: user.companyId }
    })
    if (!pipeline) return socket.emit('error', 'Forbidden')
    socket.join(`pipeline:${pipelineId}`)
  })
})
```
- **Como validar:** Abrir o DevTools, executar `const socket = io('http://servidor:3333'); socket.emit('join-instance', 'UUID-de-outra-empresa')` e verificar se recebe eventos.

---

### SEC-03 — Diretório `/uploads/` Público Sem Autenticação nem Escopo por Tenant
- **Severidade:** 🔴 CRÍTICA
- **Categoria:** Controle de Acesso / Multi-Tenancy
- **Local:** `backend/src/server.ts`, linhas 110-113
- **Descrição:** O diretório `uploads/` é servido como arquivos estáticos via `@fastify/static` sem qualquer autenticação. Qualquer pessoa pode acessar qualquer arquivo sabendo o nome (que segue o padrão `UUID-nome.ext`).
- **Evidência:**
```typescript
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'uploads'),
  prefix: '/uploads/',
  decorateReply: false,  // ❌ Sem preHandler de auth
})
```
Sem escopo por companyId — todos os uploads de todas as empresas ficam no mesmo diretório plano.
- **Cenário de exploração:** 
  1. Atacante observa uma URL de upload legítimo (ex: via intercepção ou fonte da página)
  2. Enumera UUIDs (v4 tem 122 bits de entropia, mas pode tentar)
  3. OU: se tiver acesso como usuário de uma empresa, pode ver padrões de nomes
  4. Acessa arquivos de QUALQUER empresa via URL direta
- **Impacto real:** Acesso a documentos, mídias, PDFs, contratos de qualquer tenant.
- **Correção recomendada:**
  1. Remover o static serve direto
  2. Criar uma rota autenticada `/api/uploads/:fileId` que verifica `companyId`
  3. Organizar uploads por tenant: `uploads/{companyId}/arquivo`
  4. Ou usar presigned URLs com expiração
- **Como validar:** Acessar `https://dominio/uploads/` sem token — se retornar listagem ou arquivo, é vulnerável.

---

### SEC-04 — Credenciais Retornadas na API (accessToken, evoApiKey, webhookSecret)
- **Severidade:** 🔴 CRÍTICA
- **Categoria:** Exposição de Dados Sensíveis
- **Local:** `backend/src/modules/instances/instance.routes.ts` (response de endpoints de instância)
- **Descrição:** Endpoints que retornam dados de instância incluem campos como `accessToken` (Meta Cloud API), `evoApiKey`, `webhookSecret` no response JSON. Esses dados ficam no localStorage do frontend e são visíveis no DevTools.
- **Cenário de exploração:** XSS ou extensão maliciosa de navegador lê os dados das instâncias armazenados/em trânsito, captura tokens de API de terceiros (Meta, Evo Go).
- **Impacto real:** Comprometimento total de integrações externas — envio de mensagens via WhatsApp API, acesso a dados do Meta Business.
- **Correção recomendada:** Nunca retornar secrets para o frontend. Usar `select` explícito no Prisma excluindo campos sensíveis. Se o frontend precisa saber se um token está configurado, retornar apenas um boolean `hasAccessToken: true`.
- **Como validar:** Inspecionar response de `GET /api/instances` no DevTools — não deve conter campos de credenciais.

---

### SEC-05 — Webhook Evo Go Sem Validação de Assinatura
- **Severidade:** 🔴 CRÍTICA
- **Categoria:** Webhooks / Integridade de Dados
- **Local:** `backend/src/modules/webhooks/webhook.routes.ts`, rotas POST `/evo-go/:instanceId`
- **Descrição:** O endpoint de webhook que recebe mensagens do Evolution Go não valida nenhuma assinatura HMAC ou token. Qualquer pessoa que conheça o `instanceId` pode enviar payloads forjados.
- **Evidência:** O endpoint aceita POST sem verificar `X-Signature`, `X-Webhook-Secret` ou qualquer header de autenticação. Compare com o `webhook-entrada` que valida `webhookToken`.
- **Cenário de exploração:**
  1. Atacante descobre ou enumera instanceIds
  2. Envia POST para `/api/webhook/evo-go/{instanceId}` com payload de mensagem falsa
  3. Mensagem falsa é salva no BD, gatilha automações, fluxos, notificações
  4. Possível criar conversas falsas, injetar mensagens fraudulentas a clientes
- **Impacto real:** Injeção de mensagens falsas, execução de automações não autorizadas, possível fraude.
- **Correção recomendada:**
```typescript
import crypto from 'crypto'

fastify.post('/evo-go/:instanceId', async (request, reply) => {
  const instance = await prisma.instance.findUnique({
    where: { id: instanceId },
    select: { id: true, companyId: true, webhookSecret: true, isActive: true }
  })
  
  if (!instance?.webhookSecret) {
    return reply.status(400).send({ error: 'Webhook secret not configured' })
  }
  
  const signature = request.headers['x-signature'] as string
  const body = JSON.stringify(request.body)
  const expected = crypto.createHmac('sha256', instance.webhookSecret).update(body).digest('hex')
  
  if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return reply.status(401).send({ error: 'Invalid webhook signature' })
  }
  
  // Processar webhook...
})
```
- **Como validar:** Enviar `curl -X POST http://servidor/api/webhook/evo-go/UUID -d '{"fake":"msg"}'` — deve retornar 401.

---

### SEC-06 — JWT Armazenado em localStorage (Vulnerável a XSS)
- **Severidade:** 🟠 ALTA
- **Categoria:** Frontend Security
- **Local:** `frontend/src/stores/auth.store.ts`, linhas 62-64
- **Descrição:** O Zustand persiste o token JWT em `localStorage` (nome: `auth-storage`). Se houver qualquer XSS no sistema (campos de texto, rich editor, nomes de contatos, etc.), o atacante pode extrair o token.
- **Evidência:**
```typescript
persist(
  (set) => ({ /* state */ }),
  { name: 'auth-storage' }  // localStorage por padrão
)
```
- **Cenário de exploração:** `document.cookie` não contém token (não é httpOnly cookie), mas `JSON.parse(localStorage.getItem('auth-storage')).state.token` retorna o JWT.
- **Impacto real:** Roubo completo de sessão, incluindo `companyId`, `role`, `permissions`, `isSuperAdmin`.
- **Correção recomendada:**
  1. Usar cookies `httpOnly`, `secure`, `sameSite=strict` para transportar o JWT
  2. OU usar sessionStorage (limpeza ao fechar aba) e não persistir o token
  3. Implementar refresh token em cookie httpOnly

---

### SEC-07 — JWT com Validade de 7 Dias Sem Revogação
- **Severidade:** 🟠 ALTA
- **Categoria:** Gerenciamento de Sessão
- **Local:** `backend/src/modules/auth/auth.controller.ts`, linhas 23, 55; `backend/src/config/env.ts`, linha 16
- **Descrição:** O JWT é emitido com `expiresIn: '7d'` e não existe mecanismo de revogação (blacklist). Se um token for roubado, o atacante tem 7 dias de acesso. Se o usuário trocar a senha ou for desativado, o token antigo continua válido.
- **Cenário de exploração:** 
  1. Admin desativa um usuário comprometido
  2. O usuário (ou atacante) continua usando o JWT antigo por até 7 dias
  3. Não há como revogar o token
- **Correção recomendada:**
  1. Reduzir JWT para 15-30 minutos
  2. Implementar refresh token (opaque, armazenado em cookie httpOnly) com rotação
  3. Manter blacklist de tokens em Redis
  4. Verificar `user.isActive` no `authMiddleware` (consulta ao banco ou cache)

---

### SEC-08 — Ausência Total de Security Headers
- **Severidade:** 🟠 ALTA
- **Categoria:** XSS / Clickjacking / MIME Sniffing
- **Local:** `backend/src/server.ts` (ausência)
- **Descrição:** O servidor não configura nenhum header de segurança HTTP: sem Helmet, sem Content-Security-Policy, sem X-Frame-Options (global), sem X-Content-Type-Options (global), sem Strict-Transport-Security, sem Referrer-Policy. Apenas o módulo `shared-links` define X-Frame-Options e X-Content-Type-Options pontualmente.
- **Correção recomendada:**
```bash
npm install @fastify/helmet
```
```typescript
await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", env.FRONTEND_URL],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Ajustar conforme necessidade
})
```

---

### SEC-09 — Enumeração de Usuários no Endpoint de Registro
- **Severidade:** 🟠 ALTA
- **Categoria:** Autenticação / Information Disclosure
- **Local:** `backend/src/modules/auth/auth.service.ts`, linhas 56-58; `auth.controller.ts`, linhas 36-38
- **Descrição:** O endpoint `POST /api/auth/register` retorna `409 - Email already registered` quando o email já existe, permitindo que um atacante enumere endereços de email válidos no sistema.
- **Evidência:**
```typescript
// auth.service.ts
if (existingUser) {
  throw new Error('Email already registered')
}

// auth.controller.ts
if (error.message === 'Email already registered') {
  return reply.status(409).send({ error: error.message })
}
```
- **Correção recomendada:** Retornar a mesma resposta genérica independente de o email existir ou não. Em caso de email já registrado, retornar `201` com mensagem genérica como "Se o email não estiver em uso, uma conta será criada" (ou enviar email de verificação e não revelar se existe).

---

### SEC-10 — Uploads Sem Validação de Extensão ou MIME Type
- **Severidade:** 🟠 ALTA
- **Categoria:** Upload de Arquivos Maliciosos
- **Local:** `backend/src/modules/schedules/schedule.routes.ts`, linhas 511-549; `backend/src/modules/webhooks/webhook.routes.ts`, linhas 1015-1025
- **Descrição:** O upload de mídia aceita qualquer tipo de arquivo. Não há whitelist de extensões, não há validação de MIME type real (magic bytes), não há antivírus/scan. O `safeName` apenas sanitiza caracteres, mas não bloqueia `.php`, `.js`, `.html`, `.svg` (vetor XSS), `.exe`, etc.
- **Evidência:**
```typescript
// schedule.routes.ts:540
const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
const savedName = `${randomUUID()}-${safeName}`
// ❌ Sem validação de extensão ou MIME
await writeFile(join(uploadsDir, savedName), fileBuffer)
```
- **Cenário de exploração:** Upload de arquivo `.html` com JavaScript malicioso → acesso via `/uploads/uuid-malicious.html` → XSS stored.
- **Correção recomendada:**
```typescript
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.mp3', '.mp4', '.ogg', '.opus']
const ext = path.extname(safeName).toLowerCase()
if (!ALLOWED_EXTENSIONS.includes(ext)) {
  return reply.status(400).send({ error: 'Tipo de arquivo não permitido' })
}
```

---

### SEC-11 — Debug Logs em `/tmp/` com Dados Sensíveis
- **Severidade:** 🟠 ALTA
- **Categoria:** Exposição de Dados
- **Local:** `backend/src/modules/automations/automation.routes.ts`, linhas 247, 551-555, 563; `backend/src/modules/messages/message.routes.ts`, linha 1570
- **Descrição:** O sistema escreve logs de debug em `/tmp/trigger-debug.log`, `/tmp/template-debug.log` e `/tmp/debug-api.log` contendo payloads completos de webhooks, templates com variáveis (CPF, PIX, valores financeiros), respostas da Meta API.
- **Evidência:**
```typescript
fs.appendFileSync('/tmp/trigger-debug.log', `\n[${new Date().toISOString()}] RAW PAYLOAD:\n${JSON.stringify(payload, null, 2)}\n`)
fs.appendFileSync('/tmp/template-debug.log', `variables: ${JSON.stringify(variables)}\n`)
```
- **Impacto real:** Qualquer processo no servidor (ou usuário com acesso ao container) pode ler `/tmp/` e ver dados de clientes, valores financeiros, tokens de API.
- **Correção recomendada:** Remover TODOS os `appendFileSync` de `/tmp/`. Usar um logger estruturado (Pino, que já vem com Fastify) com levels de log e rotação.

---

### SEC-12 — Rate Limit com Fallback FAIL OPEN
- **Severidade:** 🟠 ALTA
- **Categoria:** Disponibilidade / Brute Force
- **Local:** `backend/src/modules/shared-links/shared-links.routes.ts`
- **Descrição:** A função `checkRateLimit()` retorna `true` (permitir) quando Redis está indisponível, efetivamente desabilitando toda proteção de rate limiting.
- **Evidência:**
```typescript
} catch {
  return true  // ❌ FAIL OPEN — permite tudo quando Redis cai
}
```
- **Correção:** Trocar para `return false` (FAIL CLOSED).

---

### SEC-13 — Timing Attack na Comparação de Token de Webhook
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Criptografia
- **Local:** `backend/src/modules/webhook-entrada/webhook-entrada.routes.ts`
- **Descrição:** A comparação de token usa `!==` que faz early exit no primeiro byte diferente, tornando possível um timing attack para descobrir o token byte a byte.
- **Correção:** Usar `crypto.timingSafeEqual()`.

---

### SEC-14 — Rotas Públicas de Proposta/Contrato Expõem Dados Internos
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Exposição de Dados
- **Local:** `backend/src/modules/proposals/proposal.routes.ts`, rotas `/public/:hash`; `backend/src/modules/contracts/contract.routes.ts`, rotas `/public/:hash`
- **Descrição:** Os endpoints públicos (acessíveis sem autenticação) retornam o objeto completo da proposta/contrato incluindo `internalNote`, `activities`, `createdBy` — dados que deveriam ser visíveis apenas internamente.
- **Correção:** Criar um DTO/select explícito que exclua campos internos.

---

### SEC-15 — Redis Sem Autenticação
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Infraestrutura
- **Local:** `backend/src/config/redis.ts`; `docker-compose.yml`
- **Descrição:** Redis roda sem senha e (no docker-compose.yml) expõe a porta 6379. Se o servidor estiver acessível na rede, qualquer pessoa pode ler/escrever no Redis (sessions, rate limits, filas).
- **Correção:** Adicionar `requirepass` no Redis e `password` na conexão. Não expor a porta 6379 externamente.

---

### SEC-16 — bcrypt com 10 Rounds
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Criptografia
- **Local:** `backend/src/modules/auth/auth.service.ts`, linha 64
- **Descrição:** `bcrypt.hash(data.password, 10)` — 10 rounds é abaixo da recomendação OWASP atual de 12+.
- **Correção:** Alterar para `bcrypt.hash(data.password, 12)`.

---

### SEC-17 — JWT Fallback via Query Parameter
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Autenticação
- **Local:** `backend/src/middlewares/auth.middleware.ts`, linhas 44-69
- **Descrição:** O middleware aceita JWT via `?token=` na URL, o que pode expor o token em server logs, proxy logs, referrer headers e histórico do navegador.
- **Correção:** Para SSE, usar transport via cookie httpOnly ao invés de query parameter.

---

### SEC-18 — `child_process.exec()` em Admin Routes
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Remote Code Execution
- **Local:** `backend/src/modules/admin/admin.routes.ts`, linhas 678-768
- **Descrição:** As rotas de update do sistema executam `git pull`, `npm install`, `npm run build` e `pm2 restart all` via `child_process.exec()`. Embora protegidas por `superAdminMiddleware`, os comandos são hardcoded (não parametrizados de user input), o risco é mitigado mas não eliminado.
- **Nota:** Os comandos executados são **fixos** e não recebem input do usuário — o risco é menor do que um exec com concatenação de input. No entanto, `exec()` usa shell, que pode ser vulnerável a variáveis de ambiente maliciosas.
- **Correção recomendada:** Usar `execFile()` (sem shell) quando possível. Adicionar audit logging para toda execução de comando.

---

### SEC-19 — Error Handler Expõe `error.message` em Respostas 500
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Information Disclosure
- **Local:** `backend/src/server.ts`, linhas 147-151
- **Descrição:**
```typescript
return reply.status(error.statusCode || 500).send({ error: error.message || 'Erro interno' })
```
Para erros 500, `error.message` pode conter stack traces, nomes de tabelas, detalhes de query Prisma, etc.
- **Correção:** Em produção, retornar mensagem genérica para status 500. Logar o erro completo no servidor.

---

### SEC-22 — API Tokens Sem Expiração
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Autenticação
- **Local:** `backend/src/middlewares/auth.middleware.ts`, linhas 89-109
- **Descrição:** Os API tokens (para instâncias) nunca expiram e não têm mecanismo de rotação automática. Se vazados, concedem acesso permanente.
- **Correção:** Adicionar campo `apiTokenExpiresAt` e `apiTokenLastRotatedAt`. Implementar rotação periódica.

---

### SEC-23 — Lead `findUnique` Sem `companyId`
- **Severidade:** 🟡 MÉDIA
- **Categoria:** Multi-Tenancy / IDOR
- **Local:** `backend/src/modules/leads/lead.routes.ts`
- **Descrição:** `prisma.leadProfile.findUnique({ where: { contactId } })` sem filtro de `companyId`, permitindo verificar se um contacto é lead em outra empresa.
- **Correção:** Usar `findFirst` com `companyId` adicionado ao WHERE.

---

### SEC-25 — Ausência de Rate Limiting em Login/Register
- **Severidade:** 🟠 ALTA
- **Categoria:** Brute Force
- **Local:** `backend/src/modules/auth/auth.routes.ts`, linhas 10-11
- **Descrição:** Os endpoints `POST /api/auth/login` e `POST /api/auth/register` não possuem rate limiting, permitindo ataques de força bruta ilimitados.
- **Correção:** Implementar rate limiting: `max: 5 tentativas / minuto por IP` para login, `max: 3 / minuto` para registro.

---

### SEC-26 — Webhook de Pagamento Asaas Sem Validação de Assinatura
- **Severidade:** 🟠 ALTA
- **Categoria:** Webhooks / Financeiro
- **Local:** `backend/src/modules/payments/payment.routes.ts`
- **Descrição:** O webhook `POST /api/payments/webhook/asaas` aceita notificações sem validar a assinatura HMAC do Asaas. Um atacante pode enviar notificações falsas marcando faturas como pagas.
- **Correção:** Validar o header de assinatura do Asaas (`asaas-access-token`) contra o token configurado para a empresa.

---

## 4. ANÁLISE DE AUTENTICAÇÃO

### Login
- ✅ `bcrypt.compare()` para validação de senha
- ✅ Mensagem genérica em caso de erro (`Invalid credentials`)
- ❌ **Sem rate limiting** — brute force possível
- ❌ **Sem lockout** após tentativas falhas
- ❌ **Sem logging** de tentativas falhas (sem audit trail)

### Sessão
- ❌ **JWT de longa duração (7 dias)** sem mecanismo de revogação
- ❌ **Sem refresh token** — token único para tudo
- ❌ **Sem verificação de `isActive`** no middleware (usuário desativado mantém acesso até token expirar)
- ❌ **Sem blacklist de tokens**

### Cookies
- ❌ **JWT não usa cookies httpOnly** — armazenado em localStorage

### JWT
- ✅ Assinado via `@fastify/jwt`
- ❌ **JWT_SECRET fraco** no docker-compose de dev (`crm-impa-dev-secret-key-local-2026`)
- ❌ **Sem requisito de comprimento mínimo** para JWT_SECRET em produção
- ❌ **Claims incluem role, permissions, companyId** — se comprometido, privilégio total
- ✅ Role/permissions lidas do token, validadas server-side via middleware

### Reset Senha
- ❌ **Não implementado** — não existe endpoint de reset/forgot password

### Convites
- ❌ **Não auditado** — endpoint de criação de usuário não envia convite por email, cria direto

### Brute Force
- ❌ **Sem proteção** — sem rate limiting, sem CAPTCHA, sem lockout

### Enumeração
- ❌ **Possível** — endpoint de registro confirma existência de email (409)

### MFA/2FA
- ❌ **Não implementado**

### Logout/Revogação
- ⚠️ **Apenas client-side** — frontend limpa localStorage, mas o token continua válido por até 7 dias

---

## 5. ANÁLISE DE AUTORIZAÇÃO

### Roles e Permissões
- ✅ RBAC implementado com `rbacRole`, `permissions` granulares
- ✅ Middleware `requirePermission()` e `requireAnyPermission()`
- ✅ Permissions carregadas do BD e embutidas no JWT
- ❌ **Admin bypass total** — `if (role === 'admin') return` em `requirePermission()` — admin pula TODAS as verificações de permissão

### Super Admin
- ✅ `superAdminMiddleware` verifica `isSuperAdmin === true`
- ✅ Rotas `/api/admin` protegidas por `authMiddleware + superAdminMiddleware`
- ❌ **`isSuperAdmin` no JWT** — se token forjado, acesso total

### Escopo por Tenant
- ✅ `scopedWhere()` existe e é usado em vários módulos
- ❌ **Não é enforçado automaticamente** — cada rota/query precisa usar explicitamente
- ❌ **Sem Prisma middleware global** para auto-scoping

### IDOR / BOLA / BFLA
- ✅ A maioria das queries filtra por `companyId`
- ❌ **Lead `findUnique` sem companyId** (SEC-23)
- ⚠️ Verificar outros módulos para patterns similares

### Mass Assignment
- ✅ Zod schemas validam input
- ⚠️ Alguns endpoints usam spread operator (`...data`) — risco se schema for expandido

### Overposting
- ✅ Zod schemas limitam campos aceitos
- ⚠️ Campos como `companyId`, `role`, `isSuperAdmin` não são aceitados nos schemas — ✅ correto

---

## 6. ANÁLISE DE MULTI-TENANCY

### Risco de Vazamento Entre Empresas
- ❌ **WebSocket sem escopo** (SEC-02) — maior risco
- ❌ **Uploads compartilhados** (SEC-03) — sem isolamento por diretório
- ❌ **Lead queries sem companyId** (SEC-23)
- ✅ Maioria das queries Prisma filtra `companyId`

### Endpoints Sem Escopo
- ❌ `GET /uploads/*` — sem verificação de tenant
- ❌ WebSocket `join-instance` / `join-pipeline` — sem verificação de tenant
- ❌ Webhook Asaas busca payment por `transactionId` sem `companyId`

### Queries Perigosas
- ❌ `$queryRawUnsafe` em message.routes.ts (SEC-01)
- ⚠️ `$executeRawUnsafe` em `retrieval.service.ts` (parametrizado, risco menor)

### Jobs / Caches / WebSockets
- ❌ **WebSocket** — sem isolamento de tenant
- ⚠️ **Bull queues** — verificar se jobs de uma empresa podem afetar outra
- ✅ **Redis rate limit** — keyed por instanceId, o que dá isolamento natural

### Arquivos / Documentos Cross-Tenant
- ❌ **Uploads em diretório plano** — sem separação por empresa

---

## 7. ANÁLISE DE INJEÇÃO

### SQL Injection
- ❌ **CONFIRMADA** — `$queryRawUnsafe` com interpolação de variáveis (SEC-01)
- ⚠️ `$executeRawUnsafe` em `retrieval.service.ts` — usa `$1` parametrizado, risco menor

### Blind SQL Injection
- ⚠️ **Possível via SEC-01** se atacante conseguir injetar nos claims do JWT

### Raw Queries
- Apenas 2 ocorrências encontradas:
  1. `message.routes.ts:426` — ❌ VULNERÁVEL
  2. `retrieval.service.ts:272` — ⚠️ Parametrizada, menor risco

### Filtros e Dashboards
- ✅ Reports e dashboards usam Prisma ORM (não raw SQL)
- ✅ Filtros de busca usam `.includes()` em memória após query, não em SQL dinâmico

### Outros Tipos
- ❌ **Command Injection** — `child_process.exec()` em admin e ASR, mas sem input do usuário direto
- ⚠️ **Path Traversal** — Uploads usam `randomUUID()` como prefixo, mitigando parcialmente, mas sem validação de `../` no nome original
- ✅ Sem NoSQL Injection (PostgreSQL)
- ✅ Sem LDAP/XPath (não utilizado)

---

## 8. ANÁLISE DE DOCUMENTOS E LINKS PÚBLICOS

### Propostas
- ✅ Hash UUID (128 bits de entropia) — não previsível
- ✅ Validação via Zod (`z.string().uuid()`) no parâmetro
- ❌ **Expõe `internalNote` e `activities`** (SEC-14)
- ✅ Aceitação registra `acceptanceName` + `acceptanceIp` (auditoria)
- ❌ **Sem rate limiting** em accept/decline

### Faturas
- ✅ Hash UUID para visualização pública
- ⚠️ Verificar se retorna dados sensíveis

### Contratos
- ✅ Hash UUID para visualização pública
- ❌ **Expõe dados internos** (similar a propostas)

### Shared Links
- ✅ Token gerado com `crypto.randomBytes(32)` — 256 bits de entropia — excelente
- ✅ Proteção por senha com bcrypt (12 rounds)
- ✅ Rate limiting implementado (mas com FAIL OPEN — SEC-12)
- ❌ **FAIL OPEN no rate limiting**

### PDFs
- ⚠️ Não auditada a geração de PDF — verificar se usa libs seguras

### Tracking
- ⚠️ Verificar se tracking de visualização registra IP/user-agent

---

## 9. ANÁLISE DE UPLOADS / ARQUIVOS / MÍDIA

- ❌ **Sem whitelist de extensões** (SEC-10) — aceita .html, .svg (XSS), .php, etc.
- ❌ **Sem validação de MIME real** (magic bytes)
- ❌ **Sem antivírus/scan**
- ❌ **Diretório plano** — sem isolamento por tenant (SEC-03)
- ❌ **Servido publicamente** — sem autenticação (SEC-03)
- ✅ **UUID como prefixo** — dificulta enumeração
- ✅ **Nome sanitizado** — `replace(/[^a-zA-Z0-9._-]/g, '_')`
- ❌ **Sem prevenção de path traversal** no nome do arquivo (apesar da sanitização remover `/`, o filtro `[^a-zA-Z0-9._-]` permite apenas chars seguros)
- ⚠️ **Limite de 50MB** — pode ser usado para DoS via disk fill

### Webhook save (webhook.routes.ts)
- ❌ **Extensão derivada de `documentMessage.fileName`** do payload externo — atacante pode escolher extensão
- ✅ UUID como prefixo no nome salvo

---

## 10. ANÁLISE DE WEBHOOKS / AUTOMAÇÕES / INTEGRAÇÕES

### Webhooks Recebidos
| Webhook | Autenticação | Assinatura | Risco |
|---------|------------|-----------|-------|
| Meta Cloud API | ✅ Challenge | ✅ Token verify | Baixo |
| Evo Go | ❌ Nenhuma | ❌ Nenhuma | **CRÍTICO** |
| Webhook Entrada | ⚠️ Token compare | ❌ Timing vulnerable | Médio |
| Asaas Payment | ❌ Nenhuma | ❌ Nenhuma | **ALTO** |
| Chatwoot | ❌ Nenhuma | ❌ Nenhuma | Alto |

### Automações
- ✅ Automações verificam `companyId` antes de executar ações
- ❌ **Logs de debug em `/tmp/`** com payloads (SEC-11)
- ⚠️ Verificar se automações podem ser gatilhadas via webhook forjado

### Replay Attack
- ❌ **Sem proteção contra replay** — mesmo payload pode ser reenviado infinitamente
- **Recomendação:** Adicionar `timestamp` check e nonce/idempotency key

---

## 11. ANÁLISE DE FRONTEND E EXPOSIÇÃO CLIENT-SIDE

### Token / Credenciais
- ❌ **JWT em localStorage** (SEC-06)
- ❌ **Credenciais de instância visíveis** no state do frontend (SEC-04)
- ⚠️ User object com `role`, `permissions`, `companyId` em localStorage

### Proteção de Ações
- ⚠️ Frontend esconde botões basado em `permissions` — mas servidamente protegido via middleware (✅ correto)
- ⚠️ Verificar se todas as ações sensíveis no frontend realmente chamam endpoints protegidos

### Manipulação Client-Side
- ✅ `companyId`, `role`, `isSuperAdmin` NÃO são enviados pelo frontend — são extraídos do JWT server-side
- ✅ `request.user.companyId` vem do JWT verificado, não do body/params
- ✅ Frontend não pode manipular role/companyId — dados vêm do token assinado

---

## 12. CHECKLIST DE HARDENING

### Implementar IMEDIATAMENTE (24h)
- [ ] **Corrigir SQL Injection** — substituir `$queryRawUnsafe` por `$queryRaw` em message.routes.ts
- [ ] **Autenticar WebSocket** — adicionar middleware JWT no Socket.IO com verificação de companyId
- [ ] **Proteger uploads** — criar rota autenticada ou organizar por companyId
- [ ] **Remover credenciais das respostas** — não retornar `accessToken`, `evoApiKey`, `webhookSecret` para o frontend
- [ ] **Remover debug logs** — eliminar todos os `appendFileSync('/tmp/...')`
- [ ] **Adicionar rate limiting** em login e registro

### Bloquear
- [ ] Redis exposto sem senha (adicionar `requirepass`)
- [ ] Qdrant exposto nas portas 6333/6334 (restringir a rede interna)
- [ ] Servir `/uploads/` sem autenticação

### Refatorar
- [ ] JWT para cookies httpOnly com refresh token
- [ ] JWT_EXPIRES_IN de 7d para 15-30min
- [ ] Implementar blacklist de tokens em Redis
- [ ] Verificar `user.isActive` no authMiddleware
- [ ] Separar uploads por `companyId` em subdiretórios

### Monitorar
- [ ] Implementar audit logging para ações sensíveis (delete, update role, login, etc.)
- [ ] Alertas para tentativas de acesso não autorizado
- [ ] Logging estruturado com correlação de requests
- [ ] Monitoramento de rate limit hits

---

## 13. ROADMAP DE CORREÇÃO

### 24 Horas — EMERGENCIAIS
1. **SEC-01** — Fix SQL Injection em `message.routes.ts` (substituir por `$queryRaw`)
2. **SEC-02** — Autenticar WebSocket com JWT + verificação de ownership
3. **SEC-05** — Adicionar validação de assinatura no webhook Evo Go
4. **SEC-11** — Remover TODOS os `appendFileSync('/tmp/...')` do código
5. **SEC-25** — Adicionar rate limiting em `/api/auth/login` e `/api/auth/register`

### 7 Dias — ALTA PRIORIDADE
6. **SEC-03** — Proteger diretório de uploads (autenticação + separação por tenant)
7. **SEC-04** — Remover credenciais sensíveis dos responses de instância
8. **SEC-06** — Migrar JWT de localStorage para cookie httpOnly
9. **SEC-07** — Reduzir JWT para 15min + implementar refresh token
10. **SEC-08** — Instalar e configurar `@fastify/helmet`
11. **SEC-10** — Implementar whitelist de extensões em uploads
12. **SEC-26** — Validar assinatura no webhook Asaas
13. **SEC-12** — Corrigir rate limit para FAIL CLOSED

### 30 Dias — MÉDIA PRIORIDADE
14. **SEC-09** — Eliminar enumeração de usuários
15. **SEC-13** — Usar `crypto.timingSafeEqual` para comparação de tokens
16. **SEC-14** — Filtrar campos internos em rotas públicas de propostas/contratos
17. **SEC-15** — Configurar senha no Redis
18. **SEC-16** — Aumentar bcrypt rounds para 12
19. **SEC-17** — Eliminar JWT via query parameter (usar cookies para SSE)
20. **SEC-19** — Error handler genérico para 500 em produção
21. **SEC-22** — Implementar expiração e rotação de API tokens
22. **SEC-23** — Corrigir query de lead sem companyId
23. Implementar audit logging completo
24. Verificar `user.isActive` no authMiddleware

### 90 Dias — HARDENING COMPLETO
25. Implementar MFA/2FA para admins e super admins
26. Implementar proteção contra replay attack em webhooks
27. Criar Prisma middleware para auto-scope por companyId
28. Implementar CSRF protection
29. Revisão de segurança de dependências (`npm audit`)
30. Penetration test externo
31. Implementar WAF (Web Application Firewall)
32. Documentar política de segurança
33. Implementar rotation automática de JWT_SECRET
34. Implementar mecanismo de revogação de todas as sessões de um usuário

---

## 14. TESTES DE REGRESSÃO DE SEGURANÇA

Execute estes testes após cada correção:

### Autenticação
- [ ] `POST /api/auth/login` com senha errada → 401 (não revela se email existe)
- [ ] `POST /api/auth/login` 10x em 1 minuto → 429 (rate limited)
- [ ] `POST /api/auth/register` com email existente → resposta genérica (não 409)
- [ ] Acessar rota protegida com token expirado → 401
- [ ] Acessar rota protegida sem Authorization header → 401
- [ ] Login com user `isActive: false` → 401

### Multi-Tenancy
- [ ] `GET /api/conversations` com token da empresa A → não retorna conversas da empresa B
- [ ] `GET /uploads/arquivo-empresa-B.pdf` com token empresa A → 403
- [ ] WebSocket `join-instance` com instanceId de outra empresa → erro/disconnect
- [ ] `GET /api/customers/:id` com customerId de outra empresa → 404
- [ ] `GET /api/invoices/:id` com invoiceId de outra empresa → 404

### Injeção
- [ ] Enviar `'; DROP TABLE users;--` em campos de busca → sem erro SQL, dados não afetados
- [ ] Verificar que `message.routes.ts` usa `$queryRaw` (tagged template) e não `$queryRawUnsafe`
- [ ] Nenhum `$queryRawUnsafe` com interpolação de variáveis em todo o codebase

### Uploads
- [ ] Upload de `.html` → rejeitado
- [ ] Upload de `.php` → rejeitado
- [ ] Upload de `.svg` com JS embutido → rejeitado
- [ ] Acessar `/uploads/` sem autenticação → 401 ou 403

### WebSocket
- [ ] Conectar sem token → conexão recusada
- [ ] Conectar com token válido da empresa A, join-instance B → erro
- [ ] Conectar, revogar token, verificar desconexão

### Webhooks
- [ ] `POST /api/webhook/evo-go/:id` sem assinatura → 401
- [ ] `POST /api/webhook/evo-go/:id` com assinatura inválida → 401
- [ ] `POST /api/payments/webhook/asaas` sem assinatura → 401

### Headers
- [ ] Resposta contém `X-Content-Type-Options: nosniff`
- [ ] Resposta contém `X-Frame-Options: DENY`
- [ ] Resposta contém `Strict-Transport-Security`
- [ ] Resposta contém `Content-Security-Policy`

### CORS
- [ ] Request de origem não autorizada → bloqueado
- [ ] Sem `access-control-allow-origin: *` em produção

---

## 15. CONCLUSÃO FINAL

### Maiores Riscos
1. **SQL Injection via $queryRawUnsafe** — risco de comprometimento total do banco de dados
2. **WebSocket sem autenticação** — vazamento em tempo real de dados de qualquer tenant
3. **Uploads públicos compartilhados** — acesso a documentos de qualquer empresa
4. **Credenciais de terceiros no frontend** — comprometimento de integrações
5. **Webhooks sem assinatura** — injeção de dados falsos (mensagens, pagamentos)

### Prioridade Máxima
Corrigir SEC-01 (SQL Injection), SEC-02 (WebSocket), SEC-03 (Uploads) e SEC-05 (Webhook) antes de qualquer deploy em produção.

### Risco de Invasão Real Hoje
**SIM** — O sistema está vulnerável a ataques reais. Especificamente:
- Um atacante com acesso à rede pode interceptar dados de qualquer empresa via WebSocket
- Um token JWT comprometido pode levar a SQL Injection com impacto catastrófico
- Webhooks forjados podem injetar mensagens e pagamentos falsos
- Uploads maliciosos podem levar a XSS stored

### O Que Impede o Sistema de Ser Considerado Robusto
1. Falta de security headers básicos
2. Falta de rate limiting nos endpoints mais sensíveis
3. Falta de autenticação em WebSocket
4. Falta de isolamento de arquivos por tenant
5. Falta de validação de assinatura em webhooks
6. JWT de longa duração sem revogação
7. Ausência de MFA
8. Ausência de audit logging
9. Debug logs com dados sensíveis em produção
10. SQL raw sem parametrização

### Nota Final
O CRM IMPA tem uma **boa base arquitetural** — uso de Zod para validação, RBAC implementado, separação de módulos. As falhas encontradas são típicas de sistemas em desenvolvimento rápido e podem ser corrigidas sistematicamente. **Recomendo fortemente** seguir o roadmap de correções antes de expor o sistema à internet pública fora de um ambiente controlado.

---

## 16. ANÁLISE DE SEGURANÇA DE ARQUIVOS E ANEXOS

### 16.1 Mapa da Arquitetura de Storage

| Componente | Estado Atual |
|---|---|
| Storage | Filesystem local (`/app/uploads/` no container Docker) |
| Volume Docker | `backend_uploads` (volume nomeado) |
| Estrutura | **Diretório plano** — todos os arquivos de todas as empresas no mesmo diretório |
| Subdiretórios | Apenas `/uploads/avatars/` — tudo mais vai na raiz |
| Separação por tenant | **INEXISTENTE** — nenhuma subpasta por `companyId` |
| Servindo arquivos | `@fastify/static` (sem auth) + nginx proxy |
| Nomeação | `{UUID}-{safeName}` (uploads), `{UUID}.{ext}` (webhook), `{jid_sanitizado}.jpg` (avatars) |
| Autenticação no download | **NENHUMA** — URL pública direta |
| Autorização por tenant | **NENHUMA** — qualquer URL válida retorna o arquivo |

### 16.2 Modelo Atual de Isolamento entre Empresas

**Não existe isolamento real.** O estado atual é:

- Todos os arquivos de todas as empresas ficam em `/uploads/` (diretório plano)
- O `@fastify/static` serve qualquer arquivo sob `/uploads/` sem verificar JWT, sem verificar `companyId`, sem verificar permissão
- O nginx faz proxy para o backend sem adicionar autenticação
- O UUID no nome do arquivo **dificulta adivinhação**, mas **não constitui isolamento, autorização ou controle de acesso**
- Se qualquer URL vazar por qualquer vetor (log, print, frontend, webhook, histórico de conversa, referrer, e-mail, bug de listagem, usuário da própria empresa copiando e colando), o arquivo continua acessível sem nenhuma barreira

### 16.3 Vulnerabilidades Encontradas e Status de Correção

| # | Severidade | Vulnerabilidade | Status |
|---|---|---|---|
| 1 | 🔴 CRITICAL | Arquivos acessíveis por URL sem autenticação/autorização por tenant — qualquer pessoa com a URL acessa qualquer arquivo de qualquer empresa | ❌ **NÃO CORRIGIDO** — nomes UUID dificultam adivinhação, mas não substituem auth |
| 2 | 🔴 CRITICAL | Zero isolamento de tenant no storage — todos os arquivos de todas as empresas no mesmo diretório lógico/físico, sem separação | ❌ **NÃO CORRIGIDO** — déficit estrutural de arquitetura |
| 3 | 🔴 CRITICAL | Upload sem validação de tipo permitia envio de conteúdo arbitrário (.html, .svg, .exe, .php, etc.) | ✅ **CORRIGIDO PARCIALMENTE** — blocklist de extensões perigosas implementada em todos os endpoints de upload. Ainda falta: allowlist explícita, validação de MIME real (magic bytes), scan de conteúdo |
| 4 | 🟠 HIGH | Renderização insegura de arquivos podia permitir XSS via conteúdo servido inline no navegador | ✅ **CORRIGIDO PARCIALMENTE** — headers de segurança aplicados (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `CSP`), force-download para tipos perigosos. Headers reduzem impacto mas não substituem auth |
| 5 | 🟠 HIGH | Debug log em `/tmp/debug-api.log` gravando `request.body` completo (tokens, números, dados de clientes) | ✅ **CORRIGIDO** — removido de `message.routes.ts`. Verificar se restam outros em `automation.routes.ts` |
| 6 | 🟠 HIGH | Avatars com nomes previsíveis baseados no telefone (`5511999999999_s_whatsapp_net.jpg`) — permite enumeração, scraping e correlação de identidade | ⚠️ **MITIGADO PARCIALMENTE** — são apenas fotos de perfil público, mas o padrão previsível facilita enumeração de números ativos no sistema sem auth |
| 7 | 🟡 MEDIUM | `CardFile` e `Message` sem `companyId` direto — isolamento depende de joins corretos e filtros consistentes em toda query | ⚠️ **PENDENTE** — não é falha imediata, mas isolamento indireto é mais frágil e mais fácil de errar em futuras rotas/refactors |
| 8 | 🟡 MEDIUM | Ausência de cleanup/retenção de arquivos órfãos — sem política de exclusão, sem expiração | ⚠️ **PENDENTE** — passivo de segurança e LGPD |
| 9 | 🟡 MEDIUM | Webhook Evo Go podia persistir arquivo com extensão controlada externamente (via `documentMessage.fileName`) | ✅ **CORRIGIDO** — extensões perigosas convertidas para `.bin` |

### 16.4 Riscos Adicionais Identificados

#### A. Vazamento por URL Compartilhada
Mesmo sem enumeração, qualquer URL pública de arquivo copiada ou vazada (via e-mail, chat, log, referrer, bug, erro de listagem, ou simplesmente um usuário colando a URL em outro lugar) **continua acessível indefinidamente para qualquer pessoa**, sem controle, sem expiração, sem trilha de acesso.

- **Impacto:** Dados de clientes, documentos, mídias de conversas acessíveis por qualquer pessoa que obtenha a URL.
- **Probabilidade:** Alta — URLs aparecem em payloads de webhook, em respostas de API, no frontend, em logs, em histórico de navegação.

#### B. Ausência de Trilha de Auditoria de Download
Não existe nenhum registro de quem baixou qual arquivo, quando, de qual IP, de qual tenant. Se ocorrer um vazamento, **não há como investigar a origem ou escopo**.

- **Impacto:** Impossibilidade de forensics em caso de incidente.
- **Requisito:** Qualquer sistema multi-tenant com dados sensíveis precisa de audit log de acesso a arquivos.

#### C. Ausência de Política de Exclusão e Retenção
Não existe:
- Expiração automática de arquivos temporários
- Soft delete com período de retenção
- Hard delete com confirmação
- Exclusão de arquivo ao excluir a mensagem/entidade vinculada
- Política de retenção por tipo de arquivo ou por tenant
- Compliance com LGPD para exclusão de dados pessoais em arquivos

**Impacto:** Passivo jurídico (LGPD), crescimento descontrolado do storage, arquivos de tenants cancelados permanecem acessíveis.

#### D. Ausência de Separação entre Arquivo "Interno" e Arquivo "Compartilhável"
Todo arquivo é tratado da mesma forma — mesma URL, mesmo acesso. Não há distinção entre:
- Arquivo interno (documento financeiro, contrato) que nunca deveria sair do sistema
- Arquivo compartilhável (image de produto, catálogo) que pode ter link público controlado

**Impacto:** Qualquer tipo de arquivo tem o mesmo nível de exposição, sem gradação de sensibilidade.

### 16.5 Veredito Técnico — Segurança de Arquivos

As correções implementadas (blocklist de extensões, security headers, force-download) **reduziram significativamente o risco de XSS via upload e de execução de conteúdo perigoso no navegador**. Essas são melhorias reais e necessárias.

**Entretanto, o storage ainda NÃO pode ser considerado multi-tenant seguro.** Os problemas estruturais permanecem:

1. **Arquivos continuam acessíveis por URL sem autenticação/autorização** — qualquer pessoa com a URL acessa o arquivo, independente de tenant
2. **Não existe separação lógica nem física por `companyId`** — todos os files de todas as empresas no mesmo diretório
3. **Não existe rota autenticada de download** com validação de tenant e permissão
4. **URLs são permanentes** em vez de temporárias/assinadas com expiração
5. **Não existe trilha de auditoria** de acesso/download de arquivos
6. **Não existe política de retenção ou exclusão**

**UUID no nome do arquivo NÃO é isolamento.** UUID apenas reduz a previsibilidade do nome físico. Não substitui autenticação, autorização por tenant, nem separação lógica/física dos arquivos. Se qualquer URL vazar por qualquer vetor, o arquivo está exposto.

**O estado atual é: "menos exposto do que antes", mas não "seguro para produção multi-tenant".**

> ⚠️ **AVISO:** Registrar hoje que "UUID mitiga isolamento" ou "dificulta adivinhação" pode ser usado amanhã como justificativa para **NÃO implementar auth real**. É fundamental que este documento não sirva como atestado de segurança aceitável. UUID é uma camada cosmética de obscuridade — não é controle de acesso.

**Não está aceitável como modelo final de segurança multi-tenant. Está, no máximo, "menos exposto do que antes".**

### 16.6 NOTA TÉCNICA — UUID NÃO É MECANISMO DE ISOLAMENTO

UUID no nome do arquivo **apenas torna o nome mais difícil de adivinhar**. Isso é obscuridade, não segurança. Não substitui autenticação, autorização, nem separação por tenant.

Para que UUID fosse isolamento, seria necessário que a **única forma de obter a URL** fosse uma consulta autenticada e autorizada. Hoje não é o caso — a URL pode vazar por múltiplos vetores:

#### Vetores de vazamento — Sistema
| Vetor | Descrição |
|---|---|
| Logs de aplicação | `mediaUrl` aparece em logs de request, response, erro, webhook |
| Frontend | URL fica visível no DOM, no Network tab, no cache do navegador |
| Payloads de API | Endpoints retornam `mediaUrl` como string fixa nos objetos de mensagem, card, proposta |
| Webhooks | Evo Go e outros serviços recebem `mediaUrl` no payload de entrada e saída |
| Referrer HTTP | Navegador pode enviar a URL completa do arquivo no header `Referer` ao navegar para outro site |

#### Vetores de vazamento — Humanos
| Vetor | Descrição |
|---|---|
| Copiar e colar | Usuário copia URL do arquivo e cola em e-mail, chat externo, planilha compartilhada |
| Print screen | Screenshot ou gravação de tela captura a URL na barra de endereço ou no DevTools |
| Forward de mensagem | Mensagem com URL é encaminhada para fora do sistema |

#### Vetores de vazamento — Infraestrutura
| Vetor | Descrição |
|---|---|
| Bug de listagem | Qualquer falha que exponha diretório ou lista de arquivos revela todas as URLs |
| Directory traversal | Vulnerabilidade de path traversal acessa arquivos por caminho relativo |
| Backup leak | Acesso não autorizado a backups expõe estrutura completa de `/uploads/` |
| Histórico de conversa | URL fica salva permanentemente no banco como parte da mensagem |

> Se vazar uma URL por **qualquer** desses vetores — pronto: o arquivo continua acessível para sempre, sem nenhuma barreira. Não há expiração, não há revogação, não há log de acesso.

### 16.7 REVISÃO PONTO A PONTO DAS CORREÇÕES IMPLEMENTADAS

#### Item 1 — Arquivos acessíveis sem autenticação (🔴 CRITICAL)
**Status: ❌ NÃO CORRIGIDO**

Nome imprevisível (UUID) **não resolve o problema-base**. O arquivo está disponível sem nenhum check de identidade, tenant ou permissão. Qualquer pessoa com a URL — obtida por qualquer vetor — acessa o conteúdo. Isso não é "risco aceito" ou "mitigado" — é simplesmente **não corrigido**.

A correção real é: **toda requisição de arquivo deve passar por uma rota que valide JWT (ou signed token), companyId, permissão do usuário e vínculo do arquivo com a entidade correta.**

#### Item 2 — Zero separação por tenant no storage (🔴 CRITICAL)
**Status: ❌ NÃO CORRIGIDO — Déficit estrutural de arquitetura**

Não é "risco aceito". É um déficit estrutural de arquitetura. Todos os arquivos de todas as empresas ficam misturados no mesmo diretório. Consequências diretas:

1. **Risco de cross-tenant leak** — qualquer bug de listagem ou path traversal expõe arquivos de TODAS as empresas simultaneamente
2. **Impossibilidade de cleanup por tenant** — não dá para excluir arquivos de um tenant cancelado sem varrer o banco inteiro
3. **Impossibilidade de auditoria por tenant** — não dá para auditar storage de uma empresa isoladamente
4. **Impossibilidade de política de retenção por tenant** — não dá para aplicar regras diferentes por cliente/plano

A correção real é: migrar para `/uploads/{companyId}/{entityType}/{uuid}.{ext}` com `companyId` como primeiro nível de diretório.

#### Item 3 — Blocklist de extensões perigosas (🔴 CRITICAL → ✅ PARCIAL)
**Status: ✅ CORRIGIDO PARCIALMENTE**

Extensões perigosas (.html, .svg, .exe, .php, etc.) são bloqueadas em todos os endpoints de upload. Isso elimina o vetor mais óbvio de XSS/RCE via upload. No entanto, **blocklist é inerentemente incompleta**. Ainda falta:

- **Allowlist explícita** — aceitar APENAS extensões conhecidas (.jpg, .png, .pdf, .doc, .mp3, .mp4, etc.) em vez de negar as perigosas
- **Validação de MIME real** — verificar magic bytes (primeiros bytes do arquivo) para confirmar que o conteúdo corresponde à extensão
- **Tratamento de arquivo ambíguo** — arquivo cuja extensão diz `.pdf` mas o conteúdo é HTML deve ser rejeitado ou quarentenado
- **Scan opcional** — ClamAV ou similar para detecção de malware em arquivos enviados

#### Item 4 — Security headers + force-download (🟠 HIGH → ✅ CORRIGIDO)
**Status: ✅ CORRIGIDO**

Headers de segurança implementados: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: private, no-cache`. Tipos perigosos forçam download (`Content-Disposition: attachment`).

**Ressalva importante:** Headers **reduzem o impacto** de um arquivo malicioso acessado pelo navegador, mas **não substituem autenticação**. O arquivo continua acessível sem auth — apenas é mais difícil explorá-lo para XSS.

#### Item 5 — Avatars com nomes previsíveis (🟠 HIGH)
**Status: ⚠️ MITIGADO PARCIALMENTE**

Avatars usam o JID (telefone sanitizado) como nome: `5511999999999_s_whatsapp_net.jpg`. Não são dados sensíveis (são fotos de perfil público do WhatsApp), mas levantam 3 preocupações:

1. **Enumeração** — possível iterar telefones e descobrir quais estão ativos no sistema
2. **Scraping** — coletar fotos de perfil em massa de contatos do CRM
3. **Correlação de identidade** — vincular números de telefone a empresas clientes do CRM ao descobrir quais avatars existem

**Recomendação:** usar nomes puramente aleatórios (UUID) para avatars, com mapeamento JID → UUID no banco. Custo baixo, benefício real.

#### Item 6 — CardFile e Message sem companyId direto (🟡 MEDIUM)
**Status: ⚠️ PENDENTE — Risco de isolamento indireto**

`CardFile` e `Message` não possuem `companyId` como coluna direta. O isolamento depende de joins corretos (Card → Pipeline → companyId, Message → Conversation → Instance → companyId). Isso funciona **enquanto todos os queries respeitarem os joins**. Riscos:

- Qualquer rota futura que acesse `CardFile` ou `Message` sem fazer o join correto **quebra o isolamento silenciosamente**
- Em refactors, é fácil esquecer de propagar o filtro de `companyId` por toda a cadeia de joins
- Queries de relatório, exportação ou bulk operations que pulam o join expõem dados de outros tenants

**Recomendação:** adicionar `companyId` direto em `CardFile` e `Message` (denormalização controlada), reforçado por `@@index` e validação no middleware.

---

## 17. MODELO IDEAL DE ISOLAMENTO DE ARQUIVOS POR TENANT

### 17.1 Comparação: Modelo Ideal vs Estado Atual

| Requisito de Segurança | Modelo Ideal | Estado Atual | Gap |
|---|---|---|---|
| Arquivo nunca é público por padrão | ✅ Acesso somente via rota autenticada | ❌ Público via URL estática | **CRÍTICO** |
| Arquivo sempre pertence a um tenant | ✅ `companyId` no path e no banco | ❌ Diretório único sem separação | **CRÍTICO** |
| Arquivo sempre vinculado a uma entidade | ✅ `ownerType` + `ownerId` | ⚠️ Parcial (mediaUrl é string livre) | **ALTO** |
| Nome físico no storage é aleatório/imutável | ✅ UUID puro | ✅ UUID prefix | OK |
| `originalName` é apenas metadado | ✅ Nunca usado no path | ✅ Sanitizado no path | OK |
| Acesso depende de autenticação + autorização + escopo do tenant | ✅ JWT + companyId + permissão | ❌ Sem auth | **CRÍTICO** |
| Preview e download validam tenant e permissão | ✅ Server-side check | ❌ Sem validação | **CRÍTICO** |
| URLs assinadas com expiração curta | ✅ HMAC + TTL de 5-15 min | ❌ URL permanente | **ALTO** |
| Uploads validam extensão + MIME real + magic bytes | ✅ Allowlist + verificação de conteúdo | ⚠️ Blocklist de extensão apenas | **MÉDIO** |
| Arquivos suspeitos vão para quarentena | ✅ Staging → scan → available | ❌ Disponível imediato | **MÉDIO** |
| Processamento (workers, OCR, etc.) respeita tenant | ✅ Diretórios isolados por tenant | ❌ Tudo em `/uploads/` | **ALTO** |
| Exclusão controlada (soft + hard delete) | ✅ Com política de retenção | ❌ Sem cleanup | **MÉDIO** |
| Anexos de mensagens herdam permissão da conversa | ✅ | ❌ URL aberta | **CRÍTICO** |
| Nenhum ID de arquivo sozinho concede acesso sem check server-side | ✅ | ❌ URL = acesso | **CRÍTICO** |
| Trilha de auditoria de download/acesso | ✅ Quem, quando, IP, tenant | ❌ Inexistente | **ALTO** |
| Distinção entre arquivo interno e compartilhável | ✅ Política por tipo | ❌ Tudo igual | **MÉDIO** |

### 17.2 Roadmap de Implementação

#### Fase 1 — PRIORIDADE MÁXIMA — BLOQUEAR ACESSO PÚBLICO

**Substituir completamente o acesso público a `/uploads/` por uma rota autenticada.**

Nenhum arquivo deve ser acessível por URL estática. O único caminho para obter um arquivo deve ser via rota autenticada do backend.

Criar `GET /api/files/:id` que valide **todos** os seguintes pontos antes de servir o arquivo:

1. **JWT ou signed token** — toda requisição precisa de credencial válida
2. **`companyId`** — o arquivo precisa pertencer ao tenant do usuário autenticado
3. **Permissão do usuário** — baseada no tipo de entidade vinculada (ex: permissão de ver mensagens para mídia de chat, permissão de ver propostas para PDF de proposta)
4. **Vínculo do arquivo com a entidade correta** — verificar que o arquivo pertence à mensagem/proposta/contrato/card que está sendo acessado
5. **Política de preview/download** — aplicar `Content-Disposition: inline` ou `attachment` conforme tipo e contexto
6. **Registro em audit log** — userId, fileId, companyId, IP, timestamp, resultado (success/denied/not_found)
7. **Headers de segurança** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `CSP`, `Cache-Control: private, no-cache`

**Ações de bloqueio:**
- Remover o `@fastify/static` para `/uploads/`
- Bloquear acesso direto a `/uploads/` no nginx com `deny all` ou `return 403`
- Atualizar todos os pontos que geram `mediaUrl` para usar `/api/files/:id` em vez de URL estática
- Garantir que nenhuma URL pública de arquivo fique em payloads de webhook, logs ou respostas de API

#### Fase 2 — Separação por Tenant

Migrar storage para estrutura por tenant:

```
/uploads/{companyId}/{entityType}/{uuid}.{ext}
```

Exemplo:
```
/uploads/abc123-company/messages/550e8400-e29b-41d4-a716-446655440000.jpg
/uploads/abc123-company/contracts/660e9500-f39c-52e5-b827-557766551111.pdf
/uploads/abc123-company/avatars/770f0600-g40d-63f6-c938-668877662222.jpg
```

Benefícios:
- Isolamento físico real entre empresas
- Possibilidade de backup/exclusão/retenção por tenant
- Auditoria por diretório
- Impossibilidade de acesso cruzado acidental

#### Fase 3 — Signed URLs Temporárias

Para compartilhamento externo (propostas públicas, links de download para clientes):
- URL assinada com HMAC-SHA256: `/api/files/signed/{token}`
- TTL configurável (padrão: 15 minutos, máximo: 24h)
- Token contém: fileId, companyId, expiração, IP de emissão (opcional)
- Não reutilizável após expiração
- Registro de criação e uso de signed URLs no audit log

#### Fase 4 — Allowlist + MIME Real + Scan/Quarentena

- **Allowlist de extensões** em vez de blocklist (aceitar apenas `.jpg`, `.png`, `.pdf`, `.doc`, `.mp3`, `.mp4`, etc.)
- **Validação de MIME real** via magic bytes (primeiros bytes do arquivo determinam o tipo real, não a extensão)
- **Scan antivírus** via ClamAV container (opcional mas recomendado)
- **Quarentena**: arquivo vai para `/uploads/{companyId}/_quarantine/` até validação completa, só então fica disponível
- **Política de rejeição**: arquivo ambíguo (extensão vs MIME divergentes) é rejeitado ou quarentenado

### 17.3 Tabela de Metadados Recomendada

O modelo ideal de banco para rastrear arquivos:

```prisma
model File {
  id             String    @id @default(uuid())
  companyId      String
  ownerType      String    // 'message', 'proposal', 'contract', 'card', 'expense', 'avatar'
  ownerId        String    // ID da entidade dona
  uploadedBy     String?   // userId de quem fez upload
  storageKey     String    // path relativo no storage (com companyId)
  originalName   String    // nome original do arquivo (metadado apenas)
  mimeType       String?   // MIME detectado por magic bytes
  size           Int       // tamanho em bytes
  checksum       String?   // SHA-256 do conteúdo
  status         String    @default("AVAILABLE") // QUARANTINE, AVAILABLE, DELETED
  visibility     String    @default("INTERNAL")  // INTERNAL, SHAREABLE
  deletedAt      DateTime?
  createdAt      DateTime  @default(now())

  company        Company   @relation(fields: [companyId], references: [id])
  
  @@index([companyId, ownerType, ownerId])
  @@index([storageKey])
}
```

### 17.4 Checagem Obrigatória de `companyId`

Toda operação com arquivo **deve** validar `companyId`:

| Operação | Validação Obrigatória |
|---|---|
| Upload | `companyId` do JWT gravado no registro |
| Download/Preview | `companyId` do JWT == `companyId` do arquivo |
| Listagem | Filtro explícito por `companyId` |
| Exclusão | `companyId` do JWT == `companyId` do arquivo |
| Compartilhamento (signed URL) | `companyId` embutido no token assinado |
| Rename | `companyId` do JWT == `companyId` do arquivo |

### 17.5 Política de Retenção e Exclusão

| Tipo de Arquivo | Retenção Após Exclusão Lógica | Hard Delete |
|---|---|---|
| Mídia de mensagem | 90 dias | Após 90 dias ou solicitação LGPD |
| Documento comercial (proposta, contrato, fatura) | 5 anos (fiscal) | Após 5 anos |
| Avatar | Imediato ao trocar | 30 dias |
| Arquivo temporário/quarentena | 7 dias | Automático |
| Tenant cancelado | 30 dias após cancelamento | Automático |

### 17.6 Logs Seguros

Todo acesso a arquivo deve gerar log:

```json
{
  "event": "file.download",
  "fileId": "uuid",
  "companyId": "uuid",
  "userId": "uuid",
  "ip": "xxx.xxx.xxx.xxx",
  "userAgent": "...",
  "timestamp": "ISO-8601",
  "result": "success|denied|not_found"
}
```

Logs de arquivo **não devem conter** o conteúdo do arquivo, apenas metadados.

---

### 17.7 Veredito Final — Posição de Segurança do Sistema de Arquivos

O CRM IMPA **não está em condição aceitável como modelo final de segurança multi-tenant para arquivos**. As correções implementadas nesta auditoria reduziram a superfície de ataque (XSS via upload, execução de conteúdo perigoso no navegador, debug log expondo dados), mas os problemas estruturais de **acesso sem autenticação** e **ausência de separação por tenant** permanecem intactos.

O sistema está, no máximo, **"menos exposto do que antes"** — mas não seguro.

A implementação da **Fase 1** (rota autenticada com bloqueio do acesso público) é pré-requisito absoluto antes de qualquer outro avanço de produto, e deve ser tratada como **dívida técnica de segurança crítica**.

---

*Documento gerado em auditoria automatizada em 16/04/2026. Atualizado com análise detalhada de segurança de arquivos, nota técnica sobre UUID, e revisão ponto a ponto das correções. Recomenda-se complementar com penetration test manual por especialista.*
