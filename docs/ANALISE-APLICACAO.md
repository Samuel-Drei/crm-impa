# Análise da Aplicação CRM IMPA — Gaps & Setup

> **Gerado em**: 2026-05-19
> **Escopo**: mapear variáveis de ambiente, configuração de canais (Evo Go), arquitetura admin e gaps para utilização completa.

---

## 1. Resumo Arquitetural

| Camada | Stack |
|---|---|
| **Backend** | Node 20+, Fastify, Prisma (Postgres 15), Redis, TypeScript, JWT cookie httpOnly |
| **Frontend** | React 18, Vite, TailwindCSS, Zustand, React Query, Socket.IO client |
| **Vector DB** | Qdrant (RAG / embeddings) |
| **Doc parsing** | Microserviço `docling` (FastAPI Python) |
| **Canais** | `WHATSMEOW` (Baileys nativo), `CLOUD_API` (Meta WhatsApp Cloud), `COEXISTENCE`, `EVO_GO` (Evolution Go) |
| **IA** | Multi-provider (OpenAI, Gemini, Claude/Anthropic, DeepSeek, Groq, OpenRouter, Perplexity, Mistral, Cohere, xAI, Together, Fireworks, Cerebras, GitHub Models/Copilot, Antigravity, OpenAI-compatible) |
| **Modelos especiais** | RAG (Qdrant + embeddings), MCP Servers, Tool Engine (9 módulos), Daily Brain, Skills, Flow Builder |
| **Multi-tenant** | Sim (Company → Users/Roles/Instances). Isolamento por `companyId` |
| **RBAC** | Granular por permissão, role com escopo (`COMPANY` / `TEAM` / `OWN_ONLY`) |
| **Filas** | BullMQ (Redis) |

---

## 2. Painel Super Admin — o que existe

O frontend tem rotas `/admin/*` (`@/Users/.../frontend/src/pages/admin/`):

- `AdminDashboard.tsx` — métricas gerais
- `AdminCompanies.tsx` / `AdminCompanyDetail.tsx` — gestão multi-tenant
- `AdminUsers.tsx` / `AdminUserDetail.tsx` — usuários globais
- `AdminPlans.tsx` — planos/billing
- `AdminModules.tsx` — feature flags por módulo
- `AdminAIDebug.tsx` — debug de prompts IA

O backend expõe `GET /admin/settings` e `PUT /admin/settings` (via `prisma.systemSetting`), mas hoje só é usado para chaves `youtube.*`. **A infraestrutura para configurar Evo Go via UI existe, mas não tem tela.**

### 2.1 Como Evo Go é configurado HOJE

**Apenas via `.env`** — variáveis `EVO_GO_API_URL` e `EVO_GO_GLOBAL_API_KEY` são lidas em `@/Users/.../backend/src/config/env.ts` e usadas em `@/Users/.../backend/src/modules/instances/instance.routes.ts:127,193-194,447,604,839,874`.

- Endpoint `GET /api/instances/evo-go/health` retorna `evoGoConfigured: boolean` baseado nessas envs.
- Sem essas envs, o usuário precisa **digitar manualmente** URL, ID e API Key ao criar cada instância (tela `Instances.tsx`, banner "Modo Manual" em torno da linha 878).

### 2.2 **GAP CRÍTICO** — Falta tela Super Admin para Evo Go

> Não há UI para um super-admin configurar `EVO_GO_API_URL` + `EVO_GO_GLOBAL_API_KEY` em runtime. Hoje qualquer mudança exige editar `.env` e reiniciar o backend.

**Solução recomendada**:
1. Criar `frontend/src/pages/admin/AdminSystemSettings.tsx` consumindo `GET/PUT /admin/settings`.
2. No backend, alterar `env.EVO_GO_API_URL` e `env.EVO_GO_GLOBAL_API_KEY` para preferir `systemSetting` se existir, caindo para env vars como fallback (`@/Users/.../backend/src/modules/instances/instance.routes.ts`).
3. Adicionar chaves padronizadas: `evo_go.api_url`, `evo_go.global_api_key` (criptografar a key usando `encryption.ts`).

---

## 3. Variáveis de Ambiente — Inventário Completo

### 3.1 Backend (`backend/.env`)

