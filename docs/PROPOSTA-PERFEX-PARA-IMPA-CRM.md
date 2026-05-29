# PROPOSTA ESTRATÉGICA: PERFEX CRM → IMPA CRM
## Análise Profunda, Adaptação Arquitetural e Roadmap de Implementação

---

## 1. RESUMO EXECUTIVO

### O que o Perfex resolve bem
O Perfex CRM é uma suíte comercial-financeira-operacional madura, construída em CodeIgniter (PHP), com ~80 tabelas, 48 models, 43 controllers admin e 47 helpers. Ele cobre o ciclo completo de vendas: **Lead → Proposta/Orçamento → Fatura → Pagamento**, com controle financeiro (despesas, notas de crédito, multi-moeda), operação (contratos, projetos, tarefas) e relatórios integrados.

**Pontos fortes do Perfex:**
- Ciclo comercial-financeiro completo e bem integrado
- Catálogo de itens reutilizável entre propostas, orçamentos e faturas
- Sistema polimórfico de itens (`itemable` + `item_tax`) — elegante e flexível
- Conversões automatizadas: Lead→Cliente, Proposta→Orçamento→Fatura
- Contratos com assinatura eletrônica e renovação rastreada
- Projetos com milestones, timesheet e Gantt
- Tarefas polimórficas (ligadas a projeto, contrato, fatura, lead ou cliente)
- Sistema de recorrência (faturas, despesas, tarefas)
- Custom fields dinâmicos em todas as entidades
- PDF generation para todos os documentos comerciais
- Activity log detalhado por módulo
- Permissões granulares por módulo (view, view_own, create, edit, delete)

### O que vale a pena trazer para o IMPA CRM
1. **Modelo de dados comercial-financeiro** — a separação entre Proposta, Fatura, Pagamento e Nota de Crédito
2. **Catálogo de itens** — como base para IA, vetorização e automação comercial
3. **Itens em documentos com schema explícito** — inspirado no `itemable` do Perfex, mas implementado com models dedicados (`ProposalItem`, `InvoiceItem`) em vez de tabela polimórfica
4. **Fluxo de conversão** — Lead→Cliente, Proposta→Fatura, Despesa→Fatura
5. **Contratos com renovação** — histórico, assinatura, vínculo com cliente
6. **Projetos e tarefas** — para pós-venda e operação
7. **Relatórios financeiros** — renda vs despesa, por método de pagamento, por período
8. **Activity log estruturado** — activity por domínio (uma tabela por entidade) + timeline agregada no frontend

### O que precisa ser redesenhado
1. **Separação Contato/Organização/Conta Cliente** — no Perfex, `tblclients` mistura empresa e contato; não distingue lead de contato
2. **Integração com conversas** — Perfex não tem WhatsApp nativo; tudo é email-centric
3. **IA e automação** — Perfex tem um módulo OpenAI básico; o IMPA CRM precisa de IA profunda
4. **Kanban universal** — Perfex tem kanban apenas em Leads e Tasks; o IMPA precisa de motor universal
5. **Multi-tenant/módulos** — Perfex é single-tenant sem módulos controlados por empresa
6. **Frontend** — Perfex usa jQuery/Bootstrap3; o IMPA usa React/Tailwind
7. **Backend** — Perfex é CodeIgniter/PHP; o IMPA é Node.js/Prisma/PostgreSQL
8. **Tickets** — O IMPA CRM substitui tickets por conversas WhatsApp
9. **Gateways de pagamento** — adaptar para realidade brasileira (Pix, boleto, Asaas, etc.)

---

## 2. MAPA DE DOMÍNIO

### 2.1 Entidades Principais e Seus Papéis

| Entidade | Papel | Domínio IMPA CRM |
|----------|-------|-------------------|
| **Contato** | Pessoa física com dados de contato (telefone, email, WhatsApp) | CORE |
| **Organização** | Pessoa jurídica (empresa do cliente), agrupa contatos | CORE |
| **Lead (LeadProfile)** | Perfil comercial anexado ao Contato (fase de qualificação, não entidade separada) | CRM/COMERCIAL |
| **Conta Cliente** | Entidade separada que centraliza dados comerciais/financeiros de um cliente ativo | CRM/COMERCIAL |
| **Oportunidade** | Negócio concreto no pipeline — Card com valor, estágio e previsão de fechamento | CRM/COMERCIAL |
| **Proposta** | Documento comercial com itens, valores e termos (type: PROPOSAL ou ESTIMATE) | CRM/COMERCIAL |
| **Item** | Produto/serviço no catálogo (base para IA) | CRM/COMERCIAL |
| **Fatura** | Cobrança emitida ao cliente | FINANCEIRO |
| **Pagamento** | Registro de recebimento vinculado à fatura | FINANCEIRO |
| **Nota de Crédito** | Crédito/estorno para o cliente | FINANCEIRO |
| **Despesa** | Gasto da empresa (faturável ou não) | FINANCEIRO |
| **Contrato** | Acordo formal com cliente, datas e renovação | OPERAÇÃO |
| **Projeto** | Agrupamento de tarefas para entrega | OPERAÇÃO |
| **Tarefa** | Unidade de trabalho com checklist e timer | OPERAÇÃO |
| **Conversa** | Thread de mensagens (WhatsApp, email, web) | CORE |
| **Mensagem** | Unidade de comunicação dentro de conversa | CORE |
| **Tag** | Etiqueta polimórfica para qualquer entidade | CORE |
| **Campo Personalizado** | Campo dinâmico para qualquer entidade | CORE |
| **Automação** | Regra de negócio automatizada (trigger→condition→action) | CORE |
| **Atividade (por domínio)** | Registro histórico por entidade (CardActivity, ProposalActivity, InvoiceActivity, etc.) | CORE |

### 2.2 Diagrama de Relacionamentos

```
                    ┌─────────────┐
                    │   CONTATO   │ ← entidade base (pessoa)
                    └──────┬──────┘
                           │ pertence a (opcional)
                    ┌──────▼──────┐
                    │ ORGANIZAÇÃO │ ← empresa do cliente (PJ)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐     │     ┌──────▼──────┐
       │ LEADPROFILE │     │     │CONTA CLIENTE│
       │(qualificação│     │     │ (relação    │
       │do contato)  │     │     │  comercial) │
       └──────┬──────┘     │     └──────┬──────┘
              │            │            │
       ┌──────▼──────┐     │     ┌──────▼──────┐
       │OPORTUNIDADE │     │     │ CONTRATO    │
       │ (Card no    │     │     └──────┬──────┘
       │  pipeline)  │     │            │
       └──────┬──────┘     │     ┌──────▼──────┐
              │            │     │  PROJETO    │
       ┌──────▼──────┐     │     └──────┬──────┘
       │  PROPOSTA   │     │            │
       │ (documento) │     │     ┌──────▼──────┐
       └──────┬──────┘     │     │   TAREFA    │
              │            │     └─────────────┘
       ┌──────▼──────┐     │
       │   FATURA    │─────┘
       └──────┬──────┘
              │
       ┌──────▼──────┐
       │  PAGAMENTO  │
       └─────────────┘

       ┌─────────────┐
       │   DESPESA   │──── vinculada a Conta Cliente ou Projeto
       └─────────────┘

       ┌─────────────┐
       │  CONVERSA   │──── hub central: conecta a tudo (sidebar comercial)
       └─────────────┘

       ┌─────────────┐
       │    ITEM     │──── catálogo vetorizado no Qdrant para IA
       └─────────────┘
```

### 2.3 Distribuição por Camada

| Camada | Entidades |
|--------|-----------|
| **CORE** | Contato, Organização, Usuário, Time, Permissão, Tag, Campo Personalizado, Conversa, Mensagem, Automação, IA |
| **CRM/COMERCIAL** | Lead (LeadProfile), Conta Cliente, Oportunidade, Pipeline, Proposta (inclui Orçamento via type), Item/Catálogo |
| **FINANCEIRO** | Fatura, Pagamento, Nota de Crédito, Despesa, Moeda, Imposto |
| **OPERAÇÃO** | Contrato, Projeto, Tarefa, Milestone, Checklist |
| **RELATÓRIOS** | Vendas, Financeiro, Leads, Conversas, Pipeline, Produtividade |
| **IA/AUTOMAÇÃO** | Provider IA, Classificação, Vetorização, Triggers, Actions |

---

## 3. COMPARAÇÃO PERFEX → IMPA CRM

### 3.1 CLIENTES

**Como é no Perfex:**
- Tabela `tblclients` = empresa (company, address, VAT, billing/shipping)
- Tabela `tblcontacts` = pessoas da empresa (FK userid → client)
- Um contato primário (is_primary=1) por cliente
- Cliente pode ter múltiplos contatos
- Grupos de clientes (`tblcustomer_groups`)
- Staff podem ser "customer admins" (`tblcustomer_admins`)
- Campo `leadid` rastreia lead original quando convertido
- Endereços duplos: billing + shipping

**Problema que resolve:**
Organiza empresas com seus contatos, centraliza dados financeiros e comerciais.

**Limitações:**
- Não separa claramente contato de cliente — todo contato já nasce vinculado a um "cliente"
- Não existe entidade "contato independente" que ainda não é lead nem cliente
- `tblclients` mistura conceitos de empresa e conta comercial
- Sem integração com WhatsApp para identificação automática

**Adaptação IMPA CRM:**
- **Contato** é entidade independente (pessoa com telefone/WhatsApp/email) — já existe no IMPA CRM com `phoneNumber`, `tags[]`, `metadata`, `whatsappStatus`
- **Organização** é entidade independente para empresas dos clientes (PJ com CNPJ) — nome `Organization` evita confusão com `Company` que já é o tenant no IMPA CRM
- **Conta Cliente (CustomerAccount)** é entidade separada que centraliza a relação comercial/financeira, com suporte flexível a **B2C** e **B2B**:
  - **B2C (INDIVIDUAL)**: 1 contato via `CustomerAccountContact` com role PRIMARY, `organizationId` null
  - **B2B (BUSINESS)**: `organizationId` aponta para a empresa, múltiplos contatos via `CustomerAccountContact` com papeis (PRIMARY, BILLING, DECISION_MAKER, OPERATIONAL, MEMBER)
  - Enum `AccountType`: INDIVIDUAL | BUSINESS
  - Dados de cobrança, endereços, limites de crédito, prazos de pagamento
- **Regra de criação da CustomerAccount** (configurada por tenant):
  - Oportunidade for WON (Card.status = WON)
  - **ou** Proposta for ACCEPTED (Proposal.status = ACCEPTED)
  - **ou** Primeira fatura for emitida (Invoice criada para o contato)
  - O sistema verifica se já existe CustomerAccount antes de criar uma nova
- **Invariantes obrigatórias** da CustomerAccount (ver seção 5.5 para detalhes completos):
  - INDIVIDUAL: `organizationId` null, exatamente 1 contato primário
  - BUSINESS: `organizationId` obrigatório, pelo menos 1 contato primário, múltiplos contatos com papeis
  - Apenas 1 contato com `isPrimary = true` por conta — validado na camada de serviço
- Contato pode existir sem ser lead nem cliente (apenas contato WhatsApp)
- A conversa WhatsApp cria contato automaticamente
- IA pode qualificar contato como lead automaticamente com base na conversa
- Lead é um estágio de qualificação (pré-oportunidade) com estrutura própria (ver 3.2)

> **Nota sobre `companyId`**: No IMPA CRM, `companyId` é consistentemente o ID do tenant (empresa dona do CRM) em TODAS as ~40+ tabelas existentes. Manter essa convenção. Não renomear para `workspaceId` — seria uma mudança destrutiva sem benefício real. Para empresas dos clientes, usar o nome `Organization`.

**Core ou Módulo:** Contato e Organização no **CORE**. Conta Cliente no módulo **CRM/COMERCIAL**.

---

### 3.2 LEADS

**Como é no Perfex:**
- Tabela `tblleads` separada de `tblclients`
- Campos: name, email, phone, address, description, assigned, source, status
- Pipeline via `tblleads_status` (customizável: name, color, statusorder)
- Sources via `tblleads_sources`
- Activity log próprio (`tblleads_activity_log`)
- Flags: `lost`, `junk`, `is_public`
- Conversão para cliente: cria `tblclients` + `tblcontacts`, transfere notes/consents/custom fields
- Web-to-lead forms (`tblweb_to_lead`)
- Integração IMAP para captura de leads por email

**Problema que resolve:**
Rastreia prospects desde a captura até a conversão em cliente.

**Limitações:**
- Lead é uma entidade completamente separada — ao converter, dados são duplicados
- Sem vínculo com conversas WhatsApp
- Pipeline é apenas para leads, não serve para outros fluxos
- Sem IA para classificação ou scoring automático
- Kanban simples sem motor universal

**Adaptação IMPA CRM:**

> **Regra oficial Lead vs LeadProfile:**
> - **Lead não é uma entidade de pessoa separada** — não existe tabela `Lead`
> - **LeadProfile é o perfil/componente comercial** anexado ao Contact (1:1)
> - **Contact continua sendo a entidade principal** — dados da pessoa (nome, telefone, email)
> - **LeadProfile existe apenas quando o contato entra em qualificação** — criado sob demanda
> - Sem LeadProfile = contato comum (WhatsApp, visitante, etc.)
> - Com LeadProfile = contato em processo comercial
> - LeadProfile.status = QUALIFIED → pronto para virar oportunidade (Card no pipeline)

- Quando um contato mostra interesse comercial, ele entra em fase de qualificação (Lead)
- **LeadProfile** é a entidade estrutural que armazena os dados comerciais do lead:
  - Separada do Contact (dados da pessoa ≠ dados do processo comercial)
  - `status`: NEW → CONTACTED → QUALIFYING → QUALIFIED → UNQUALIFIED/DISQUALIFIED
  - `temperature`: HOT / WARM / COLD
  - `score`: 0-100 (calculado pela IA)
  - `source` / `channel`: origem do lead (whatsapp, website, referral, ad)
  - `estimatedBudget`, `budgetCurrency`: orçamento estimado
  - `assignedTo`: usuário responsável pela qualificação
  - `qualifiedAt` / `disqualifiedAt`: timestamps de transição
  - `convertedAt` / `opportunityId`: quando virou oportunidade (Card)
- **Nem todo lead vira Oportunidade** — só após qualificação suficiente, cria-se um Card (Oportunidade) no pipeline
- **Oportunidade = Card** no pipeline com valor, estágio e previsão de fechamento (já existe no IMPA CRM como modelo `Card` com `value`, `status`, `expectedCloseDate`)
- Conversa WhatsApp pode iniciar qualificação automaticamente (cria LeadProfile via automação/IA)
- Pipeline usa motor universal de Kanban (já existe: `Pipeline` → `Stage` → `Card`)
- IA faz lead scoring baseado em: conversa, perfil, histórico, engajamento
- Sources: integrados com canais (WhatsApp, formulário web, importação, manual, API)
- Atividades registradas em `CardActivity` (por domínio, não polimórfico universal)

**Core ou Módulo:** Lead como estado do contato no módulo **CRM/COMERCIAL**. Pipeline no **CORE** (motor universal).

---

### 3.3 VENDAS / PIPELINE / KANBAN

**Como é no Perfex:**
- `LeadsKanban` — classe dedicada para kanban de leads
- `TasksKanban` — classe dedicada para kanban de tarefas
- `ProposalsPipeline` — pipeline para propostas
- `EstimatesPipeline` — pipeline para orçamentos
- `AbstractKanban` — classe base compartilhada
- Cada kanban tem: search, sort, pagination, drag-drop, load more
- Status customizáveis com `statusorder` para posição das colunas

**Problema que resolve:**
Visualização e gestão visual de fluxos de trabalho.

