<div align="center">

# IMPA365 CRM

**Plataforma Profissional de Gestão de Relacionamento via WhatsApp**

*Exclusivo para Assinantes da Comunidade IMPA*

---

[![Licença Proprietária](https://img.shields.io/badge/Licença-Proprietária-red.svg)](./EULA.md)
[![Versão](https://img.shields.io/badge/Versão-3.0.0-blue.svg)]()
[![Stack](https://img.shields.io/badge/Stack-Node.js%20%7C%20React%20%7C%20PostgreSQL-green.svg)]()
[![Deploy](https://img.shields.io/badge/Deploy-Docker-2496ED.svg)]()

</div>

---

> ⚠️ **Acesso Restrito** — Este software é de uso exclusivo para assinantes ativos da Comunidade IMPA.
> O uso, redistribuição ou compartilhamento não autorizado constitui violação de propriedade intelectual.
> Consulte o [EULA](./EULA.md) para os termos completos.

---

## Visão Geral

O **IMPA365 CRM** é uma plataforma completa de gestão de conversas e automação via WhatsApp, desenvolvida para times comerciais, suporte e atendimento que exigem performance, rastreabilidade e controle total.

Multi-instância, multi-provedor, multi-agente. Tudo em uma única interface.


---

## Módulos e Funcionalidades

### Conversas e Mensagens
- Inbox unificado multi-instância com busca em tempo real
- Envio de texto, imagem, áudio, vídeo, documento e sticker
- Mensagens interativas: botões, listas e menus
- Histórico completo com paginação e busca
- Marcar como lida / não lida
- Notas internas (invisíveis ao contato)
- Fixar conversas no topo
- Atribuição de conversas a agentes e times

### Instâncias WhatsApp
- Multi-instâncias simultâneas (vários números)
- **Baileys** — Conexão via QR Code, sem custos por mensagem
- **Meta Cloud API** — WhatsApp Business API oficial com templates aprovados
- **Coexistência** — Modo híbrido: Baileys para envio + Cloud API para recebimento
- Reconexão automática com health check contínuo
- Status em tempo real via Socket.IO

### Flow Builder — Chatbot Visual
- Editor drag-and-drop com canvas ilimitado
- Nodes disponíveis: Texto, Imagem, Áudio, Vídeo, Documento, Menu, Botões, Lista, Condição, Delay, Variável, HTTP Request, Transferir Agente, Ir para Fluxo, Encerrar
- Condition switch/case com múltiplos valores, operadores (`equals`, `contains`, `startsWith`, `regex`) e fallback
- `waitForInput` — aguarda resposta do contato e salva em variável
- HTTP Request com mapeamento de resposta (suporte a paths aninhados, ex: `data.tokens.access_token`)
- Node Delay (1–300 segundos) para pausas controladas
- Timeout de inatividade configurável por fluxo com mensagem de encerramento personalizada
- Variáveis de sistema: `{{_contactName}}`, `{{_contactPhone}}`, `{{_triggerMessage}}`, `{{_menuSelection}}`
- Gatilhos: palavra-chave, todas as mensagens, resposta de botão/lista, webhook externo

### Contatos e CRM
- Cadastro automático de contatos ao receber mensagem
- Histórico completo por contato
- Campos customizados
- Labels (etiquetas) coloridas por conversa
- Times e atribuições de agentes
- Status da conversa: Aberta, Em Atendimento, Resolvida

### IA Integrada
- Agentes de IA por instância com instruções customizadas
- Múltiplos provedores: OpenAI, Groq, Anthropic, Google Gemini
- Base de conhecimento (RAG) com upload de documentos
- Pausa e retomada automática da IA por conversa
- Session tracking com contagem de tokens e mensagens

### Kanban
- Visualização de conversas em colunas drag-and-drop
- Colunas customizáveis por pipeline
- Vinculação de cards às conversas

### Automações e Campanhas
- Disparos automáticos via API com token
- Template routing dinâmico
- Campanhas em massa com delay configurável entre envios
- Status detalhado: rascunho, agendada, em execução, pausada, concluída
- Logs de execução por automação

### Segurança e Controle
- Autenticação JWT com refresh token
- RBAC (Role-Based Access Control) granular por rota
- Rate limiter em endpoints críticos
- Isolamento de dados por empresa (multi-tenant)
- Logs de auditoria

### Administração
- Painel admin multi-empresa
- Gerenciamento de usuários, times e permissões
- Módulos ativáveis/desativáveis por empresa
- Sistema de atualização automática com progresso em tempo real
- API Docs integrada

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| **Backend** | Node.js 20 + Fastify + TypeScript ESM |
| **Frontend** | React 18 + Vite + TypeScript + Tailwind CSS |
| **Banco de Dados** | PostgreSQL 15 + Prisma ORM |
| **Cache / Filas** | Redis + Bull |
| **Realtime** | Socket.IO |
| **IA** | OpenAI / Groq / Anthropic / Gemini |
| **Deploy** | Docker + Docker Compose |
| **Proxy Reverso** | Nginx (Alpine) |

---

## Requisitos de Infraestrutura

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disco | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 22.04 / Debian 12 | Ubuntu 22.04 LTS |
| Domínio | Obrigatório (SSL) | Com CDN |

---

## Deploy com Docker

### Pré-requisitos

```bash
# Instalar Docker e Docker Compose
curl -fsSL https://get.docker.com | sh
```

### Inicialização

```bash
# 1. Copie e configure as variáveis de ambiente
cp stack\ producao.yaml docker-compose.yml

# 2. Edite as variáveis no arquivo
nano docker-compose.yml

# 3. Suba o stack
docker compose up -d
```

### Variáveis de Ambiente Obrigatórias

```env
# Banco de Dados
DATABASE_URL="postgresql://usuario:senha@postgres:5432/crm_impa"

# Cache
REDIS_URL="redis://redis:6379"

# Segurança
JWT_SECRET="string-aleatória-longa-e-segura"

# Aplicação
NODE_ENV="production"
PORT=3333
FRONTEND_URL="https://seu-dominio.com"

# WhatsApp Meta (opcional, para Cloud API)
META_WEBHOOK_VERIFY_TOKEN="token-de-verificacao"
```

---

## Estrutura do Projeto

```
crm-impa/
├── backend/
│   ├── src/
│   │   ├── config/           # Variáveis de ambiente, database, redis
│   │   ├── core/             # Bootstrap do servidor
│   │   ├── jobs/             # Jobs agendados (flow timeout, IA follow-up)
│   │   ├── middlewares/      # Auth JWT, rate limiter, RBAC
│   │   ├── modules/
│   │   │   ├── admin/        # Painel admin, atualizações
│   │   │   ├── ai/           # Agentes de IA, sessões, base de conhecimento
│   │   │   ├── auth/         # Autenticação e perfil
│   │   │   ├── automations/  # Automações de disparo
│   │   │   ├── campaigns/    # Campanhas em massa
│   │   │   ├── cards/        # Kanban cards
│   │   │   ├── contacts/     # Contatos e histórico
│   │   │   ├── conversations/# Gestão de conversas
│   │   │   ├── flows/        # Flow Builder engine
│   │   │   ├── instances/    # Instâncias WhatsApp
│   │   │   ├── labels/       # Etiquetas
│   │   │   ├── messages/     # Mensagens e inbox
│   │   │   ├── teams/        # Times
│   │   │   ├── templates/    # Templates Meta
│   │   │   └── webhooks/     # Webhooks entrada/saída
│   │   └── providers/
│   │       ├── baileys/      # Provider QR Code
│   │       └── cloud-api/    # Provider Meta oficial
│   └── prisma/               # Schema e migrations
├── frontend/
│   └── src/
│       ├── components/       # UI components (shadcn/ui)
│       ├── pages/            # Páginas da aplicação
│       ├── services/         # API client
│       ├── stores/           # Zustand stores
│       └── types/            # TypeScript types
├── impago/                   # Microserviço Go para gestão de instâncias
├── docker-compose.yml        # Stack de produção
└── EULA.md                   # Licença e termos de uso
```

---

## Principais Endpoints da API

### Autenticação
```
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/profile
```

### Conversas
```
GET    /api/messages/conversations/:instanceId
POST   /api/conversations/:id/pin
POST   /api/conversations/:id/unpin
POST   /api/conversations/:id/assign
PUT    /api/conversations/:id/status
DELETE /api/conversations/:id
```

### Mensagens
```
GET  /api/messages/:instanceId?remoteJid=&limit=
POST /api/messages/:instanceId/send
POST /api/messages/mark-read/:instanceId
```

### Instâncias
```
GET    /api/instances
POST   /api/instances
POST   /api/instances/:id/connect
POST   /api/instances/:id/disconnect
DELETE /api/instances/:id
```

### IA
```
GET  /api/ai/agents
POST /api/ai/agents
GET  /api/ai/session-status/:instanceId/:remoteJid
POST /api/conversations/:id/ai-pause
POST /api/conversations/:id/ai-resume
```

### Flows
```
GET  /api/flows
POST /api/flows
GET  /api/flows/:id
PUT  /api/flows/:id/canvas
```

---

## Comandos Úteis

```bash
# Ver logs em tempo real
docker compose logs -f backend
docker compose logs -f frontend

# Reiniciar serviços
docker compose restart backend
docker compose restart frontend

# Puxar novas imagens e reiniciar
docker compose pull
docker compose up -d

# Acessar banco de dados
docker compose exec postgres psql -U crm_impa -d crm_impa

# Executar migrations manualmente
docker compose exec backend npx prisma migrate deploy
```

---

## Acesso Inicial

Após o primeiro deploy, acesse a URL configurada e faça login com as credenciais definidas no seed do banco.

> Altere a senha imediatamente após o primeiro acesso.

---

## Changelog

### v3.0.0
- Módulo de IA com múltiplos provedores e base de conhecimento (RAG)
- RBAC granular com permissões por rota
- Kanban modular com drag-and-drop
- Fixar conversas no topo (pin/unpin)
- Atribuição de conversas a times e agentes
- Microserviço ImpaGo (Go) para gestão de instâncias
- Segurança: isolamento por tenant, audit logs, rate limiting avançado

### v2.2.0
- Flow Builder completo com todos os tipos de node
- Canal Coexistência (Baileys + Cloud API híbrido)
- Timeout de inatividade configurável por fluxo
- HTTP Request node com proxy server-side
- Campanhas em massa com controle de velocidade

### v2.1.0
- Sistema de atualização automática com SSE
- Templates ORDER_DETAILS
- Otimizações Baileys
- Integração Typebot e n8n

---

## Base do Projeto

Este projeto foi inicialmente baseado em um projeto open source sob licença MIT.
Desde então, foi extensivamente modificado e expandido pela equipe IMPA365.

---

## Licença e Uso

Este software é propriedade exclusiva da **IMPA365** e está licenciado exclusivamente para assinantes ativos da Comunidade IMPA.

Consulte o [EULA completo](./EULA.md) para direitos, restrições e responsabilidades.

**© 2026 IMPA365 — Todos os direitos reservados.**