#### Declaradas no schema `env.ts` (zod)
| Var | Obrig. | Default | Status |
|---|---|---|---|
| `NODE_ENV` | não | `development` | OK |
| `PORT` | não | `3333` | OK |
| `FRONTEND_URL` | não | `http://localhost:5454` | OK |
| `BACKEND_URL` | não | `http://localhost:3333` | OK |
| `DATABASE_URL` | **sim** | — | OK |
| `REDIS_HOST` | não | `localhost` | OK |
| `REDIS_PORT` | não | `6379` | OK |
| `JWT_SECRET` | **sim** | — | OK |
| `JWT_EXPIRES_IN` | não | `7d` | OK |
| `ENCRYPTION_KEK` | **sim** (64 hex) | — | OK |
| `META_APP_ID` | não | — | **ADICIONADO** |
| `META_APP_SECRET` | não | — | **ADICIONADO** |
| `META_BUSINESS_ID` | não | — | **ADICIONADO** |
| `META_ACCESS_TOKEN` | não | — | **ADICIONADO** |
| `META_WEBHOOK_VERIFY_TOKEN` | não | — | **ADICIONADO** |
| `META_API_VERSION` | não | `v24.0` | **ADICIONADO** |
| `TYPEBOT_API_URL` | não | — | **ADICIONADO** |
| `TYPEBOT_API_KEY` | não | — | **ADICIONADO** |
| `N8N_WEBHOOK_URL` | não | — | **ADICIONADO** |
| `EVO_GO_API_URL` | não | — | OK |
| `EVO_GO_GLOBAL_API_KEY` | não | — | OK |
| `BAILEYS_SESSIONS_PATH` | não | `./sessions` | OK |
| `OPENAI_API_KEY` | não | — | OK |
| `GEMINI_API_KEY` | não | — | OK |
| `CLAUDE_API_KEY` | não | — | **CORRIGIDO** (estava como `ANTHROPIC_API_KEY`) |
| `AI_DEFAULT_PROVIDER` | não | `OPENAI` | **ADICIONADO** |
| `AI_DEFAULT_MODEL` | não | `gpt-4o-mini` | **ADICIONADO** |

#### Usadas via `process.env.*` mas NÃO no schema zod
| Var | Onde é usada | Status |
|---|---|---|
| `BACKEND_INTERNAL_URL` | `instance.routes.ts`, `message.routes.ts` (URL interna Docker→Docker) | OK |
| `API_URL` | `payment.routes.ts` (webhook gateways) | **ADICIONADO** |
| `QDRANT_URL` | `qdrant.client.ts` | OK |
| `QDRANT_API_KEY` | `qdrant.client.ts` | OK |
| `DOCLING_SERVICE_URL` | `document-parser.ts` | OK |
| `WHISPER_ENDPOINT` / `WHISPER_LOCAL_URL` / `WHISPER_BASE_URL` | `message.routes.ts`, `knowledge.routes.ts` (transcrição) | **ADICIONADO** |
| `COHERE_API_KEY` | `ingestion.pipeline.ts`, `retrieval.service.ts` | **ADICIONADO** |
| `VOYAGE_API_KEY` | `ingestion.pipeline.ts`, `retrieval.service.ts` | **ADICIONADO** |
| `YT_PROXY_URL` / `YT_COOKIES_DIR` / `YT_COOKIES_FILE` / `YT_DLP_PLAYER_CLIENTS` | `youtube-transcript.ts` | **ADICIONADO** |
| `HTTPS_PROXY` / `HTTP_PROXY` | `youtube-transcript.ts` | **ADICIONADO** |
| `AI_WORKSPACE_ROOT` | `server.ts`, `ai-workspace.module.ts` | **ADICIONADO** |

### 3.2 Frontend (`frontend/.env`)

Declaradas em `vite-env.d.ts`:

| Var | Uso | Status |
|---|---|---|
| `VITE_API_URL` | base URL da API (`services/api.ts`, `services/socket.ts`) | OK |
| `VITE_META_APP_ID` | Meta Embedded Signup (`hooks/useFacebookSDK.ts`) | **ADICIONADO** |
| `VITE_META_CONFIG_ID` | ID da config de Embedded Signup (`Instances.tsx`) | **ADICIONADO** |

---

## 4. Gaps para uso completo

### 4.1 Configuração & Operação

- 🔴 **Tela admin para Evo Go global** (URL + API Key) — hoje só via `.env`.
- 🔴 **Tela admin de System Settings** — backend já tem `GET/PUT /admin/settings` mas frontend não consome.
- 🟡 **Migrations + seed automatizados** — o `startall.ps1` agora roda `prisma migrate deploy`, mas **não roda `prisma db seed`**. Sem isso a tela `/setup` aparece, mas é melhor automatizar.
- 🟡 **Seed RBAC** — `seed.ts` avisa "Run seed-rbac.ts first", mas não chama. Falta integrar.
- 🟡 **Diretórios faltantes** — `backend/uploads`, `backend/public/docs`, `backend/sessions`, `backend/ai-workspace`, `frontend/dist` (resolvido no `startall.ps1`).