**Limitações:**
- Cada módulo tem seu próprio kanban — código duplicado
- Não existe motor universal reutilizável
- Sem automações no kanban (mover card não dispara ações)
- Sem integração com conversas

**Adaptação IMPA CRM:**
Conforme já definido na proposta Kanban Modular do IMPA CRM:
- **Motor universal de KanbanPipeline** no CORE
- Qualquer entidade pode ter seu pipeline
- Colunas/status configuráveis por pipeline
- Automações ao mover card (trigger on_stage_change)
- WIP limits, SLA, métricas por coluna
- Integração com conversas: ao mover lead, pode enviar mensagem automática

**Core ou Módulo:** Motor Kanban no **CORE**. Pipelines específicos nos módulos.

---

### 3.4 PROPOSTAS

**Como é no Perfex:**
- Tabela `tblproposals` com 40+ campos
- Relacionamento polimórfico: `rel_type` (lead/customer) + `rel_id`
- Itens via `tblitemable` (rel_type='proposal')
- Impostos via `tblitem_tax`
- 6 status: Draft(6), Open(1), Sent(4), Revised(5), Accepted(3), Declined(2)
- Conteúdo template com merge fields (variáveis dinâmicas)
- Assinatura eletrônica (signature, acceptance_*, IP tracking)
- Hash para URL pública (cliente acessa sem login)
- Conversão para Fatura ou Orçamento
- Comentários de cliente/staff
- PDF generation via TCPDF
- Cálculos: subtotal, discount (before/after tax), adjustment, total_tax, total

**Problema que resolve:**
Documento comercial formal para apresentar ao lead/cliente com itens, valores e termos.

**Limitações:**
- Proposta e Orçamento são quase idênticos no Perfex (mesma lógica, tabelas diferentes)
- Sem integração com WhatsApp para envio
- Sem aprovação interna (só aprovação do cliente)
- Sem template visual moderno

**Adaptação IMPA CRM:**
- **Unificar Proposta e Orçamento** em uma única entidade `Proposal`
- Diferenciar por `type: PROPOSAL | ESTIMATE`
- Status: `DRAFT → SENT → VIEWED → ACCEPTED → DECLINED → EXPIRED → REVISED`
- Envio via WhatsApp (link da proposta na mensagem)
- Aprovação interna antes de enviar (opcional, configurável)
- Notificação quando cliente visualiza (via tracking do link)
- IA pode gerar proposta automaticamente com base na conversa + catálogo de itens
- Catálogo de itens vetorizado para recomendação automática
- Assinatura eletrônica mantida
- PDF generation com templates modernos

**Core ou Módulo:** Módulo **CRM/COMERCIAL**.

---

### 3.5 ORÇAMENTOS / ESTIMATES

**Como é no Perfex:**
- Tabela `tblestimates` — quase idêntica a `tblproposals`
- 5 status: Draft(1), Sent(2), Declined(3), Accepted(4), Expired(5)
- Mesmo sistema de itens (`tblitemable` com rel_type='estimate')
- Assinatura eletrônica
- Conversão direta para Fatura
- Itens opcionais (`is_optional`, `is_selected`) — cliente pode selecionar quais itens quer
- Numeração sequencial com prefixo

**Problema que resolve:**
Cotação formal com itens selecionáveis pelo cliente.

**Limitações:**
- Muita duplicação com Propostas
- Diferença conceitual sutil: Proposta é mais descritiva, Orçamento é mais objetivo
- No Perfex, ambos funcionam praticamente igual

**Adaptação IMPA CRM:**
- **Unificar com Proposta** (conforme item 3.4)
- Campo `type` diferencia: `PROPOSAL` (mais descritivo) vs `ESTIMATE` (mais objetivo)
- Recurso de itens opcionais (`isOptional`, `isSelected`) mantido — excelente funcionalidade
- Quando for orçamento, layout mais enxuto focado em itens e valores
- Quando for proposta, permite conteúdo descritivo (seções, imagens, termos)

**Core ou Módulo:** Módulo **CRM/COMERCIAL** (unificado com Propostas).

---

### 3.6 FATURAS

**Como é no Perfex:**
- Tabela `tblinvoices` com 50+ campos
- 6 status: Unpaid(1), Paid(2), Partially(3), Overdue(4), Cancelled(5), Draft(6)
- Itens via `tblitemable` (rel_type='invoice')
- Recorrência integrada (recurring, recurring_type, repeat_every, cycles)
- Múltiplos pagamentos por fatura (parciais)
- Modos de pagamento configuráveis por fatura (`allowed_payment_modes`)
- 11 gateways: Stripe, PayPal, Braintree, Mollie, Authorize, etc.
- Agendamento de envio por email
- Merge de faturas (consolidar múltiplas)
- Faturamento de tarefas (timesheet × rate)
- Faturamento de despesas
- Hash para portal do cliente

**Problema que resolve:**
Cobrança formal com rastreamento de pagamento e recorrência.

**Limitações:**
- Gateways internacionais — sem Pix, boleto, Asaas
- Sem envio de fatura via WhatsApp
- Sem cobrança automática (lembrete manual via email)
- Recorrência não gera automaticamente próxima fatura sem cron job
- Sem integração com NF-e brasileira

**Adaptação IMPA CRM:**
- Manter estrutura de fatura com itens via schema explícito (`InvoiceItem` — inspirado no `itemable` do Perfex, mas sem tabela polimórfica)
- Status: `DRAFT → SENT → VIEWED → PARTIAL → PAID → OVERDUE → CANCELLED`
- **Integração com gateways brasileiros**: Pix, Boleto, Cartão (via Asaas, Stripe, etc.)
- **Envio via WhatsApp**: link de pagamento na mensagem
- **Cobrança automática**: automação dispara lembrete no WhatsApp quando overdue
- **Recorrência inteligente**: job automático gera faturas recorrentes
- **NF-e** (módulo futuro): integração com emissão de nota fiscal
- Faturamento de tarefas e despesas mantido
- Portal do cliente via link com hash

**Core ou Módulo:** Módulo **FINANCEIRO**.

---

### 3.7 PAGAMENTOS

**Como é no Perfex:**
- Tabela `tblinvoicepaymentrecords`
- Campos: invoiceid, amount, paymentmode, date, transactionid, note
- Tipos: offline (manual) e online (gateway)
- Gateway fee tracking
- Tentativas de pagamento (`tblpayment_attempts`)
- Batch payments (pagamento em lote)
- Status da fatura atualizado automaticamente ao registrar pagamento

**Problema que resolve:**
Rastreia cada pagamento recebido e atualiza status financeiro.

**Limitações:**
- Sem baixa automática via webhook de gateway
- Sem conciliação bancária
- Sem dashboard de fluxo de caixa

**Adaptação IMPA CRM:**
- Manter modelo de pagamento vinculado à fatura
- **Webhook de gateway**: baixa automática quando Asaas/Stripe confirma pagamento
- **Notificação WhatsApp**: ao confirmar pagamento, notificar cliente automaticamente
- **Conciliação simplificada**: dashboard mostrando previsão vs recebido
- Campos: `invoiceId, amount, method, date, transactionId, status, gateway, gatewayFee`
- Métodos: `PIX | BOLETO | CREDIT_CARD | DEBIT_CARD | TRANSFER | CASH | OTHER`

**Core ou Módulo:** Módulo **FINANCEIRO**.

#### 3.7.1 ARQUITETURA MODULAR DE GATEWAYS DE PAGAMENTO

**Referência analisada:** Módulo **Connect Asaas 1.7.5** para Perfex CRM.

**Padrão Perfex (referência):**
- Gateway base abstrato: `App_gateway` — interface que todo gateway deve implementar
- Gateway concreto: `Asaas_gateway extends App_gateway` — implementa PIX, Boleto, Cartão de Crédito (até 21x), Carnê
- Registro dinâmico: `register_payment_gateway('Asaas_gateway', 'connect_asaas')` — gateway plugável
- Webhook idempotente: tabela `connect_asaas_webhook_events` com UNIQUE em `asaas_event_id`, sempre retorna HTTP 200
- Sincronização de cliente: cadastra/atualiza cliente no gateway (por CPF/CNPJ) antes de cada cobrança
- Callback multi-evento: processa `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, etc.
- Configuração por módulo: API key (criptografada), sandbox/produção, valor mínimo por método, regras de parcelamento, juros/multa

**Arquitetura IMPA CRM — Sistema de Gateway Modular:**

```
backend/src/modules/payments/
├── payments.service.ts          # Orquestrador — escolhe gateway e delega
├── payments.controller.ts       # Endpoints REST de pagamento
├── payments.webhook.ts          # Endpoint único de webhook (roteia por gateway)
├── gateways/
│   ├── gateway.interface.ts     # Interface abstrata (contrato)
│   ├── gateway.factory.ts       # Factory — instancia gateway pelo slug
│   ├── asaas/
│   │   ├── asaas.gateway.ts     # Implementação Asaas (v3 API)
│   │   ├── asaas.types.ts       # Tipos do Asaas
│   │   └── asaas.webhook.ts     # Parser de webhook Asaas
│   ├── stripe/
│   │   ├── stripe.gateway.ts    # Implementação Stripe (futuro)
│   │   ├── stripe.types.ts
│   │   └── stripe.webhook.ts
│   └── manual/
│       └── manual.gateway.ts    # Pagamento manual (sem gateway externo)
└── reconciliation/
    └── reconciliation.service.ts # Conciliação bancária
```

**Interface do Gateway (contrato obrigatório):**

```typescript
interface PaymentGatewayAdapter {
  readonly slug: string;  // 'asaas' | 'stripe' | 'manual'
  
  // Ciclo de vida
  createCustomer(contact: Contact, doc: string): Promise<GatewayCustomerResult>;
  updateCustomer(externalId: string, data: Partial<Contact>): Promise<void>;
  
  // Cobranças
  createCharge(invoice: Invoice, method: PaymentMethod, options?: ChargeOptions): Promise<ChargeResult>;
  cancelCharge(externalChargeId: string): Promise<void>;
  
  // Assinaturas (opcional)
  createSubscription?(data: SubscriptionData): Promise<SubscriptionResult>;
  cancelSubscription?(externalSubId: string): Promise<void>;
  
  // Estorno
  refund(externalChargeId: string, amount?: number): Promise<RefundResult>;
  
  // Webhook
  parseWebhook(payload: unknown, headers: Record<string, string>): ParsedWebhookEvent;
  validateWebhook(payload: unknown, headers: Record<string, string>): boolean;
  
  // Consulta
  getPaymentStatus(externalChargeId: string): Promise<ExternalPaymentStatus>;
  getCheckoutUrl?(chargeId: string): string | null;  // link de pagamento
}
```

**Padrões obrigatórios (extraídos do Asaas e boas práticas):**

| Padrão | Regra |
|--------|-------|
| **Idempotência de webhook** | Tabela `WebhookEvent` com UNIQUE em `(gateway, gatewayEventId)` — nunca processa mesmo evento 2x |
| **Sempre HTTP 200** | Webhook endpoint retorna 200 mesmo em caso de erro interno (evita retry infinito do gateway) |
| **Validação de origem** | IP whitelist e/ou assinatura HMAC por gateway |
| **Customer sync** | Sincronizar contato com gateway por CPF/CNPJ antes de criar cobrança |
| **Triple check** | Antes de registrar `Payment` como CONFIRMED: (1) webhook recebido, (2) status do gateway consultado via API, (3) valores conferem |
| **Payload auditável** | `webhookPayload` armazena JSON bruto completo do webhook para auditoria |
| **Sandbox toggle** | `PaymentGatewayConfig.sandbox` — toggle por empresa, sem afetar produção |
| **Valor mínimo por método** | Configurável: ex. PIX sem mínimo, Boleto R$10, Cartão R$5 |
| **Método por fatura** | Fatura pode restringir métodos aceitos (ex: só PIX e Boleto) |
| **Retry com backoff** | Falhas de comunicação com gateway: retry exponencial (3 tentativas) via fila |
| **Criptografia de credenciais** | API keys armazenadas criptografadas, descriptografadas apenas em runtime |

**Fluxo de cobrança (exemplo Asaas):**

```
1. Fatura criada → status SENT
2. Backend: PaymentService.createCharge(invoice, method)
3.   → GatewayFactory.get('asaas') → AsaasGateway
4.   → AsaasGateway.createCustomer(contact) — sync CPF/CNPJ
5.   → AsaasGateway.createCharge(invoice, PIX) — POST /v3/payments
6.   → Retorna: chargeId, pixQrCode, pixCopiaECola, dueDate
7. Frontend: exibe QR Code / link de pagamento ao cliente
8. Asaas dispara webhook → POST /api/payments/webhook/asaas
9.   → Verifica idempotência (WebhookEvent)
10.  → Valida origem (IP whitelist)
11.  → Evento PAYMENT_CONFIRMED:
12.     → Consulta API Asaas para triple check
13.     → Registra Payment(status: CONFIRMED)
14.     → Atualiza Invoice(amountPaid, status: PAID/PARTIAL)
15.     → Dispara notificação WhatsApp ao cliente
16.     → Dispara evento interno 'payment.confirmed'
```

**Gateways planejados:**

| Gateway | Métodos | Prioridade | Notas |
|---------|---------|------------|-------|
| **Asaas** | PIX, Boleto, Cartão (até 21x), Carnê | MVP (Etapa 2) | API v3, referência Connect Asaas analisada |
| **Stripe** | Cartão, PIX (via Stripe) | Pós-MVP | Checkout Session + Webhooks |
| **Manual** | Dinheiro, Transferência, Depósito | MVP (Etapa 2) | Sem API externa, registro manual |
| **Outros** | — | Futuro | Mercado Pago, PagSeguro, etc. via mesma interface |

---

### 3.8 NOTAS DE CRÉDITO

**Como é no Perfex:**
- Tabela `tblcreditnotes` — mesma estrutura de faturas
- 3 status: Open(1), Closed(2), Void(3)
- Itens próprios via `tblitemable` (rel_type='credit_note')
- Aplicação de créditos (`tblcredits`): credit_note_id → invoice_id + amount
- Reembolsos (`tblcreditnote_refunds`): amount, payment_mode, transactionid
- Criação automática a partir de fatura
- Cálculo de crédito restante: total - aplicado - reembolsado

**Problema que resolve:**
Gestão de estornos, devoluções e créditos para clientes.

**Limitações:**
- Complexo para operações pequenas
- Sem integração com gateway para estorno automático

**Adaptação IMPA CRM:**
- Manter conceito simplificado
- **Nota de crédito** como registro de crédito do cliente
- Pode ser aplicada como desconto em faturas futuras
- Status: `OPEN → APPLIED → VOID`
- Estorno automático via gateway quando possível
- Vínculo obrigatório com cliente e fatura original (quando aplicável)
- Para MVP, pode ser simplificada como "ajuste financeiro"

**Core ou Módulo:** Módulo **FINANCEIRO** (fase posterior).

---

### 3.9 CATÁLOGO DE PRODUTOS/SERVIÇOS

**Como é no Perfex:**
- Tabela `tblitems` — catálogo de produtos/serviços
- Campos: description, long_description, rate, unit, tax, tax2, group_id
- Grupos/categorias via `tblitems_groups`
- Multi-moeda: colunas dinâmicas `rate_currency_*` para preço em cada moeda
- Usado em: propostas, orçamentos, faturas, notas de crédito
- Tabela intermediária `tblitemable` — instância do item em cada documento
- `tblitem_tax` — impostos por item por documento
- Custom fields para itens
- Busca com autocomplete (search retorna JSON formatado)

**Problema que resolve:**
Catálogo centralizado reutilizável em todos os documentos comerciais.

**Limitações:**
- Sem categorias hierárquicas (apenas grupos simples)
- Sem imagens de produto
- Sem estoque
- Sem variações (tamanho, cor, plano, etc.)
- Sem preço por volume/faixa
- Sem combos/pacotes
- Sem texto comercial estruturado (pitch, benefícios, FAQ)
- Sem vetorização para IA

**Por que isso é crítico no IMPA CRM:**

O catálogo no IMPA CRM não é "uma lista de itens com preço". É o **cérebro da IA comercial** — a base de conhecimento estruturada que permite à IA:
- Responder perguntas de clientes sobre produtos/serviços com precisão
- Recomendar itens relevantes com base na conversa
- Gerar propostas automaticamente combinando itens ideais
- Calcular preços com variações, volume e combos
- Enviar catálogo visual via WhatsApp
- Fazer cross-sell e upsell inteligente

Em CRMs modernos (HubSpot, Salesforce CPQ, PandaDoc), o catálogo de produtos é a **biblioteca central** associada a quotes, invoices, subscriptions e payment links. No IMPA, ele ganha ainda mais poder por estar conectado à IA conversacional via WhatsApp.

**Adaptação IMPA CRM — Catálogo Completo:**

#### Categorias Hierárquicas
- **Categorias** com subcategorias (até 2 níveis): `Categoria > Subcategoria`
- Tabela relacional `ItemCategory` com `parentId` para hierarquia
- Cada categoria com ícone, cor, descrição e posição
- Filtragem por categoria no frontend e na busca IA

#### Imagens e Mídia
- Múltiplas imagens por item (`ItemImage` relacional, não `String[]`)
- Imagem principal (`isPrimary`) para catálogo e WhatsApp
- Suporte a vídeo demo (URL YouTube/storage)
- Imagens por variação (ex: foto do plano Premium vs Básico)
- Envio via WhatsApp como catálogo visual interativo

#### Variações (SKU)
- **Variações de item** para representar: planos, tamanhos, durações, edições
- Tabela `ItemVariant` com: nome, SKU, preço próprio, atributos específicos
- Exemplos:
  - Serviço "Website": variantes "Landing Page", "Institucional", "E-commerce"
  - Plano SaaS: variantes "Básico R$99/mês", "Pro R$199/mês", "Enterprise R$499/mês"
  - Consultoria: variantes "4h", "8h", "Pacote mensal 20h"
- Cada variante pode ter preço, imagens e disponibilidade próprios
- Na proposta/fatura: seleciona variante específica

#### Preço por Volume / Faixas de Preço
- **Tabela de preço escalonada** por quantidade (`ItemPriceTier`)
- Exemplos:
  - 1-10 unidades: R$100/un
  - 11-50 unidades: R$85/un
  - 51+: R$70/un
- A IA pode sugerir upgrade de quantidade: "Se comprar 11+, sai R$85 em vez de R$100"
- Desconto automático aplicado no ProposalItem/InvoiceItem

#### Combos / Pacotes
- **Tabela `ItemBundle`** para agrupar itens com desconto
- Exemplos:
  - "Pacote Startup": Website + Logo + Identidade Visual = R$3.000 (vs R$4.200 separado)
  - "Kit Marketing Mensal": SEO + Google Ads + Social Media = R$2.500/mês
- Cada bundle: nome, descrição, preço fixo OU percentual de desconto
- Itens do bundle com quantidade padrão
- IA pode recomendar bundles: "Pra esse tipo de negócio, o pacote X é ideal"

#### Texto Comercial Estruturado
- **Campos de conteúdo** separados do descrição técnica:
  - `pitch` — texto curto de venda (1-2 frases, usado em WhatsApp)
  - `benefits` — lista de benefícios (JSON array)
  - `features` — especificações técnicas
  - `faq` — perguntas frequentes sobre o item (JSON array)
  - `useCases` — casos de uso / ideal para
  - `testimonial` — depoimento / prova social
- Esse conteúdo é **a base vetorial da IA comercial**:
  - Quando cliente pergunta "vocês fazem website?", a IA busca no Qdrant e responde com pitch + benefícios + preço
  - Quando cliente pergunta "qual a diferença do plano Pro?", a IA acessa as variantes
  - Quando cliente pergunta "tem desconto pra quantidade?", a IA consulta tiers

#### Vetorização para IA (Qdrant)
- Segue padrão existente do IMPA CRM: `AIKnowledgeBase` → `AIKnowledgeSource` → `AIKnowledgeDocument` → `AIKnowledgeChunk`
- O catálogo é tratado como uma **Knowledge Source** do tipo `CATALOG`
- Cada item gera um documento com conteúdo estruturado:
  ```
  [Nome do Item] - [Categoria]
  Pitch: {pitch}
  Preço: R${price} | {variantes com preços}
  Benefícios: {benefits}
  Features: {features}
  Volume: {tiers}
  FAQ: {faq}
  ```
- O conteúdo é chunked e indexado no Qdrant
- **Re-indexação automática**: ao editar item, webhook interno atualiza o Qdrant
- A IA comercial faz busca semântica no catálogo durante conversas
- Integração com tools: `search_catalog`, `get_item_price`, `calculate_bundle`, `generate_quote`

#### Recorrência / Assinaturas
- Campo `billingCycle` no item ou variante: `ONE_TIME`, `MONTHLY`, `QUARTERLY`, `YEARLY`
- Usado para faturas recorrentes e contratos com renovação
- A IA sabe informar: "Esse serviço é R$299/mês com contrato anual"

#### Payment Links
- Cada item/variante pode ter **link de pagamento direto** (integração gateway)
- Útil para: enviar via WhatsApp "Aqui o link pra contratar o Plano Pro"
- Integração com Asaas/Stripe para checkout sem atrito

**Core ou Módulo:** Catálogo no módulo **CRM/COMERCIAL** (entidade central). Vetorização no pipeline **IA/RAG** existente.

> **Implementação em camadas**: O catálogo mantém a visão completa neste documento, mas a entrega pode ser faseada:
> - **Fase inicial**: Item, ItemCategory, ItemVariant, ProposalItem, InvoiceItem — mínimo para o ciclo comercial funcionar
> - **Fase posterior**: ItemBundle, ItemPriceTier, ItemImage (múltiplas), conteúdo comercial expandido (pitch/benefits/features/FAQ), vetorização avançada no Qdrant

---

### 3.10 DESPESAS

**Como é no Perfex:**
- Tabela `tblexpenses`
- Campos: name, amount, category, clientid, project_id, date, paymentmode, currency, tax, tax2, note
- Faturável (`billable`): pode gerar fatura para o cliente
- Recorrência: recurring + recurring_type + repeat_every + cycles
- Categorias customizáveis (`tblexpenses_categories`) com cores
- Conversão direta para fatura
- Comprovantes (anexos)
- 5 estados calculados: ALL, BILLABLE, NON_BILLABLE, BILLED, UNBILLED

**Problema que resolve:**
Controle de custos operacionais e distinção entre despesas faturáveis e internas.

**Limitações:**
- Sem dashboard de fluxo de caixa (despesa vs receita)
- Sem aprovação de despesas
- Sem relatório de margem (receita - despesa por cliente/projeto)
- Sem integração com contas bancárias

**Adaptação IMPA CRM:**
- Manter modelo de despesas com categorias
- **Despesas faturáveis**: manter — excelente funcionalidade
- **Recorrência**: manter para despesas fixas (aluguel, ferramentas, etc.)
- **Dashboard financeiro**: despesa vs receita por período, margem por cliente/projeto
- **Aprovação de despesas** (opcional): workflow de aprovação para despesas acima de X valor
- **Categorias sugeridas**: Aluguel, Software, Pessoal, Marketing, Viagem, Infraestrutura, Outros
- **Relatório de margem**: receita faturada - despesas por cliente ou projeto
- Comprovantes com upload de arquivos

**Core ou Módulo:** Módulo **FINANCEIRO**.

---

### 3.11 CONTRATOS

**Como é no Perfex:**
- Tabela `tblcontracts`
- Campos: client, subject, description, datestart, dateend, contract_value, contract_type_id, content (template com merge fields)
- Tipos de contrato customizáveis (`tblcontracts_types`)
- Assinatura eletrônica (signature, acceptance_*, IP tracking)
- Renovação com histórico (`tblcontract_renewals`): new_start_date, new_end_date, new_value, old_value
- Comentários colaborativos
- Anexos de arquivos
- Campos bloqueados após assinatura
- Alertas de expiração (7 dias antes)
- Merge fields para templates dinâmicos
- PDF generation

**Problema que resolve:**
Formaliza relacionamento comercial com datas, valores e termos.

**Limitações:**
- Sem vínculo direto com proposta/venda
- Sem workflow de aprovação interna
- Sem versionamento de contrato (apenas renovação)
- Templates baseados em HTML/merge fields — datado

**Adaptação IMPA CRM:**
- **Contrato vinculado ao fluxo**: Proposta aceita → pode gerar Contrato automaticamente
- **Relações**: contrato liga a cliente, proposta (origem), projeto (execução)
- **Status**: `DRAFT → PENDING_SIGNATURE → ACTIVE → EXPIRING → EXPIRED → RENEWED → CANCELLED`
- **Renovação**: manter histórico de renovações
- **Assinatura eletrônica**: manter (adaptável para mobile/WhatsApp)
- **Alerta de expiração**: automação envia notificação via WhatsApp 30/15/7 dias antes
- **Templates**: editor moderno (markdown ou rich text) com variáveis dinâmicas
- **Versionamento**: histórico de versões do contrato

**Core ou Módulo:** Módulo **OPERAÇÃO**.

---

### 3.12 PROJETOS

**Como é no Perfex:**
- Tabela `tblprojects` com 20+ campos
- Status: Not Started(1), In Progress(2), On Hold(3), Completed(4), Cancelled(5)
- Tipo de cobrança: Fixed(1), Hourly(2), Free(3)
- Milestones com progresso automático baseado em tasks
- Membros (staff) atribuídos
- Discussões internas com threads
- Arquivos compartilhados
- Gantt chart
- Timesheet integrado
- 19 toggles de configuração por projeto
- Tabs: Overview, Tasks, Invoices, Gantt, Milestones, Files, Expenses, Activity, Notes, Contracts, Estimates, Proposals, Tickets

**Problema que resolve:**
Gestão de entrega e pós-venda com rastreamento de progresso.

**Limitações:**
- Sem integração com conversas/cliente via WhatsApp
- Sem template de projeto (reuso de estrutura)
- Sem automações (status não dispara ações)
- Gantt complexo para operações simples

**Adaptação IMPA CRM:**
- **Projeto como hub do pós-venda**: cliente + contrato + tarefas + entregas
- **Templates de projeto**: criar projeto a partir de template predefinido (com milestones e tarefas padrão)
- **Automação**: ao concluir projeto, notificar cliente via WhatsApp
- **Kanban de projetos**: usar motor universal de kanban
- **Membros e responsáveis**: atribuição de equipe
- **Milestones**: manter como fases do projeto
- **Simplificar**: remover Gantt no MVP, focar em Kanban + lista de tarefas
- **Vínculo**: projeto → cliente + contrato + tarefas + conversas

**Core ou Módulo:** Módulo **OPERAÇÃO**.

---

### 3.13 TAREFAS

**Como é no Perfex:**
- Tabela `tbltasks` com 25+ campos
- Status: Not Started(1), Awaiting Feedback(2), Testing(3), In Progress(4), Complete(5)
- Prioridades: Low, Medium, High, Urgent
- Polimórfica: `rel_type` (project/contract/invoice/estimate/lead/customer) + `rel_id`
- Checklist de sub-tarefas com templates reutilizáveis
- Time tracking (timers com start/end por staff)
- Múltiplos assignees e followers
- Comentários com @mentions
- Kanban com reordenação
- Recorrência automática
- Faturável (billed → invoice_id)
- Visibilidade configurável (public, visible_to_client, hide_from_owner)
- Clone completo com opções selecionáveis

**Problema que resolve:**
Gestão granular de trabalho com rastreamento de tempo e integração operacional.

**Limitações:**
- Sem subtarefas reais (apenas checklist)
- Sem dependências entre tarefas
- Sem estimativa de tempo (apenas tracking)
- Sem integração com conversas

**Adaptação IMPA CRM:**
- **Tarefa com FKs explícitas**: projectId, milestoneId, contractId, contactId, opportunityId, conversationId — sem relação polimórfica `relationType`/`relationId` (seguindo padrão do Card)
- **Kanban universal**: tarefas usam o motor de kanban do CORE
- **Checklist**: manter como sub-itens da tarefa
- **Time tracking**: manter para cálculo de produtividade e faturamento
- **Prioridades**: Low, Medium, High, Urgent (manter)
- **Assignees**: tabela relacional `TaskAssignee` (seguindo padrão TeamMember — nunca `String[]`)
- **Recorrência**: manter (dailys, weeklys, etc.)
- **Automação**: ao completar tarefa → notificar owner, atualizar projeto, criar próxima tarefa
- **Conversa**: tarefa pode ser criada a partir de uma conversa (botão "criar tarefa" no chat)
- **Futuro**: subtarefas reais e dependências (fase posterior)

**Core ou Módulo:** Módulo **OPERAÇÃO**.

---

### 3.14 RELATÓRIOS

**Como é no Perfex:**
- **Leads**: conversões mensais, leads por semana, por staff, por source
- **Vendas**: faturas, orçamentos, propostas, notas de crédito (por status, agente, imposto)
- **Financeiro**: renda vs despesas (mensal), renda total, por método de pagamento, por grupo de cliente
- **Pagamentos**: detalhamento de pagamentos recebidos
- **Clientes**: relatório de clientes
- Chart.js para gráficos com cores customizáveis
- DataTables com totalizadores no rodapé
- Filtros por período, moeda, agente
- Suporte multi-moeda com conversão automática

**Problema que resolve:**
Visibilidade sobre desempenho comercial, financeiro e operacional.

**Limitações:**
- Sem relatórios de conversas/WhatsApp
- Sem relatórios de IA (classificações, recomendações)
- Sem relatórios de produtividade detalhados
- Sem relatórios de pipeline/funnel reais
- Apresentação datada (tabelas jQuery)

**Adaptação IMPA CRM:**
Relatórios reorganizados e ampliados:

**Comercial:**
- Funil de vendas (lead → proposta → venda) com taxa de conversão por etapa
- Pipeline por período, responsável, source
- Ticket médio e ciclo de venda
- Leads criados vs convertidos vs perdidos

**Financeiro:**
- Receita prevista vs recebida
- Despesas por categoria e período
- Margem por cliente e por projeto
- Contas a receber (faturas abertas/vencidas)
- Fluxo de caixa (projeção)
- Pagamentos por método

**Conversas:**
- Volume de conversas por período
- Tempo médio de resposta
- Conversas por responsável
- Conversas que geraram vendas
- Satisfação (se implementar CSAT)

**Produtividade:**
- Tarefas por responsável (feitas, atrasadas, em andamento)
- Horas trabalhadas por projeto/tarefa
- Tempo de resposta a leads

**IA:**
- Classificações automáticas vs acertos
- Recomendações de produtos aceitas
- Conversas resolvidas por IA vs humano

**Core ou Módulo:** Módulo **RELATÓRIOS** (transversal).

---

### 3.15 LOGS / HISTÓRICO / TIMELINE

**Como é no Perfex:**
- `tblactivity` — log global (description, staffid, date)
- `tblleads_activity_log` — log específico de leads (staff, description, additional_data, custom_activity)
- `tblprojectactivity` — log específico de projetos (visible_to_customer control)
- `tblsales_activity` — log de vendas
- Activity logs em cada model: `log_activity()`, `log_invoice_activity()`, `log_estimate_activity()`
- Cada módulo registra suas próprias atividades em tabelas separadas

**Problema que resolve:**
Rastreabilidade completa de ações.

**Limitações:**
- Logs fragmentados em múltiplas tabelas por módulo
- Sem timeline unificada visual
- Sem contexto rico (apenas descrição texto)
- Sem filtros avançados

**Adaptação IMPA CRM:**
- **NÃO usar Timeline Universal polimórfica** com `entityType`/`entityId` — na prática, Prisma não suporta relações polimórficas; a relação `activities Activity[]` em cada model é falsa
- **Seguir padrão existente do IMPA CRM**: tabelas de atividade por domínio
  - `CardActivity` — já existe: atividades por card/oportunidade (STAGE_CHANGED, ASSIGNED, NOTE_ADDED, etc.)
  - `ConversationEvent` — já existe: eventos por conversa
  - `AuditLog` — já existe: log geral com `entity`, `entityId`, `oldData`, `newData`
- **Para novas entidades**: criar tabelas como `ProposalActivity`, `InvoiceActivity`, `ContractActivity` seguindo o padrão do `CardActivity`
- **Cada tabela tem FK explícita**: `proposalId`, `invoiceId`, `contractId` (não `entityType`/`entityId`)
- **Timeline no frontend**: endpoint de API que agrega atividades de múltiplas tabelas e retorna cronologicamente (query-based, não relação Prisma)
- **Filtros**: por tipo de ação, por usuário, por período
- **Integração com conversas**: mensagens WhatsApp aparecem na timeline do contato/lead via `ConversationEvent`

**Core ou Módulo:** **CORE** — padrão de activity por domínio (não tabela única universal).

---

### 3.16 PERMISSÕES E PAPÉIS

**Como é no Perfex:**
- Tabela `tblroles` — papéis com permissões serializadas
- Tabela `tblstaff` — funcionários vinculados a um role
- `tblstaff_permissions` — permissões individuais por staff
- Verificação: `staff_can('action', 'module')` / `staff_cant()`
- Ações: view, view_own, create, edit, delete
- Módulos: customers, invoices, estimates, contracts, projects, tasks, expenses, proposals, credit_notes, leads
- Staff pode ser admin do sistema
- Customer admins: staff com acesso a clientes específicos

**Problema que resolve:**
Controle de acesso granular por funcionalidade.

**Limitações:**
- Sem multi-tenant (single company)
- Sem permissões por módulo ativável
- Sem permissões por campo
- Permissões serializadas (não relacionais)

**Adaptação IMPA CRM:**
Conforme já definido na proposta RBAC do IMPA CRM:
- **RBAC completo e relacional** (já implementado)
- Papéis: SUPER_ADMIN, ADMIN, MANAGER, AGENT, VIEWER
- Permissões por recurso e ação (create, read, update, delete, manage)
- **Multi-tenant**: permissões respeitam empresa do usuário
- **Módulos**: permissões só aplicam quando módulo está ativo para a empresa
- **Escopo**: own (só seus), team (do time), all (todos)
- **Manter** do Perfex: granularidade view/view_own/create/edit/delete por módulo
- **Adicionar**: permissões por módulo ativável, por empresa

**Core ou Módulo:** **CORE** (já implementado).

---

## 4. ARQUITETURA PROPOSTA PARA O IMPA CRM

### 4.1 Backend (Node.js + Prisma + PostgreSQL)

```
backend/src/
├── core/                       # Domínio CORE
│   ├── contacts/               # Contatos
│   ├── organizations/          # Organizações (empresas dos clientes)
│   ├── users/                  # Usuários do sistema
│   ├── teams/                  # Times
│   ├── permissions/            # RBAC (já existe)
│   ├── tags/                   # Tags polimórficas
│   ├── customFields/           # Campos personalizados
│   ├── conversations/          # Conversas (já existe)
│   ├── messages/               # Mensagens (já existe)
│   ├── activities/             # Activity por domínio (ProposalActivity, InvoiceActivity, etc.)
│   ├── documents/              # Document Engine (numeração, hash, PDF, tracking)
│   ├── automations/            # Motor de automação
│   ├── ai/                     # IA provider (já existe)
│   ├── kanban/                 # Motor universal de Kanban
│   ├── files/                  # Uploads e anexos
│   └── notifications/         # Notificações
│
├── commercial/                 # Domínio CRM/COMERCIAL
│   ├── leads/                  # Lead management (qualificação)
│   ├── customerAccounts/       # Conta Cliente (CustomerAccount)
│   ├── opportunities/          # Oportunidades = Cards no pipeline de vendas
│   ├── proposals/              # Propostas + Orçamentos unificados
│   ├── catalog/                # Catálogo de produtos/serviços
│   │   ├── item.routes.ts       # CRUD de itens
│   │   ├── item.service.ts      # Lógica + re-indexação Qdrant
│   │   ├── category.routes.ts   # Categorias hierárquicas
│   │   ├── variant.routes.ts    # Variações por item
│   │   ├── bundle.routes.ts     # Combos/pacotes
│   │   ├── price-tier.routes.ts # Faixas de preço por volume
│   │   └── catalog-indexer.ts   # Webhook de re-indexação no Qdrant
│   └── sources/                # Fontes de lead
│
├── financial/                  # Domínio FINANCEIRO
│   ├── invoices/               # Faturas
│   ├── payments/               # Pagamentos
│   ├── creditNotes/            # Notas de crédito
│   ├── expenses/               # Despesas
│   ├── currencies/             # Moedas
│   ├── taxes/                  # Impostos
│   └── paymentMethods/         # Métodos de pagamento
│
├── operations/                 # Domínio OPERAÇÃO
│   ├── contracts/              # Contratos
│   ├── projects/               # Projetos
│   ├── tasks/                  # Tarefas
│   ├── milestones/             # Marcos de projeto
│   └── checklists/             # Checklists de tarefa
│
├── reports/                    # Domínio RELATÓRIOS
│   ├── sales/                  # Relatórios de vendas
│   ├── financial/              # Relatórios financeiros
│   ├── conversations/          # Relatórios de conversas
│   ├── productivity/           # Relatórios de produtividade
│   └── pipeline/               # Relatórios de pipeline/funil
│
└── modules/                    # Módulos de nicho (ativáveis por empresa)
    ├── realEstate/             # Imobiliário
    ├── healthClinic/           # Clínica
    ├── lawFirm/                # Escritório jurídico
    └── ...