### 4.2 Canais

- 🔴 **Evo Go**: requer um container/serviço Evolution Go rodando em `EVO_GO_API_URL` — **não está no `docker-compose-dev.yml`**. Se quiser usar EVO_GO, precisa subir a stack `evolution-go` separadamente (existe network externa `evolution-go_evogo_network` referenciada no `docker-compose.yml`).
- 🟡 **Meta Cloud API**: precisa criar app no Meta for Developers, configurar webhook callback URL pública (use ngrok em dev), preencher `META_*` + `VITE_META_APP_ID` + `VITE_META_CONFIG_ID`.
- 🟢 **Baileys (WHATSMEOW)**: funciona out-of-the-box, sessions em `backend/sessions/`.

### 4.3 IA / RAG

- 🟡 **API Keys por empresa**: o painel permite cadastrar providers criptografados por empresa (`AIProviders.tsx`). As envs `OPENAI_API_KEY` etc. são apenas **fallback global**.
- 🟡 **Embeddings**: requer pelo menos um provider OpenAI/Gemini/Cohere/Voyage/Ollama configurado para a base de conhecimento funcionar.
- 🟢 **Qdrant + Docling**: já no `docker-compose-dev.yml`.

### 4.4 Pagamentos / Billing

- 🟡 `payment.routes.ts:263` lê `API_URL` para montar webhook. **Não estava no `.env`** → adicionado.
- 🟡 Gateways (Stripe, MercadoPago etc.) são configurados por empresa via UI (`/admin/payments`).

### 4.5 Observabilidade / Produção

- 🔴 **Sem instrumentação OpenTelemetry / Sentry / Grafana**.
- 🔴 **Sem health-check unificado** (cada serviço tem o seu, mas não há `/api/health` agregando dependências).
- 🟡 **Logs**: pino padrão, sem destination configurável via env.

---

## 5. Ações executadas neste relatório

1. ✅ `backend/.env` **reescrito** com todas as 35+ variáveis suportadas (organizadas por categoria, comentadas).
2. ✅ `frontend/.env` atualizado com `VITE_META_APP_ID` e `VITE_META_CONFIG_ID`.
3. ✅ `start.ps1` agora gera ambos os `.env` completos automaticamente quando faltam.
4. ✅ `startall.ps1` cria diretórios (`uploads`, `public/docs`, `sessions`, `ai-workspace`, `dist`) e roda `prisma generate` + `prisma migrate deploy`.

---

## 6. Próximas ações recomendadas (priorizadas)

| Prioridade | Ação | Esforço |
|---|---|---|
| 🔴 P0 | Criar `AdminSystemSettings.tsx` com configuração de Evo Go (URL + global key criptografada) | 2-4 h |
| 🔴 P0 | Refatorar `instance.routes.ts` para preferir `systemSetting` antes de `env` | 1-2 h |
| 🔴 P0 | Adicionar `evolution-go` ao `docker-compose-dev.yml` (ou documentar como rodar separado) | 1-2 h |
| 🟡 P1 | Adicionar `npx prisma db seed` + `seed-rbac` ao `startall.ps1` (idempotente) | 30 min |
| 🟡 P1 | Validar `ANTHROPIC_API_KEY` → `CLAUDE_API_KEY` (rename consistente no schema) | 15 min |
| 🟡 P1 | Adicionar `COHERE_API_KEY`, `VOYAGE_API_KEY`, `WHISPER_*`, `AI_WORKSPACE_ROOT`, `API_URL` ao schema zod (`env.ts`) | 30 min |
| 🟢 P2 | Endpoint `/api/health` unificado com status de Postgres, Redis, Qdrant, Docling, Evo Go | 1 h |
| 🟢 P2 | Tela admin `/admin/system-settings` para YouTube, ASR, e demais chaves globais | 2-3 h |

---

## 7. Credenciais & Acesso

- **Admin inicial** (criado via `npx prisma db seed`):
  - Email: `admin@whatsapp.local`
  - Senha: `admin123`
- Trocar senha imediatamente após primeiro login.
- O fluxo `/setup` (SuperAdminSetup.tsx) só aparece quando não há nenhum admin no banco.

---

## 8. Comandos de operação

```powershell
# Subir tudo (infra + back + front + migrations)
.\startall.ps1

# Restart só app
.\restart.ps1

# Parar só front/back (preserva containers)
.\stop.ps1

# Parar tudo
.\stopall.ps1

# Seed manual
cd backend
npx prisma db seed
npx tsx prisma/seed-rbac.ts
```