```

### 4.2 Frontend (React + Tailwind + Zustand)

```
frontend/src/
├── components/
│   ├── ui/                     # Componentes base (botões, inputs, modais)
│   ├── kanban/                 # Kanban universal (já existe base)
│   ├── timeline/               # Timeline agregada (consulta activities de cada domínio)
│   ├── documents/              # Viewer de propostas, faturas, contratos
│   ├── forms/                  # Formulários dinâmicos com custom fields
│   └── charts/                 # Gráficos para relatórios
│
├── pages/
│   ├── contacts/               # Contatos
│   ├── leads/                  # Leads + Pipeline Kanban
│   ├── proposals/              # Propostas e Orçamentos
│   ├── invoices/               # Faturas
│   ├── payments/               # Pagamentos
│   ├── expenses/               # Despesas
│   ├── contracts/              # Contratos
│   ├── projects/               # Projetos
│   ├── tasks/                  # Tarefas
│   ├── catalog/                # Catálogo (categorias, itens, variações, combos)
│   ├── reports/                # Relatórios
│   └── settings/               # Configurações
│
├── stores/                     # Zustand stores por domínio
└── services/                   # API services
```

### 4.3 Chat como Hub Comercial Central

A conversa WhatsApp não é apenas um canal de comunicação — é o **ponto central de operação comercial**. O IMPA CRM deve tratar o chat como um hub que conecta todas as entidades comerciais.

**Sidebar Comercial do Chat:**
Ao abrir uma conversa, a sidebar deve mostrar o contexto comercial completo do contato:
- Dados do contato + Organização
- Conta Cliente (se existir) com status financeiro
- Oportunidades abertas (Cards no pipeline)
- Propostas enviadas/pendentes
- Faturas abertas/vencidas
- Contratos ativos
- Projetos em andamento
- Últimas atividades

**Ações rápidas a partir do chat:**
- Botão "Qualificar Lead" → cria LeadProfile para o contato
- Botão "Criar Oportunidade" → Card no pipeline
- Botão "Enviar Proposta" → gera e envia link
- Botão "Criar Tarefa" → tarefa vinculada à conversa
- Botão "Enviar Fatura" → link de pagamento

**De qualquer entidade comercial:**
- Proposta/Fatura/Contrato: botão "Enviar via WhatsApp"
- IA age no contexto: conhece o catálogo, histórico comercial e perfil
- Tudo bidirecional: CRM ← → Conversas

Toda entidade comercial deve se conectar com conversas:

| Entidade | Integração WhatsApp |
|----------|---------------------|
| **Contato** | Criado automaticamente ao receber mensagem |
| **Lead** | Conversa pode iniciar qualificação via automação/IA (cria LeadProfile) |
| **Proposta** | Envio do link da proposta via WhatsApp |
| **Fatura** | Envio do link de pagamento via WhatsApp |
| **Contrato** | Envio do link de assinatura via WhatsApp |
| **Pagamento** | Notificação de confirmação via WhatsApp |
| **Projeto** | Atualizações de progresso via WhatsApp |
| **Tarefa** | Criação a partir de mensagem do chat |

### 4.4 Integração com IA e Automações

| Funcionalidade IA | Como funciona |
|--------------------|---------------|
| **Classificação de lead** | IA analisa conversa e classifica lead (quente/morno/frio) |
| **Qualificação automática** | Conversa com intenção comercial → cria LeadProfile automaticamente |
| **Preenchimento de campos** | IA extrai nome, email, telefone, empresa da conversa |
| **Busca semântica no catálogo** | Tool `search_catalog` busca no Qdrant: pitch, benefícios, features, FAQ dos itens |
| **Recomendação inteligente** | IA cruza conversa + perfil + catálogo vetorizado → sugere itens, variantes e bundles ideais |
| **Cálculo de preço dinâmico** | Tool `calculate_price` aplica faixas de volume, combos e descontos automaticamente |
| **Geração de proposta** | IA monta proposta completa: seleciona itens, variantes, quantidades e calcula total |
| **Cross-sell / Upsell** | IA sugere upgrade de variante ou bundle complementar durante a conversa |
| **Resposta comercial** | IA responde perguntas sobre preços, diferenças entre planos, prazos — com dados reais do catálogo |
| **Envio de catálogo visual** | IA pode enviar card/carrossel com imagens dos itens via WhatsApp |
| **Scoring de lead** | IA calcula probabilidade de conversão com base em engajamento + perfil |
| **Payment link** | IA pode gerar e enviar link de pagamento do item/variante direto no chat |

---

## 5. MODELAGEM DE DADOS

### 5.1 Modelo Prisma Sugerido

```prisma
// ============================================
// CORE
// ============================================

// Contato já existe no IMPA CRM — adicionar campos:
model Contact {
  id            String    @id @default(uuid())
  companyId     String    // tenant (empresa dona do CRM)
  name          String
  phoneNumber   String
  email         String?
  profilePicture String?
  tags          String[]  @default([])
  metadata      Json?
  isActive      Boolean   @default(true)
  lastInboundAt DateTime?
  source        String?   // whatsapp, website, manual, import, api
  assignedTo    String?   // userId responsável
  customFields  Json?
  notes         String?
  
  // Relações existentes
  company           Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  conversations     Conversation[]
  
  // Novas relações comerciais
  organizationId    String?
  organization      Organization?  @relation(fields: [organizationId], references: [id])
  leadProfile       LeadProfile?   // perfil comercial (quando em qualificação)
  accountMemberships CustomerAccountContact[] // vínculos com contas cliente (via tabela relacional)
  opportunities     Card[]         // Oportunidade = Card no pipeline
  proposals         Proposal[]
  invoices          Invoice[]
  contracts         Contract[]
  projects          Project[]
  tasks             Task[]         @relation("TaskContact") // tarefas vinculadas ao contato
  gatewayCustomers  GatewayCustomer[] // mapeamento em gateways de pagamento
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@unique([companyId, phoneNumber])
  @@index([companyId, lastInboundAt])
  @@map("contacts")
}

// Organização = empresa do CLIENTE (PJ)
// Nome "Organization" evita confusão com Company (tenant)
model Organization {
  id            String    @id @default(uuid())
  companyId     String    // tenant
  name          String
  tradeName     String?
  document      String?   // CNPJ
  email         String?
  phone         String?
  website       String?
  address       Json?     // { street, city, state, zip, country }
  billingAddress Json?
  contacts      Contact[]
  customerAccounts CustomerAccount[] // contas cliente desta organização
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@map("organizations")
}

// Conta Cliente = relação comercial/financeira ativa
// Suporta B2C (conta ligada a pessoa) E B2B (conta ligada a organização)
// B2C: 1 contato na tabela de membros, organizationId null
// B2B: organizationId aponta pra empresa, múltiplos contatos com papeis via CustomerAccountContact
model CustomerAccount {
  id              String    @id @default(uuid())
  companyId       String    // tenant
  
  // Flexibilidade B2B/B2C
  organizationId  String?   // B2B: empresa do cliente
  organization    Organization? @relation(fields: [organizationId], references: [id])
  accountType     AccountType @default(INDIVIDUAL) // INDIVIDUAL (B2C) | BUSINESS (B2B)
  
  // Membros da conta (tabela relacional — suporta múltiplos contatos com papeis)
  members         CustomerAccountContact[]
  
  // Dados financeiros
  billingName     String?
  billingEmail    String?
  billingAddress  Json?
  shippingAddress Json?
  taxId           String?   // CPF/CNPJ para fatura
  creditLimit     Decimal?  @db.Decimal(15, 2)
  paymentTermDays Int?      @default(30) // prazo de pagamento
  
  // Status
  status          CustomerStatus @default(ACTIVE)
  firstPurchaseAt DateTime?
  lastPurchaseAt  DateTime?
  totalSpent      Decimal?  @db.Decimal(15, 2) @default(0)
  
  // Observações
  notes           String?
  customFields    Json?
  
  createdBy       String
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  @@map("customer_accounts")
}

// Tabela relacional de contatos da conta cliente (padrão TeamMember)
// B2C: 1 contato com role PRIMARY
// B2B: múltiplos contatos com papeis (decisor, financeiro, operacional, etc.)
model CustomerAccountContact {
  id                String   @id @default(uuid())
  customerAccountId String
  customerAccount   CustomerAccount @relation(fields: [customerAccountId], references: [id], onDelete: Cascade)
  contactId         String
  contact           Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  role              CustomerAccountContactRole @default(MEMBER)
  isPrimary         Boolean  @default(false)
  createdAt         DateTime @default(now())

  @@unique([customerAccountId, contactId])
  @@map("customer_account_contacts")
}

enum CustomerAccountContactRole {
  PRIMARY         // contato principal / decisor
  BILLING         // responsável financeiro
  DECISION_MAKER  // tomador de decisão
  OPERATIONAL     // contato operacional
  MEMBER          // membro genérico
}

enum AccountType {
  INDIVIDUAL  // B2C: conta de pessoa física
  BUSINESS    // B2B: conta empresarial
}

enum CustomerStatus {
  ACTIVE
  INACTIVE
  CHURNED
}

// Perfil comercial do contato (Lead)
// Separa dados da pessoa (Contact) dos dados do processo comercial
// Criado quando contato entra em qualificação
model LeadProfile {
  id                String    @id @default(uuid())
  companyId         String    // tenant
  contactId         String    @unique
  contact           Contact   @relation(fields: [contactId], references: [id], onDelete: Cascade)
  
  // Estado comercial
  status            LeadStatus @default(NEW)
  temperature       LeadTemperature @default(COLD) // quente/morno/frio
  score             Int?      // 0-100, calculado pela IA
  source            String?   // whatsapp, website, referral, ad, import
  channel           String?   // instagram, google, indicacao, etc.
  
  // Qualificação
  qualifiedAt       DateTime?
  qualificationNotes String?
  disqualifiedAt    DateTime?
  disqualifiedReason String?
  
  // Budget
  estimatedBudget   Decimal?  @db.Decimal(15, 2)
  budgetCurrency    String?   @default("BRL")
  
  // Atribuição
  assignedTo        String?   // userId responsável pela qualificação
  
  // Conversão
  convertedAt       DateTime? // quando virou oportunidade (Card)
  opportunityId     String?   // referência lógica ao Card criado (escalar, não relation Prisma)
  // NOTA: opportunityId é referência escalar de rastreamento, não @relation.
  // Card já é entidade complexa no pipeline — evitar acoplamento circular.
  
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  @@map("lead_profiles")
}

enum LeadStatus {
  NEW           // recém-identificado
  CONTACTED     // primeiro contato feito
  QUALIFYING    // em processo de qualificação
  QUALIFIED     // qualificado → pronto para virar oportunidade
  UNQUALIFIED   // não qualificado (sem perfil)
  DISQUALIFIED  // desqualificado (spam, fora do ICP)
}

enum LeadTemperature {
  HOT
  WARM
  COLD
}

// Activity POR DOMÍNIO — padrão do IMPA CRM existente
// CardActivity já existe. Criar tabelas similares para cada domínio.
// NÃO usar tabela universal polimórfica (Prisma não suporta relações polimórficas)

// Já existe: CardActivity (para oportunidades/cards)
// Já existe: ConversationEvent (para conversas)
// Já existe: AuditLog (log geral)

model ProposalActivity {
  id          String    @id @default(uuid())
  proposalId  String
  proposal    Proposal  @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  type        String    // STATUS_CHANGED, SENT, VIEWED, COMMENTED, etc.
  content     String?
  actorId     String?
  actorType   String?   // user, system, client
  oldValue    String?
  newValue    String?
  metadata    Json?
  createdAt   DateTime  @default(now())
  
  @@map("proposal_activities")
}

model InvoiceActivity {
  id          String    @id @default(uuid())
  invoiceId   String
  invoice     Invoice   @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  type        String    // STATUS_CHANGED, SENT, PAYMENT_RECEIVED, OVERDUE, etc.
  content     String?
  actorId     String?
  actorType   String?
  oldValue    String?
  newValue    String?
  metadata    Json?
  createdAt   DateTime  @default(now())
  
  @@map("invoice_activities")
}

model ContractActivity {
  id          String    @id @default(uuid())
  contractId  String
  contract    Contract  @relation(fields: [contractId], references: [id], onDelete: Cascade)
  type        String    // STATUS_CHANGED, SIGNED, RENEWED, EXPIRING, etc.
  content     String?
  actorId     String?
  actorType   String?
  oldValue    String?
  newValue    String?
  metadata    Json?
  createdAt   DateTime  @default(now())
  
  @@map("contract_activities")
}

model ProjectActivity {
  id          String    @id @default(uuid())
  projectId   String
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type        String    // STATUS_CHANGED, MEMBER_ADDED, MILESTONE_COMPLETED, etc.
  content     String?
  actorId     String?
  actorType   String?
  oldValue    String?
  newValue    String?
  metadata    Json?
  createdAt   DateTime  @default(now())
  
  @@map("project_activities")
}

// ============================================
// CRM / COMERCIAL
// ============================================

// Oportunidade = Card (já existe no IMPA CRM)
// O modelo Card já tem: pipelineId, stageId, companyId, contactId,
// conversationId, title, value, currency, assigneeId, teamId,
// position, priority, status(OPEN/WON/LOST/ARCHIVED),
// expectedCloseDate, wonAt, lostAt, lostReason, customFields
// NÃO criar Opportunity separado — usar Card com pipeline do tipo SALES

// ============================================
// CATÁLOGO DE PRODUTOS/SERVIÇOS
// ============================================

model ItemCategory {
  id          String    @id @default(uuid())
  companyId   String
  name        String
  slug        String
  description String?
  icon        String?   // nome do ícone (ex: "package", "code", "palette")
  color       String?
  position    Int       @default(0)
  
  // Hierarquia (até 2 níveis)
  parentId    String?
  parent      ItemCategory? @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children    ItemCategory[] @relation("CategoryHierarchy")
  
  items       Item[]
  
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  
  @@unique([companyId, slug])
  @@map("item_categories")
}

model Item {
  id              String    @id @default(uuid())
  companyId       String
  name            String
  slug            String
  type            ItemType  @default(SERVICE) // PRODUCT | SERVICE
  
  // Categorização
  categoryId      String?
  category        ItemCategory? @relation(fields: [categoryId], references: [id])
  
  // Descrição técnica
  description     String?       // descrição curta
  longDescription String?       // descrição detalhada (markdown)
  
  // Texto comercial (base vetorial da IA)
  pitch           String?       // texto curto de venda (1-2 frases, usado em WhatsApp)
  benefits        Json?         // ["Aumento de 40% nas vendas", "Setup em 48h", ...]
  features        Json?         // ["Responsivo", "SEO otimizado", "Painel admin", ...]
  faq             Json?         // [{"q": "Quanto tempo leva?", "a": "7 dias úteis"}, ...]
  useCases        String?       // "Ideal para: startups, e-commerces, ..."
  testimonial     String?       // "Aumentamos 300% o faturamento — João, CEO"
  
  // Preço base
  price           Decimal   @db.Decimal(15, 2)
  currency        String    @default("BRL")
  unit            String?   // un, hr, m², kg, mês, etc.
  
  // Recorrência
  billingCycle    BillingCycle @default(ONE_TIME)
  
  // Impostos
  taxRate         Decimal?  @db.Decimal(5, 2)
  
  // Identificação
  sku             String?
  barcode         String?
  
  // Status
  active          Boolean   @default(true)
  featured        Boolean   @default(false) // destaque no catálogo
  position        Int       @default(0)
  
  // Custom fields
  customFields    Json?
  
  // Vetorização IA: conteúdo indexado no Qdrant via pipeline RAG existente
  // Item é tratado como AIKnowledgeSource tipo CATALOG
  // Ao salvar/editar, webhook interno re-indexa no Qdrant
  // Campos vetorizados: name + pitch + benefits + features + faq + useCases + variantes
  qdrantIndexedAt DateTime?  // última indexação no Qdrant
  
  // Relações
  variants      ItemVariant[]
  images        ItemImage[]
  priceTiers    ItemPriceTier[]
  bundles       ItemBundleItem[]
  proposalItems ProposalItem[]
  invoiceItems  InvoiceItem[]
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@unique([companyId, slug])
  @@index([companyId, active])
  @@index([companyId, categoryId])
  @@map("items")
}

enum ItemType {
  PRODUCT
  SERVICE
}

enum BillingCycle {
  ONE_TIME
  MONTHLY
  QUARTERLY
  SEMIANNUAL
  YEARLY
}

model ItemVariant {
  id          String    @id @default(uuid())
  itemId      String
  item        Item      @relation(fields: [itemId], references: [id], onDelete: Cascade)
  name        String    // "Plano Pro", "8h", "Tamanho G"
  sku         String?
  price       Decimal   @db.Decimal(15, 2)
  currency    String    @default("BRL")
  billingCycle BillingCycle?  // override do item pai
  description String?
  attributes  Json?     // {"duração": "8h", "suporte": "prioritário"}
  active      Boolean   @default(true)
  position    Int       @default(0)
  
  // Imagens específicas da variante
  images      ItemImage[]
  priceTiers  ItemPriceTier[]
  
  // Usado em documentos
  proposalItems ProposalItem[]
  invoiceItems  InvoiceItem[]
  
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  
  @@map("item_variants")
}

model ItemImage {
  id          String    @id @default(uuid())
  itemId      String
  item        Item      @relation(fields: [itemId], references: [id], onDelete: Cascade)
  variantId   String?   // se for imagem de variante específica
  variant     ItemVariant? @relation(fields: [variantId], references: [id], onDelete: Cascade)
  url         String    // path no storage
  alt         String?
  isPrimary   Boolean   @default(false)
  position    Int       @default(0)
  
  createdAt   DateTime  @default(now())
  
  @@map("item_images")
}

model ItemPriceTier {
  id          String    @id @default(uuid())
  itemId      String
  item        Item      @relation(fields: [itemId], references: [id], onDelete: Cascade)
  variantId   String?   // tier pode ser por variante
  variant     ItemVariant? @relation(fields: [variantId], references: [id], onDelete: Cascade)
  minQuantity Int       // 1, 11, 51
  maxQuantity Int?      // null = ilimitado
  price       Decimal   @db.Decimal(15, 2)
  
  @@map("item_price_tiers")
}

model ItemBundle {
  id          String    @id @default(uuid())
  companyId   String
  name        String    // "Pacote Startup", "Kit Marketing Mensal"
  slug        String
  description String?
  pitch       String?   // texto comercial do bundle
  
  // Preço do bundle
  pricingType BundlePricingType @default(FIXED) // FIXED ou DISCOUNT
  fixedPrice  Decimal?  @db.Decimal(15, 2)       // se FIXED
  discountPercent Decimal? @db.Decimal(5, 2)     // se DISCOUNT (% de desconto)
  currency    String    @default("BRL")
  billingCycle BillingCycle @default(ONE_TIME)
  
  // Imagem
  imageUrl    String?
  
  active      Boolean   @default(true)
  featured    Boolean   @default(false)
  
  // Itens do bundle
  items       ItemBundleItem[]
  
  // Usado em documentos
  proposalItems ProposalItem[]
  invoiceItems  InvoiceItem[]
  
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  
  @@unique([companyId, slug])
  @@map("item_bundles")
}

enum BundlePricingType {
  FIXED       // preço fixo do pacote
  DISCOUNT    // percentual de desconto sobre soma dos itens
}

model ItemBundleItem {
  id          String    @id @default(uuid())
  bundleId    String
  bundle      ItemBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  itemId      String
  item        Item      @relation(fields: [itemId], references: [id])
  variantId   String?   // variante específica no bundle (opcional)
  quantity    Decimal   @db.Decimal(15, 4) @default(1)
  position    Int       @default(0)
  
  // NOTA: @@unique com campo nullable em Postgres permite duplicatas quando variantId=NULL.
  // Validar unicidade no application layer: bundleId+itemId quando variantId é null.
  @@unique([bundleId, itemId, variantId])
  @@map("item_bundle_items")
}

model Proposal {
  id            String    @id @default(uuid())
  companyId     String
  number        Int
  prefix        String?   @default("PROP-")
  type          ProposalType @default(PROPOSAL) // PROPOSAL | ESTIMATE
  contactId     String
  contact       Contact   @relation(fields: [contactId], references: [id])
  opportunityId String?   // Card do pipeline (oportunidade)
  opportunity   Card?     @relation("ProposalOpportunity", fields: [opportunityId], references: [id])
  title         String
  content       String?   // conteúdo descritivo (markdown/HTML)
  
  // Valores
  subtotal      Decimal   @db.Decimal(15, 2) @default(0)
  discountPercent Decimal? @db.Decimal(5, 2)
  discountAmount Decimal?  @db.Decimal(15, 2)
  discountType  String?   // before_tax | after_tax
  taxTotal      Decimal   @db.Decimal(15, 2) @default(0)
  adjustment    Decimal?  @db.Decimal(15, 2)
  total         Decimal   @db.Decimal(15, 2) @default(0)
  currency      String    @default("BRL")
  
  // Datas
  date          DateTime  @default(now())
  validUntil    DateTime?
  
  // Status
  status        ProposalStatus @default(DRAFT)
  sentAt        DateTime?
  viewedAt      DateTime?
  acceptedAt    DateTime?
  declinedAt    DateTime?
  
  // Assinatura
  signatureFile String?
  acceptanceName String?
  acceptanceEmail String?
  acceptanceIp  String?
  
  // Hash para acesso público
  hash          String    @unique @default(uuid())
  
  // Responsável
  assignedTo    String?
  createdBy     String
  
  // Conversão
  // Invoice.proposalId é a fonte de verdade da relação Proposal↔Invoice
  // Se Proposal.status = ACCEPTED e existe Invoice com proposalId = this.id, a proposta foi convertida
  convertedAt   DateTime?
  
  // Termos
  terms         String?
  clientNote    String?
  internalNote  String?
  
  items         ProposalItem[]
  comments      ProposalComment[]
  activities    ProposalActivity[]
  invoice       Invoice?       // fatura gerada (1:1 via Invoice.proposalId @unique)
  contracts     Contract[]     // contratos originados desta proposta
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@unique([companyId, prefix, number])
  @@map("proposals")
}

enum ProposalType {
  PROPOSAL
  ESTIMATE
}

enum ProposalStatus {
  DRAFT
  SENT
  VIEWED
  ACCEPTED
  DECLINED
  EXPIRED
  REVISED
}

model ProposalItem {
  id            String    @id @default(uuid())
  proposalId    String
  proposal      Proposal  @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  
  // Referência ao catálogo (opcional — pode ser item avulso)
  itemId        String?
  item          Item?     @relation(fields: [itemId], references: [id])
  variantId     String?   // variante específica
  variant       ItemVariant? @relation(fields: [variantId], references: [id])
  bundleId      String?   // se veio de um bundle
  bundle        ItemBundle? @relation(fields: [bundleId], references: [id])
  
  description   String
  longDescription String?
  quantity      Decimal   @db.Decimal(15, 4) @default(1)
  unit          String?
  rate          Decimal   @db.Decimal(15, 2)
  taxRate       Decimal?  @db.Decimal(5, 2)
  taxAmount     Decimal?  @db.Decimal(15, 2)
  discount      Decimal?  @db.Decimal(15, 2)  // desconto por item
  total         Decimal   @db.Decimal(15, 2)
  sortOrder     Int       @default(0)
  isOptional    Boolean   @default(false)
  isSelected    Boolean   @default(true)
  billingCycle  BillingCycle? // recorrência (herdada do item/variante ou manual)
  
  @@map("proposal_items")
}

model ProposalComment {
  id            String    @id @default(uuid())
  proposalId    String
  proposal      Proposal  @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  content       String
  authorId      String?   // userId ou null para cliente
  authorName    String?   // nome do cliente se externo
  isInternal    Boolean   @default(false)
  createdAt     DateTime  @default(now())
}

// ============================================
// FINANCEIRO
// ============================================

model Invoice {
  id            String    @id @default(uuid())
  companyId     String
  number        Int
  prefix        String?   @default("FAT-")
  contactId     String
  contact       Contact   @relation(fields: [contactId], references: [id])
  proposalId    String?   @unique // origem (proposta que gerou) — @unique garante 1:1
  proposal      Proposal? @relation(fields: [proposalId], references: [id])
  projectId     String?   // projeto relacionado
  project       Project?  @relation(fields: [projectId], references: [id])
  
  // Valores
  subtotal      Decimal   @db.Decimal(15, 2) @default(0)
  discountPercent Decimal? @db.Decimal(5, 2)
  discountAmount Decimal?  @db.Decimal(15, 2)
  discountType  String?
  taxTotal      Decimal   @db.Decimal(15, 2) @default(0)
  adjustment    Decimal?  @db.Decimal(15, 2)
  total         Decimal   @db.Decimal(15, 2) @default(0)
  amountPaid    Decimal   @db.Decimal(15, 2) @default(0)
  amountDue     Decimal   @db.Decimal(15, 2) @default(0)
  currency      String    @default("BRL")
  
  // Datas
  date          DateTime  @default(now())
  dueDate       DateTime?
  
  // Status
  status        InvoiceStatus @default(DRAFT)
  sentAt        DateTime?
  paidAt        DateTime?
  
  // Recorrência
  isRecurring   Boolean   @default(false)
  recurringType String?   // month, year, week
  recurringEvery Int?     // 1, 3, 6, 12
  recurringCycles Int?    // 0 = infinito
  recurringCyclesDone Int? @default(0)
  recurringFromId String? // fatura original
  lastRecurringDate DateTime?
  
  // Hash para portal
  hash          String    @unique @default(uuid())
  
  // Endereços
  billingAddress Json?
  shippingAddress Json?
  
  // Notas
  terms         String?
  clientNote    String?
  internalNote  String?
  
  // Responsável
  assignedTo    String?
  createdBy     String
  
  items         InvoiceItem[]
  payments      Payment[]
  creditNotes   CreditNote[]
  activities    InvoiceActivity[]
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@unique([companyId, prefix, number])
  @@map("invoices")
}

enum InvoiceStatus {
  DRAFT
  SENT
  VIEWED
  PARTIAL
  PAID
  OVERDUE
  CANCELLED
}

model InvoiceItem {
  id            String    @id @default(uuid())
  invoiceId     String
  invoice       Invoice   @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  
  // Referência ao catálogo
  itemId        String?
  item          Item?     @relation(fields: [itemId], references: [id])
  variantId     String?
  variant       ItemVariant? @relation(fields: [variantId], references: [id])
  bundleId      String?
  bundle        ItemBundle? @relation(fields: [bundleId], references: [id])
  
  description   String
  longDescription String?
  quantity      Decimal   @db.Decimal(15, 4) @default(1)
  unit          String?
  rate          Decimal   @db.Decimal(15, 2)
  taxRate       Decimal?  @db.Decimal(5, 2)
  taxAmount     Decimal?  @db.Decimal(15, 2)
  discount      Decimal?  @db.Decimal(15, 2)
  total         Decimal   @db.Decimal(15, 2)
  sortOrder     Int       @default(0)
  billingCycle  BillingCycle?
  
  @@map("invoice_items")
}

model Payment {
  id              String    @id @default(uuid())
  companyId       String
  invoiceId       String
  invoice         Invoice   @relation(fields: [invoiceId], references: [id])
  amount          Decimal   @db.Decimal(15, 2)
  method          PaymentMethod
  date            DateTime  @default(now())
  
  // Gateway
  gateway         String?   // asaas, stripe, manual
  transactionId   String?   // ID externo do gateway
  gatewayFee      Decimal?  @db.Decimal(15, 2)
  externalStatus  String?   // status retornado pelo gateway
  webhookPayload  Json?     // payload bruto do webhook para auditoria
  
  // Status do pagamento
  status          PaymentStatus @default(PENDING)
  confirmedAt     DateTime?
  failedAt        DateTime?
  failedReason    String?
  
  // Estorno
  refundStatus    RefundStatus?
  refundAmount    Decimal?  @db.Decimal(15, 2)
  refundedAt      DateTime?
  refundReason    String?
  
  // Conciliação bancária
  reconciliationStatus ReconciliationStatus @default(PENDING)
  reconciledAt    DateTime?
  reconciledBy    String?   // userId que conciliou
  bankReference   String?   // referência bancária para match
  
  note            String?
  receiptFile     String?   // comprovante
  
  createdBy       String
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  @@map("payments")
}

enum PaymentStatus {
  PENDING
  CONFIRMED
  FAILED
  CANCELLED
  REFUNDED
  PARTIAL_REFUND
}

enum RefundStatus {
  REQUESTED
  PROCESSING
  COMPLETED
  FAILED
}

enum ReconciliationStatus {
  PENDING       // ainda não conciliado
  MATCHED       // match automático com extrato
  CONFIRMED     // conciliação confirmada manualmente
  DIVERGENT     // valor divergente do extrato
}

enum PaymentMethod {
  PIX
  BOLETO
  CREDIT_CARD
  DEBIT_CARD
  TRANSFER
  CASH
  OTHER
}

model CreditNote {
  id            String    @id @default(uuid())
  companyId     String
  number        Int
  contactId     String
  invoiceId     String?   // fatura original
  invoice       Invoice?  @relation(fields: [invoiceId], references: [id])
  amount        Decimal   @db.Decimal(15, 2)
  amountUsed    Decimal   @db.Decimal(15, 2) @default(0)
  amountRemaining Decimal @db.Decimal(15, 2)
  status        CreditNoteStatus @default(OPEN)
  reason        String?
  note          String?
  
  createdBy     String
  createdAt     DateTime  @default(now())
}

enum CreditNoteStatus {
  OPEN
  APPLIED
  VOID
}

// ── Gateway de Pagamento (modular) ──────────────────────────

model PaymentGatewayConfig {
  id              String    @id @default(uuid())
  companyId       String
  gateway         String    // 'asaas' | 'stripe' | 'manual'
  displayName     String    // nome exibido ao usuário ex: "Asaas Produção"
  active          Boolean   @default(true)
  sandbox         Boolean   @default(false)
  
  // Credenciais (criptografadas em runtime)
  credentials     Json      // { apiKey, webhookSecret, etc. } — criptografado
  
  // Configurações por método
  enabledMethods  PaymentMethod[] // métodos habilitados neste gateway
  minAmounts      Json?     // { PIX: 0, BOLETO: 10, CREDIT_CARD: 5 }
  maxInstallments Int?      @default(12) // máximo de parcelas cartão
  
  // Juros e multa padrão
  interestRate    Decimal?  @db.Decimal(5, 2) // % juros por mês após vencimento
  fineRate        Decimal?  @db.Decimal(5, 2) // % multa por atraso
  discountDays    Int?      // dias de antecipação para desconto
  discountRate    Decimal?  @db.Decimal(5, 2) // % desconto pontualidade
  
  // Webhook
  webhookUrl      String?   // URL gerada para este gateway receber callbacks
  webhookSecret   String?   // HMAC secret para validação
  ipWhitelist     String[]  // IPs autorizados para webhook
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  // Relações
  customers       GatewayCustomer[]
  webhookEvents   WebhookEvent[]
  
  @@unique([companyId, gateway, sandbox]) // uma config por gateway+ambiente por empresa
  @@map("payment_gateway_configs")
}

model GatewayCustomer {
  id              String    @id @default(uuid())
  companyId       String
  gatewayConfigId String
  gatewayConfig   PaymentGatewayConfig @relation(fields: [gatewayConfigId], references: [id])
  contactId       String
  contact         Contact   @relation(fields: [contactId], references: [id])
  
  externalId      String    // ID do cliente no gateway (ex: cus_xxxx no Asaas)
  externalData    Json?     // dados extras retornados pelo gateway
  
  syncedAt        DateTime  @default(now()) // última sincronização
  
  @@unique([gatewayConfigId, contactId]) // um registro por contato por gateway
  @@unique([gatewayConfigId, externalId]) // external ID único por gateway
  @@map("gateway_customers")
}

model WebhookEvent {
  id              String    @id @default(uuid())
  companyId       String
  gatewayConfigId String
  gatewayConfig   PaymentGatewayConfig @relation(fields: [gatewayConfigId], references: [id])
  
  gateway         String    // 'asaas' | 'stripe'
  gatewayEventId  String    // ID único do evento no gateway (idempotência)
  eventType       String    // 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', etc.
  
  payload         Json      // payload bruto completo
  
  status          WebhookEventStatus @default(RECEIVED)
  processedAt     DateTime?
  errorMessage    String?
  retryCount      Int       @default(0)
  
  // Referências opcionais ao que foi processado
  paymentId       String?
  invoiceId       String?
  
  receivedAt      DateTime  @default(now())
  
  @@unique([gateway, gatewayEventId]) // idempotência: nunca processa mesmo evento 2x
  @@index([companyId, gateway, eventType])
  @@map("webhook_events")
}

enum WebhookEventStatus {
  RECEIVED    // recebido, aguardando processamento
  PROCESSING  // em processamento
  PROCESSED   // processado com sucesso
  FAILED      // falhou ao processar
  IGNORED     // evento ignorado (tipo não tratado)
}

model Expense {
  id            String    @id @default(uuid())
  companyId     String
  name          String
  amount        Decimal   @db.Decimal(15, 2)
  categoryId    String?
  category      ExpenseCategory? @relation(fields: [categoryId], references: [id])
  contactId     String?   // cliente relacionado
  projectId     String?   // projeto relacionado
  date          DateTime
  paymentMethod PaymentMethod?
  currency      String    @default("BRL")
  taxRate       Decimal?  @db.Decimal(5, 2)
  note          String?
  receiptFile   String?   // comprovante
  
  // Faturável
  billable      Boolean   @default(false)
  invoiceId     String?   // fatura gerada
  billedAt      DateTime?
  
  // Recorrência
  isRecurring   Boolean   @default(false)
  recurringType String?
  recurringEvery Int?
  recurringCycles Int?
  recurringCyclesDone Int? @default(0)
  recurringFromId String?
  lastRecurringDate DateTime?
  
  createdBy     String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model ExpenseCategory {
  id            String    @id @default(uuid())
  companyId     String
  name          String
  color         String?
  expenses      Expense[]
}

// ============================================
// OPERAÇÃO
// ============================================

model Contract {
  id            String    @id @default(uuid())
  companyId     String
  number        Int
  prefix        String?   @default("CONT-")
  contactId     String
  contact       Contact   @relation(fields: [contactId], references: [id])
  proposalId    String?   // proposta que originou
  proposal      Proposal? @relation(fields: [proposalId], references: [id])
  title         String
  description   String?
  content       String?   // conteúdo do contrato (template)
  value         Decimal?  @db.Decimal(15, 2)
  typeId        String?
  
  // Datas
  startDate     DateTime
  endDate       DateTime?
  
  // Status
  status        ContractStatus @default(DRAFT)
  signedAt      DateTime?
  
  // Assinatura
  signatureFile String?
  signedByName  String?
  signedByEmail String?
  signedByIp    String?
  
  // Hash para acesso público
  hash          String    @unique @default(uuid())
  
  // Renovação
  renewals      ContractRenewal[]
  
  // Relações
  projects      Project[]
  tasks         Task[]
  activities    ContractActivity[]
  
  createdBy     String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@unique([companyId, prefix, number])
  @@map("contracts")
}

enum ContractStatus {
  DRAFT
  PENDING_SIGNATURE
  ACTIVE
  EXPIRING
  EXPIRED
  RENEWED
  CANCELLED
}

model ContractRenewal {
  id            String    @id @default(uuid())
  contractId    String
  contract      Contract  @relation(fields: [contractId], references: [id], onDelete: Cascade)
  oldStartDate  DateTime
  oldEndDate    DateTime?
  oldValue      Decimal?  @db.Decimal(15, 2)
  newStartDate  DateTime
  newEndDate    DateTime?
  newValue      Decimal?  @db.Decimal(15, 2)
  renewedBy     String
  renewedAt     DateTime  @default(now())
}

model Project {
  id            String    @id @default(uuid())
  companyId     String
  name          String
  description   String?
  contactId     String?   // cliente
  contact       Contact?  @relation(fields: [contactId], references: [id])
  contractId    String?   // contrato relacionado
  contract      Contract? @relation(fields: [contractId], references: [id])
  
  // Status
  status        ProjectStatus @default(NOT_STARTED)
  
  // Cobrança
  billingType   BillingType @default(FIXED)
  fixedCost     Decimal?  @db.Decimal(15, 2)
  hourlyRate    Decimal?  @db.Decimal(15, 2)
  
  // Progresso
  progressMode  String    @default("auto") // auto | manual
  progress      Int       @default(0) // 0-100
  
  // Datas
  startDate     DateTime?
  deadline      DateTime?
  completedAt   DateTime?
  
  // Membros (tabela relacional, seguindo padrão TeamMember do IMPA CRM)
  members       ProjectMember[]
  
  // Template
  templateId    String?
  
  milestones    Milestone[]
  tasks         Task[]
  invoices      Invoice[]  // faturas vinculadas ao projeto
  activities    ProjectActivity[]
  
  createdBy     String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@map("projects")
}

enum ProjectStatus {
  NOT_STARTED
  IN_PROGRESS
  ON_HOLD
  COMPLETED
  CANCELLED
}

enum BillingType {
  FIXED
  HOURLY
  FREE
}

model Milestone {
  id            String    @id @default(uuid())
  projectId     String
  project       Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name          String
  description   String?
  dueDate       DateTime?
  sortOrder     Int       @default(0)
  color         String?
  tasks         Task[]
  
  createdAt     DateTime  @default(now())
}

model Task {
  id            String    @id @default(uuid())
  companyId     String
  name          String
  description   String?
  
  // Status e prioridade
  status        TaskStatus @default(NOT_STARTED)
  priority      TaskPriority @default(MEDIUM)
  
  // FKs explícitas (sem relação polimórfica relationType/relationId)
  // Segue padrão do Card do IMPA CRM: contactId, conversationId como FK diretas
  projectId     String?
  project       Project?  @relation(fields: [projectId], references: [id])
  milestoneId   String?
  milestone     Milestone? @relation(fields: [milestoneId], references: [id])
  contractId    String?
  contract      Contract? @relation(fields: [contractId], references: [id])
  contactId     String?   // contato relacionado
  contact       Contact?  @relation("TaskContact", fields: [contactId], references: [id])
  conversationId String?  // conversa que originou a tarefa
  conversation  Conversation? @relation(fields: [conversationId], references: [id])
  opportunityId String?   // Card do pipeline (referência escalar — sem @relation)
  
  // Datas
  startDate     DateTime?
  dueDate       DateTime?
  completedAt   DateTime?
  
  // Assignees (tabela relacional, seguindo padrão TeamMember)
  assignees     TaskAssignee[]
  
  // Checklist
  checklist     Json?     // [{ id, text, completed }]
  
  // Time tracking
  timeTracked   Int       @default(0) // minutos
  
  // Recorrência
  isRecurring   Boolean   @default(false)
  recurringType String?
  recurringEvery Int?
  
  // Faturável
  billable      Boolean   @default(false)
  invoiceId     String?
  
  // Kanban
  kanbanOrder   Int       @default(0)
  
  // Visibilidade
  isPublic      Boolean   @default(true)
  
  createdBy     String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@map("tasks")
}

// Tabela relacional para membros de projeto (padrão TeamMember)
model ProjectMember {
  id          String    @id @default(uuid())
  projectId   String
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userId      String
  role        String?   // manager, member, viewer
  joinedAt    DateTime  @default(now())
  
  @@unique([projectId, userId])
  @@map("project_members")
}

// Tabela relacional para assignees de tarefa (padrão TeamMember)
model TaskAssignee {
  id          String    @id @default(uuid())
  taskId      String
  task        Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  userId      String
  assignedAt  DateTime  @default(now())
  
  @@unique([taskId, userId])
  @@map("task_assignees")
}

enum TaskStatus {
  NOT_STARTED
  IN_PROGRESS
  AWAITING_FEEDBACK
  COMPLETED
  CANCELLED
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}
```

### 5.2 Padrão Document Engine

Proposta, Fatura e Contrato compartilham comportamentos comuns que devem ser implementados como **serviços reutilizáveis** (não herança de modelo, não classe abstrata — funções puras ou classes utilitárias que cada módulo importa e usa):

| Comportamento | Descrição | Usado por |
|---------------|-----------|----------|
| **Numeração sequencial** | `{prefix}-{number}` por empresa, com `@@unique([companyId, prefix, number])` | Proposal, Invoice, Contract |
| **Hash público** | UUID único para acesso via link sem login | Proposal, Invoice, Contract |
| **PDF generation** | Geração de PDF a partir de template (Puppeteer ou similar) | Proposal, Invoice, Contract |
| **Envio via WhatsApp** | Envia link do documento na conversa do contato | Proposal, Invoice, Contract |
| **Tracking de visualização** | Registra quando o cliente abre o link (`viewedAt`) | Proposal, Invoice |
| **Assinatura eletrônica** | Captura assinatura, nome, email, IP | Proposal, Contract |
| **Activity por domínio** | Registra eventos (enviado, visto, aceito, etc.) | Todos |

Implementar como services no backend:
```
backend/src/core/documents/
├── numbering.service.ts    // gera número sequencial por empresa+tipo
├── hash.service.ts         // gera e valida hash público
├── pdf.service.ts          // gera PDF a partir de template
├── tracking.service.ts     // registra visualização via link
├── signature.service.ts    // captura assinatura eletrônica
└── whatsapp-send.service.ts // envia link do documento via WhatsApp
```

> **Regra arquitetural: numeração sequencial transacional**
> - A geração de número sequencial de Proposal, Invoice e Contract **deve ser transacional**
> - **Não pode** depender de "buscar último número e somar 1" — isso causa duplicatas em concorrência
> - Estratégia recomendada: tabela de contadores (`DocumentCounter`) por `companyId` + `documentType`, com `UPDATE ... SET number = number + 1 RETURNING number` dentro de transação Prisma (`$transaction`)
> - O `numbering.service.ts` deve encapsular esse controle de concorrência
> - Modelo auxiliar sugerido:
> ```prisma
> model DocumentCounter {
>   id           String @id @default(uuid())
>   companyId    String
>   documentType String // PROPOSAL, INVOICE, CONTRACT
>   prefix       String
>   lastNumber   Int    @default(0)
>   @@unique([companyId, documentType, prefix])
>   @@map("document_counters")
> }
> ```

### 5.3 Relações Principais

| De | Para | Tipo | Descrição |
|----|------|------|-----------|
| Contact | Organization | N:1 | Contato pertence a organização |
| Contact | LeadProfile | 1:1 | Contato tem perfil comercial (quando em qualificação) |
| Contact | CustomerAccountContact | 1:N | Contato participa de contas cliente (Contact.accountMemberships) |
| CustomerAccount | CustomerAccountContact | 1:N | Conta tem múltiplos contatos com papeis (CustomerAccount.members) |
| CustomerAccount | Organization | N:1 | Conta B2B pertence a organização |
| Contact | Card (Oportunidade) | 1:N | Contato tem oportunidades |
| Contact | Proposal | 1:N | Contato recebe propostas |
| Contact | Invoice | 1:N | Contato é faturado |
| Contact | Contract | 1:N | Contato tem contratos |
| Contact | Project | 1:N | Contato tem projetos |
| Contact | Conversation | 1:N | Contato tem conversas |
| Card | Proposal | 1:N | Oportunidade gera propostas (via relation "ProposalOpportunity") |
| Proposal | Invoice | 1:1 | Proposta vira fatura (Invoice.proposalId @unique) |
| Proposal | ProposalItem | 1:N | Proposta tem itens |
| ProposalItem | Item | N:1 | Item do catálogo (opcional) |
| ProposalItem | ItemVariant | N:1 | Variante específica (opcional) |
| ProposalItem | ItemBundle | N:1 | Bundle/combo (opcional) |
| Item | ItemCategory | N:1 | Item pertence a categoria |
| Item | ItemVariant | 1:N | Item tem variações (planos, tamanhos) |
| Item | ItemImage | 1:N | Item tem imagens |
| Item | ItemPriceTier | 1:N | Item tem faixas de preço por volume |
| ItemBundle | ItemBundleItem | 1:N | Bundle agrupa itens com desconto |
| ItemCategory | ItemCategory | 1:N | Categoria pai → subcategorias |
| Invoice | Payment | 1:N | Fatura recebe pagamentos |
| PaymentGatewayConfig | GatewayCustomer | 1:N | Gateway tem clientes mapeados |
| PaymentGatewayConfig | WebhookEvent | 1:N | Gateway recebe eventos de webhook |
| Contact | GatewayCustomer | 1:N | Contato mapeado em múltiplos gateways |
| Invoice | Proposal | 1:1 | Fatura originada da proposta (Invoice.proposalId @unique) |
| Invoice | Project | N:1 | Fatura vinculada ao projeto |
| Contract | Proposal | N:1 | Contrato originado da proposta |
| Project | Contact | N:1 | Projeto tem cliente |
| Task | Contact | N:1 | Tarefa vinculada a contato (relation explícita) |
| Task | Conversation | N:1 | Tarefa originada de conversa (relation explícita) |
| Invoice | CreditNote | 1:N | Fatura tem créditos |
| Invoice | InvoiceItem | 1:N | Fatura tem itens |
| Contract | Project | 1:N | Contrato gera projetos |
| Contract | ContractRenewal | 1:N | Contrato tem renovações |
| Project | Task | 1:N | Projeto tem tarefas |
| Project | Milestone | 1:N | Projeto tem marcos |
| Project | ProjectMember | 1:N | Projeto tem membros (relacional) |
| Task | Milestone | N:1 | Tarefa em milestone |
| Task | TaskAssignee | 1:N | Tarefa tem responsáveis (relacional) |
| Expense | ExpenseCategory | N:1 | Despesa tem categoria |
| Card | CardActivity | 1:N | Card/Oportunidade tem atividades |
| Proposal | ProposalActivity | 1:N | Proposta tem atividades |
| Invoice | InvoiceActivity | 1:N | Fatura tem atividades |
| Contract | ContractActivity | 1:N | Contrato tem atividades |
| Project | ProjectActivity | 1:N | Projeto tem atividades |
| Conversation | ConversationEvent | 1:N | Conversa tem eventos |

### 5.4 Back-Relations em Models Existentes do IMPA CRM

Os models abaixo **já existem** no schema real do IMPA CRM e precisam receber back-relations para as novas entidades desta proposta. As adições necessárias são:

```prisma
// Em model Card (já existe no schema real):
// Adicionar:
  proposals     Proposal[] @relation("ProposalOpportunity") // propostas vinculadas a esta oportunidade

// Em model Conversation (já existe no schema real):
// Adicionar:
  tasks         Task[]    // tarefas criadas a partir desta conversa
```

> **Nota**: Card e Conversation não são redefinidos nesta proposta porque já existem no schema. As linhas acima indicam apenas os campos que devem ser **adicionados** a eles durante a implementação.

> **Sobre `Project ↔ Invoice`**: A relação `Invoice.projectId` com `@relation` explícita é intencional — permite faturar um projeto diretamente. Project já contém `invoices Invoice[]` (back-relation implícita via `Invoice.project`). Não há back-relation extra a adicionar em Project.

> **Sobre `Task.opportunityId` e `Task.invoiceId`**: Ambos permanecem como **referências escalares** por decisão arquitetural (ver seção 5.6). Não possuem `@relation` nem back-relation.

### 5.5 Invariantes da CustomerAccount

Regras de integridade obrigatórias, validadas na camada de serviço (application layer):

**Para `AccountType = INDIVIDUAL` (B2C):**
- `organizationId` **deve ser null**
- Deve existir **exatamente 1** `CustomerAccountContact` com `isPrimary = true`
- Normalmente a conta terá apenas 1 contato, salvo regra futura específica

**Para `AccountType = BUSINESS` (B2B):**
- `organizationId` **é obrigatório** (não null)
- Deve existir **pelo menos 1** `CustomerAccountContact` com `isPrimary = true`
- Pode haver múltiplos contatos com papeis diferentes (BILLING, DECISION_MAKER, OPERATIONAL, MEMBER)

**Regra geral:**
- Só pode existir **um contato com `isPrimary = true`** por conta cliente
- Essa regra é obrigatória e deve ser validada:
  - No service de criação/atualização de `CustomerAccountContact`
  - Ao trocar o primário, o anterior perde `isPrimary`
- Não é possível deletar o único contato primário sem designar outro

> **Recomendação futura**: criar índice único parcial via migration SQL manual para blindar a regra no banco:
> ```sql
> CREATE UNIQUE INDEX uq_customer_account_primary
>   ON customer_account_contacts (customer_account_id)
>   WHERE is_primary = true;
> ```
> Prisma não suporta índices parciais nativamente, então isso deve ser feito em migration customizada. Até lá, a validação na camada de serviço é suficiente.

### 5.6 Convenção: Relation Explícita vs Referência Escalar

O schema desta proposta adota duas estratégias de referência entre entidades:

| Estratégia | Quando usar | Exemplo |
|-----------|-------------|----------|
| **Relation explícita** (`@relation`) | Relações muito usadas no fluxo operacional, que precisam de `include` no Prisma e integridade referencial no banco | `Task.contactId → Contact`, `Invoice.proposalId → Proposal` |
| **Referência escalar** (campo String sem `@relation`) | Referências a entidades mais sensíveis ou que causariam acoplamento excessivo entre módulos | `Task.opportunityId`, `Task.invoiceId`, `LeadProfile.opportunityId` |

> **Isso não é erro** — é decisão arquitetural intencional. `opportunityId` (Card) permanece escalar em Task e LeadProfile porque Card é entidade central do pipeline com muitas relações próprias. Criar back-relations em Card para cada novo consumidor geraria acoplamento excessivo. `invoiceId` em Task também permanece escalar — só é usado se a tarefa for faturável, e criar relation para esse caso raro aumentaria acoplamento sem benefício. A consulta é feita via `prisma.task.findMany({ where: { opportunityId } })` ou `{ where: { invoiceId } }` sem necessidade de `@relation`.

### 5.7 Regra de Snapshot dos Documentos

Regra fundamental para integridade comercial e financeira:

> Quando um item do catálogo entra em uma **Proposta** (`ProposalItem`) ou **Fatura** (`InvoiceItem`), ele vira uma **fotografia (snapshot)** daquele momento.

**Campos congelados no documento:**
- `description` — nome/descrição do item
- `longDescription` — descrição detalhada
- `rate` — preço unitário no momento
- `taxRate` / `taxAmount` — imposto aplicado
- `discount` — desconto concedido
- `billingCycle` — ciclo de cobrança
- `quantity`, `unit`, `total` — valores calculados

**Campos de referência ao catálogo (opcionais):**
- `itemId`, `variantId`, `bundleId` — mantidos para rastreabilidade, mas **não determinam os valores do documento**

**Regra:**
- Alterações futuras no catálogo (preço, descrição, impostos) **NÃO alteram** documentos já emitidos
- O service de criação de `ProposalItem` e `InvoiceItem` copia os valores do catálogo no momento da inserção
- Se o item for avulso (`itemId = null`), os campos são preenchidos manualmente

---

## 6. FLUXOS PRINCIPAIS

### 6.1 Contato → Lead → Oportunidade

```
1. Mensagem WhatsApp chega → cria/atualiza Contato
2. IA analisa conversa → detecta intenção comercial
3. Contato entra em fase de qualificação (Lead)
4. Qualificação: responsável confirma interesse, coleta dados, faz scoring
5. Qualificado? → Cria Card (Oportunidade) no pipeline de vendas
6. Card criado com: contactId, valor estimado, estágio "Novo"
7. Atribui responsável (round-robin ou regra de distribuição)
8. Notifica responsável
9. CardActivity: "Oportunidade criada a partir de conversa"
```

> **Distinção importante**: Lead é a fase de qualificação. Oportunidade (Card) só nasce quando há interesse confirmado com potencial de valor.

### 6.2 Lead → Proposta

```
1. Responsável conversa com lead via WhatsApp
2. Identifica necessidade → consulta catálogo de itens
3. IA pode sugerir itens com base na conversa (vetorização)
4. Cria Proposal com itens selecionados
5. Workflow de aprovação interna (opcional)
6. Envia proposta: email + link via WhatsApp
7. Tracking: marca como VIEWED quando cliente abre
8. Activity: "Proposta #123 enviada"
```

### 6.3 Proposta → Venda

```
1. Cliente acessa proposta via link
2. Pode comentar/solicitar ajustes → notifica staff via WhatsApp
3. Status muda: REVISED (se ajustada)
4. Cliente aceita → status: ACCEPTED
5. Assinatura eletrônica registrada
6. Opportunity: status → WON
7. Activity: "Proposta #123 aceita pelo cliente"
```

### 6.4 Venda → Cliente

```
1. Proposta aceita → Card status muda: OPEN → WON
2. Cria CustomerAccount para o contato (se não existir):
   a. CustomerAccount com dados de cobrança, endereço, taxId
   b. Status: ACTIVE
   c. firstPurchaseAt = now()
3. Automação pós-venda:
   a. Pode gerar Contrato automaticamente
   b. Pode gerar Projeto automaticamente (template)
   c. Pode gerar Fatura automaticamente
4. Mensagem WhatsApp automática: "Seja bem-vindo como cliente!"
5. CardActivity: "Oportunidade ganha — conta cliente criada"
```

### 6.5 Venda/Proposta → Fatura

```
1. Proposta aceita → botão "Gerar Fatura"
2. Itens da proposta são copiados para a fatura
3. Fatura criada com status: DRAFT
4. Staff revisa e envia
5. Envio: email + link de pagamento via WhatsApp
6. Tracking: marca como VIEWED
7. Se overdue: automação envia lembrete via WhatsApp
```

### 6.6 Fatura → Pagamento

```
1. Cliente paga via: Pix, boleto, cartão (Asaas/Stripe)
2. Gateway envia webhook → baixa automática
3. Payment registrado com transactionId
4. Invoice status atualiza: PAID ou PARTIAL
5. Notificação WhatsApp: "Pagamento confirmado! Obrigado."
6. Activity: "Pagamento de R$ X registrado via Pix"
7. Se recorrente: agenda próxima fatura
```

### 6.7 Contrato → Cliente

```
1. Proposta aceita → gera Contrato (opcional)
2. Contrato com dados do cliente, datas, valor
3. Envio via WhatsApp com link para assinatura
4. Cliente assina → status: ACTIVE
5. Alertas automáticos: 30/15/7 dias antes do vencimento
6. Renovação: gera novo período, mantém histórico
7. Activity: "Contrato assinado em DD/MM/YYYY"
```

### 6.8 Projeto/Tarefa → Pós-Venda

```
1. Venda fechada → cria Projeto (do template ou manual)
2. Projeto com milestones e tarefas predefinidas
3. Tarefas atribuídas à equipe
4. Progresso automático baseado em tarefas concluídas
5. Ao concluir milestone → notifica cliente via WhatsApp
6. Ao concluir projeto → notifica cliente + solicita feedback
7. Activity: "Projeto concluído em DD/MM/YYYY"
```

### 6.9 Conversa ↔ CRM (Hub Comercial)

```
1. Cada conversa WhatsApp vincula ao Contato
2. Sidebar do chat mostra contexto completo:
   → Conta Cliente (status, total gasto, plano)
   → Oportunidades abertas (Cards no pipeline)
   → Propostas enviadas/pendentes
   → Faturas abertas/vencidas
   → Contratos ativos
   → Projetos em andamento
   → Últimas atividades
3. Ações rápidas: "Qualificar Lead", "Criar Oportunidade", "Criar Tarefa", "Enviar Proposta"
4. De qualquer entidade: botão "Enviar via WhatsApp"
5. IA age no contexto: conhece o catálogo, histórico comercial e perfil
6. Tudo bidirecional: CRM ← → Conversas
7. Chat é o ponto central de operação comercial no IMPA CRM
```

### 6.10 IA Comercial nos Fluxos

```
Classificação  → Conversa chega → IA classifica: comercial/suporte/spam
Qualificação   → Se comercial → cria LeadProfile com dados extraídos
Catálogo IA    → Catálogo inteiro vetorizado no Qdrant (pitch + benefits + features + FAQ)
Busca          → Cliente pergunta sobre produto → tool search_catalog → resposta precisa
Recomendação   → IA analisa contexto da conversa → sugere itens + variantes + bundles
Preço          → Cliente pergunta preço → IA consulta variantes + tiers de volume
Cross-sell     → "Pra esse perfil, o pacote X sai melhor que comprar separado"
Upsell         → "Se subir pro Plano Pro, ganha suporte prioritário"
Proposta       → IA monta proposta completa com itens + variantes + cálculos
Payment Link   → IA gera link de pagamento e envia direto no WhatsApp
Scoring        → IA calcula lead score com base em: conversa + perfil + engajamento
Follow-up      → IA sugere quando fazer follow-up + com qual abordagem
```

**Tools da IA Comercial (function calling):**
```
search_catalog(query, filters?)     → busca semântica no Qdrant
get_item_details(itemId)            → detalhes + variantes + preços + tiers
calculate_price(items[], quantities[]) → calcula com volume + combo
recommend_items(conversationId)     → recomendação baseada no contexto
generate_quote(contactId, items[])  → cria proposta automaticamente
send_payment_link(contactId, item)  → gera e envia link de pagamento
```

---

## 7. PRIORIDADE DE IMPLEMENTAÇÃO

### Fase 1 — Fundação Comercial (Alta Prioridade)

**Objetivo**: Ciclo comercial básico funcionando integrado com conversas.

| # | Feature | Dependência | Impacto |
|---|---------|-------------|---------|
| 1 | **Timeline/Activity por domínio** | CORE (CardActivity já existe) | Alto — rastreabilidade desde o início |
| 2 | **Contatos/Organizações aprimorados** | CORE já existe | Alto — base de tudo |
| 3 | **Conta Cliente (CustomerAccount)** | Contatos | Alto — relação comercial ativa |
| 4 | **Catálogo de Produtos/Serviços** | Nenhuma | Alto — cérebro da IA comercial |
| 5 | **Propostas unificadas (Proposal + Estimate)** | Catálogo, Contatos | Alto — documento comercial |
| 6 | **Pipeline/Oportunidades (Card)** | Motor Kanban já existe | Alto — gestão visual do comercial |
| 7 | **Document Engine** | Propostas | Alto — serviços reutilizáveis (PDF, hash, envio) |

### Fase 2 — Financeiro Operacional

**Objetivo**: Faturamento e controle financeiro básico.

| # | Feature | Dependência | Impacto |
|---|---------|-------------|---------|
| 8 | **Faturas** | Contatos, Itens | Alto — cobrança |
| 9 | **Pagamentos** | Faturas | Alto — receita |
| 10 | **Integração Asaas/Stripe** | Pagamentos | Alto — automação financeira |
| 11 | **Despesas** | Nenhuma | Médio — controle de custos |
| 12 | **Envio via WhatsApp** | Conversas, Faturas, Propostas | Alto — diferencial |
| 13 | **Relatórios básicos** (vendas, financeiro) | Faturas, Pagamentos | Médio — visibilidade |

### Fase 3 — Operação e Pós-Venda

**Objetivo**: Gestão de entregas e satisfação.

| # | Feature | Dependência | Impacto |
|---|---------|-------------|---------|
| 14 | **Contratos** | Contatos, Propostas | Médio — formalização |
| 15 | **Projetos** | Contatos | Médio — gestão de entrega |
| 16 | **Tarefas com checklist** | Projetos (opcional) | Médio — operação |
| 17 | **Templates de projeto** | Projetos | Baixo — produtividade |
| 18 | **Notas de crédito** | Faturas | Baixo — estorno |
| 19 | **Faturas recorrentes** | Faturas | Médio — SaaS/assinaturas |

### Fase 4 — IA Comercial e Avançado

**Objetivo**: Diferenciação com IA e automação inteligente.

| # | Feature | Dependência | Impacto |
|---|---------|-------------|---------|
| 20 | **Vetorização do catálogo no Qdrant** | Catálogo, IA provider | Alto — cérebro da IA |
| 21 | **Tools da IA comercial** | Vetorização, Catálogo | Alto — search_catalog, calculate_price |
| 22 | **Lead scoring com IA** | Oportunidades, IA | Alto — eficiência comercial |
| 23 | **Geração de proposta por IA** | Propostas, Catálogo, IA | Alto — produtividade |
| 24 | **Automações comerciais avançadas** | Automações, Propostas, Faturas | Alto — escala |
| 25 | **Relatórios avançados** (IA, conversão, produtividade) | Relatórios básicos | Médio — inteligência |
| 26 | **Módulos de nicho** | Toda a base | Variável — expansão |

---

## 8. LISTA DO QUE VALE A PENA REPRODUZIR PRIMEIRO

> **Nota**: Esta lista está ordenada por **impacto estratégico** no produto final, não pela sequência prática de implementação. Para a ordem de execução real, ver a **Seção 10 — MVP REAL**.

### Prioridade por impacto estratégico:

1. **Catálogo completo de Produtos/Serviços** — categorias hierárquicas, variações, preço por volume, combos/bundles, texto comercial, imagens — o cérebro da IA comercial
2. **Vetorização do catálogo no Qdrant** — indexar pitch + benefits + features + FAQ via pipeline RAG existente — habilita toda a IA comercial
3. **Proposta com itens do catálogo + variações + bundles** — documento comercial completo gerado automaticamente
4. **Document Engine** (numeração, hash, PDF, tracking) — serviços reutilizáveis para Proposta/Fatura/Contrato
5. **Fatura com pagamentos parciais + payment links** — ciclo financeiro real
6. **Conta Cliente (CustomerAccount)** — centraliza relação comercial/financeira
7. **Oportunidade como Card no pipeline** — gestão visual do comercial (já existe base)
8. **Tools da IA comercial** — search_catalog, calculate_price, recommend_items, generate_quote, send_payment_link
9. **Activity por domínio** — estender padrão CardActivity para Proposta/Fatura/Contrato/Projeto
10. **Contratos com renovação** — formalização comercial

---

## 9. ALERTAS IMPORTANTES

### O que NÃO copiar literalmente

| Área | Por quê |
|------|---------|
| **tblclients como empresa** | No Perfex, cliente = empresa. No IMPA, separar Contato, Organização e Conta Cliente |
| **Lead como tabela separada** | Duplica dados ao converter. Lead é fase de qualificação, Oportunidade é Card no pipeline |
| **Tickets** | O IMPA tem conversas WhatsApp — tickets são obsoletos nesse contexto |
| **Sistema de módulos do Perfex** | São plugins PHP. O IMPA usa módulos nativos controlados por empresa |
| **Gateways internacionais** | Focar em Pix, Boleto, Asaas para o mercado brasileiro |
| **Frontend jQuery/Bootstrap** | O IMPA usa React/Tailwind — redesenhar completamente |
| **CodeIgniter helpers** | Reescrever como services Node.js com TypeScript |
| **Serialização de permissões** | O IMPA já tem RBAC relacional — não serializar |

### Convenções a manter do IMPA CRM

| Convenção | Razão |
|-----------|-------|
| **`companyId` como tenant ID** | Usado consistentemente em TODAS as ~40+ tabelas existentes. Renomear para `workspaceId` seria mudança destrutiva sem benefício. Para empresas dos clientes, usar `Organization` |
| **Activity por domínio** | `CardActivity`, `ConversationEvent`, `AuditLog` já existem como tabelas separadas. Seguir esse padrão para novos domínios (ProposalActivity, InvoiceActivity, etc.) |
| **Tabelas relacionais** | `TeamMember`, `ConversationParticipant`, `CardTag` já usam tabelas relacionais. Seguir para `ProjectMember`, `TaskAssignee` — nunca `String[]` para relações |
| **Vetorização no Qdrant** | `AIKnowledgeChunk` já usa Qdrant para embeddings. Items do catálogo devem seguir o mesmo padrão — nunca `embedding Float[]` no Prisma |
| **Card como Oportunidade** | O modelo `Card` com `Pipeline`/`Stage` já existe e funciona. Usar Card com pipeline tipo SALES, não criar modelo `Opportunity` separado |
| **@@map()** | Usar `@@map("nome_tabela")` em todos os novos models para nomes consistentes no PostgreSQL |

### O que está datado no Perfex

- UI baseada em jQuery e Bootstrap 3
- PHP com CodeIgniter 3 (sem TypeScript, sem tipos)
- Kanban implementado ad-hoc para cada módulo
- Email como canal principal (sem WhatsApp)
- IA básica (apenas "polir texto" com OpenAI)
- PDF via TCPDF (pode ser modernizado com Puppeteer ou similar)
- Sem websockets para atualizações em tempo real
- Sem API REST documentada (tudo server-side rendered)

### O que precisa ser modernizado

- **Kanban**: de implementação por módulo → motor universal reutilizável
- **PDF**: de TCPDF → Puppeteer ou React-PDF (templates modernos)
- **Notificações**: de email → WhatsApp + push + in-app
- **Permissões**: de serialized array → RBAC relacional (já feito)
- **Busca**: de SQL LIKE → full-text search + busca vetorial
- **Real-time**: de polling → WebSocket (já existe no IMPA)
- **API**: de server-side → REST API documentada (Swagger)

### O que pode ser simplificado

- **Proposta + Orçamento**: unificar em uma entidade com `type`
- **Nota de crédito**: simplificar como "ajuste financeiro" no MVP
- **Multi-moeda**: começar com BRL, expandir depois
- **Gantt chart**: trocar por Kanban + timeline simples
- **Timesheet avançado**: focar em time tracking básico por tarefa

### O que pode virar diferencial no IMPA CRM

1. **Catálogo como cérebro da IA comercial** — categorias, variações, combos, preço por volume, texto comercial estruturado — tudo vetorizado no Qdrant para a IA responder, recomendar e vender
2. **WhatsApp como canal principal** — enviar propostas, faturas, contratos, catálogo visual e payment links via WhatsApp
3. **IA vendedora** — busca semântica no catálogo, recomendação inteligente, cross-sell/upsell, geração automática de propostas com itens + variantes + cálculos
4. **Chat como hub comercial** — sidebar mostra contexto completo: conta cliente, oportunidades, propostas, faturas, contratos
5. **Payment links integrados** — IA gera link de pagamento do item/variante e envia direto no chat
6. **Automações no pipeline** — mover card dispara ações automáticas
7. **Templates de projeto** — criar projetos padronizados a partir de venda
8. **Notificações inteligentes** — avisos de expiração, vencimento, follow-up via WhatsApp
9. **Multi-tenant com módulos** — cada empresa ativa apenas o que precisa
10. **Bundles/Combos inteligentes** — IA sugere pacotes ideais com desconto automático baseado no perfil do cliente

---

## 10. MVP REAL — Primeira Entrega Utilizável

A menor combinação de módulos para colocar **o ciclo comercial funcionando em produção**, organizada em 4 etapas incrementais:

### Etapa 1 — Fundação (base comercial)

> **Resultado**: Contato → Qualificação (LeadProfile) → Oportunidade (Card no pipeline) → Conta Cliente

| Módulo | O que entra | Observação |
|--------|-------------|------------|
| **Contatos aprimorados** | Contact + Organization + LeadProfile | Base de tudo, já tem estrutura existente |
| **CustomerAccount** | CustomerAccount + CustomerAccountContact | Regra de criação automática (WON/ACCEPTED/1ª fatura) |
| **Pipeline/Oportunidades** | Card como Oportunidade (motor Kanban já existe) | Apenas configurar pipeline tipo SALES |
| **Activity por domínio** | CardActivity já existe; criar ProposalActivity, InvoiceActivity | Rastreabilidade desde o início |

### Etapa 2 — Ciclo documental

> **Resultado**: Gerar proposta com itens, converter em fatura, registrar pagamento

| Módulo | O que entra | Observação |
|--------|-------------|------------|
| **Catálogo básico** | Item, ItemCategory, ItemVariant, ProposalItem, InvoiceItem | Sem Bundle, PriceTier, imagens múltiplas, conteúdo comercial expandido ou vetorização Qdrant nesta fase |
| **Propostas** | Proposal + ProposalComment | type: PROPOSAL ou ESTIMATE |
| **Faturas** | Invoice + Payment | Pagamentos parciais, gateway Asaas/Stripe |
| **Gateway Modular** | PaymentGatewayConfig, GatewayCustomer, WebhookEvent | Asaas como primeiro gateway; Manual para pagamentos offline; interface plugável (ver §3.7.1) |
| **Document Engine** | numbering, hash, PDF, tracking, envio WhatsApp | Serviços reutilizáveis para Proposta/Fatura/Contrato |

### Etapa 3 — Operação e pós-venda

> **Resultado**: Contratos, projetos e tarefas operacionais

| Módulo | O que entra | Observação |
|--------|-------------|------------|
| **Contratos** | Contract + ContractRenewal + ContractActivity | Com assinatura eletrônica e Document Engine |
| **Projetos** | Project + Milestone + ProjectMember + ProjectActivity | Templates de projeto a partir de venda |
| **Tarefas** | Task + TaskAssignee | Checklist, time tracking, Kanban |
| **Despesas** | Expense + ExpenseCategory | Faturáveis e recorrentes |
| **Notas de crédito** | CreditNote | Simplificado como "ajuste financeiro" nesta fase |
| **Relatórios** | Vendas, financeiro, pipeline, produtividade | Dashboards básicos |

### Etapa 4 — IA Comercial e Catálogo Completo

> **Resultado**: IA vendedora inteligente + catálogo com toda a profundidade

| Módulo | O que entra | Observação |
|--------|-------------|------------|
| **Catálogo completo** | ItemBundle, ItemBundleItem, ItemPriceTier, ItemImage (múltiplas) | Combos, preço por volume, galeria |
| **Conteúdo comercial** | pitch, benefits, features, FAQ, useCases por item | Base textual para vetorização |
| **Vetorização Qdrant** | Catálogo inteiro indexado no Qdrant via pipeline RAG | search_catalog, recommend_items |
| **Tools IA comerciais** | calculate_price, generate_quote, send_payment_link | Function calling integrado ao chat |
| **Lead scoring IA** | Score automático por conversa + perfil + engajamento | Priorização inteligente |
| **Automações avançadas** | Triggers comerciais: follow-up, cross-sell, upsell | Motor de automação + IA |

> **Critério de pronto por etapa**: cada etapa deve ser **utilizável em produção** de forma independente. Etapa 1 + 2 = MVP comercial mínimo. Etapa 3 = operação. Etapa 4 = diferenciação com IA.

---

## CONCLUSÃO

O Perfex CRM é uma referência valiosa como **motor comercial-financeiro-operacional maduro**. Seus principais conceitos — catálogo de itens, propostas com assinatura, faturas com pagamentos parciais, contratos com renovação, projetos com milestones, tarefas polimórficas — são sólidos e devem ser absorvidos pelo IMPA CRM.

Porém, o IMPA CRM não deve ser um clone modernizado do Perfex. Ele deve ser um **produto autoral** que:

1. **Supera** o Perfex na integração com WhatsApp (canal principal de comunicação)
2. **Supera** o Perfex na IA comercial (catálogo vetorizado, scoring, automação inteligente)
3. **Supera** o Perfex nas automações (motor de pipeline universal com triggers)
4. **Supera** o Perfex na arquitetura (Node.js, React, Prisma, PostgreSQL, TypeScript)
5. **Supera** o Perfex na modularidade (módulos por nicho controlados por empresa)

A estratégia é: **absorver a lógica de produto do Perfex**, **redesenhar a arquitetura para o contexto moderno do IMPA**, e **criar diferenciais impossíveis de reproduzir em um CRM PHP tradicional**.
