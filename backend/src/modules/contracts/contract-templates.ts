// ── Modelos de Contrato Nativos ──────────────────────────────────
// Merge fields disponíveis:
// {{CONTRATANTE_NOME}}, {{CONTRATANTE_DOCUMENTO}}, {{CONTRATANTE_ENDERECO}}, {{CONTRATANTE_EMAIL}}
// {{CONTRATADA_NOME}}, {{CONTRATADA_DOCUMENTO}}, {{CONTRATADA_ENDERECO}}, {{CONTRATADA_EMAIL}}
// {{VALOR}}, {{VALOR_EXTENSO}}, {{DATA_INICIO}}, {{DATA_FIM}}, {{PRAZO_DIAS}}
// {{OBJETO}}, {{CIDADE}}, {{DATA_ATUAL}}

export interface ContractTemplate {
  id: string
  name: string
  category: string
  description: string
  icon: string
  content: string
}

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: 'servico-avulso',
    name: 'Prestação de Serviços Avulso',
    category: 'Serviços',
    description: 'Serviço fechado com escopo, prazo e valor definido. Ideal para projetos pontuais como criação de sites, automações, design, configuração de CRM.',
    icon: '🔧',
    content: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}, e-mail {{CONTRATANTE_EMAIL}}.

CONTRATADA: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}, e-mail {{CONTRATADA_EMAIL}}.

As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Prestação de Serviços, que se regerá pelas cláusulas seguintes e pelas condições de preço, forma e termos descritos.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem como objeto a prestação dos seguintes serviços: {{OBJETO}}.

CLÁUSULA 2ª — DO PRAZO
O prazo de execução dos serviços será de {{DATA_INICIO}} a {{DATA_FIM}}, podendo ser prorrogado mediante acordo por escrito entre as partes.

CLÁUSULA 3ª — DO VALOR E FORMA DE PAGAMENTO
Pela execução dos serviços descritos na Cláusula 1ª, a CONTRATANTE pagará à CONTRATADA o valor total de R$ {{VALOR}}.
O pagamento será realizado conforme condições acordadas entre as partes.

CLÁUSULA 4ª — DAS OBRIGAÇÕES DA CONTRATADA
a) Executar os serviços conforme especificações acordadas;
b) Manter sigilo sobre informações confidenciais do CONTRATANTE;
c) Comunicar imediatamente qualquer impedimento na execução dos serviços;
d) Entregar os serviços dentro do prazo estipulado.

CLÁUSULA 5ª — DAS OBRIGAÇÕES DO CONTRATANTE
a) Fornecer todas as informações e materiais necessários para execução dos serviços;
b) Efetuar os pagamentos nas datas acordadas;
c) Realizar as aprovações necessárias dentro dos prazos estabelecidos.

CLÁUSULA 6ª — DA RESCISÃO
O presente contrato poderá ser rescindido:
a) Por mútuo acordo entre as partes, mediante comunicação por escrito;
b) Por inadimplemento de qualquer cláusula, mediante notificação prévia de 15 (quinze) dias;
c) Pela conclusão dos serviços contratados.

CLÁUSULA 7ª — DA PROPRIEDADE INTELECTUAL
Os produtos e materiais desenvolvidos durante a execução dos serviços serão de propriedade do CONTRATANTE após a quitação integral do valor contratado.

CLÁUSULA 8ª — DO FORO
As partes elegem o foro da comarca de {{CIDADE}} para dirimir quaisquer dúvidas oriundas do presente contrato.

E, por estarem assim justos e contratados, firmam o presente instrumento em duas vias de igual teor e forma, na presença de duas testemunhas.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONTRATADA`,
  },
  {
    id: 'servico-recorrente',
    name: 'Prestação de Serviços Recorrente',
    category: 'Serviços',
    description: 'Para serviços com mensalidade contínua: suporte técnico, gestão de tráfego, social media, manutenção, CRM e automações.',
    icon: '🔄',
    content: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS CONTINUADOS

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}, e-mail {{CONTRATANTE_EMAIL}}.

CONTRATADA: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}, e-mail {{CONTRATADA_EMAIL}}.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem como objeto a prestação continuada dos seguintes serviços: {{OBJETO}}.

CLÁUSULA 2ª — DA VIGÊNCIA
O presente contrato terá vigência de {{DATA_INICIO}} a {{DATA_FIM}}, renovando-se automaticamente por períodos iguais e sucessivos, salvo manifestação contrária de qualquer das partes com antecedência mínima de 30 (trinta) dias.

CLÁUSULA 3ª — DO VALOR E PAGAMENTO
Pela prestação dos serviços, a CONTRATANTE pagará à CONTRATADA o valor mensal de R$ {{VALOR}}, com vencimento todo dia 10 (dez) de cada mês.
O atraso no pagamento implicará em multa de 2% (dois por cento) sobre o valor da parcela, acrescido de juros de mora de 1% (um por cento) ao mês.

CLÁUSULA 4ª — DO ESCOPO DOS SERVIÇOS
Os serviços incluídos neste contrato compreendem:
a) [Descrever serviços incluídos]
b) [Descrever limites e quantidade]
c) [Descrever canais de atendimento]

Parágrafo único: Serviços não previstos neste contrato serão orçados separadamente.

CLÁUSULA 5ª — DO NÍVEL DE SERVIÇO (SLA)
a) Tempo de resposta: até 24 horas úteis para chamados normais;
b) Tempo de resposta: até 4 horas para chamados urgentes;
c) Disponibilidade mínima: 99% do tempo (quando aplicável a sistemas).

CLÁUSULA 6ª — DAS OBRIGAÇÕES DA CONTRATADA
a) Executar os serviços com qualidade e dentro dos prazos acordados;
b) Manter equipe técnica qualificada para atendimento;
c) Comunicar preventivamente qualquer situação que possa afetar a prestação dos serviços;
d) Manter sigilo absoluto sobre dados e informações do CONTRATANTE.

CLÁUSULA 7ª — DAS OBRIGAÇÕES DO CONTRATANTE
a) Efetuar os pagamentos pontualmente;
b) Fornecer acessos e informações necessárias;
c) Designar responsável para comunicação e aprovações.

CLÁUSULA 8ª — DO REAJUSTE
O valor mensal poderá ser reajustado anualmente, com base no IGPM/FGV ou índice equivalente, mediante comunicação prévia de 30 (trinta) dias.

CLÁUSULA 9ª — DA RESCISÃO
O contrato poderá ser rescindido:
a) Por qualquer das partes, mediante aviso prévio de 30 (trinta) dias;
b) Por inadimplemento, após notificação de 15 (quinze) dias sem regularização;
c) Por acordo mútuo entre as partes.

Parágrafo único: Em caso de rescisão antecipada pelo CONTRATANTE sem justa causa, será devida multa de 20% sobre o valor restante do contrato.

CLÁUSULA 10ª — DO FORO
Elegem as partes o foro da comarca de {{CIDADE}} para dirimir quaisquer questões.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONTRATADA`,
  },
  {
    id: 'licenca-saas',
    name: 'Licença de Uso de Software / SaaS',
    category: 'Tecnologia',
    description: 'Para acesso a plataformas, sistemas, CRM, chatflow e ferramentas. Cobre limites de uso, suspensão, cancelamento e responsabilidades.',
    icon: '💻',
    content: `CONTRATO DE LICENÇA DE USO DE SOFTWARE / SaaS

LICENCIANTE: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}, e-mail {{CONTRATADA_EMAIL}}.

LICENCIADO: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}, e-mail {{CONTRATANTE_EMAIL}}.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem como objeto a concessão de licença de uso não exclusiva do software/plataforma denominada "{{OBJETO}}", na modalidade SaaS (Software as a Service), incluindo acesso via internet, suporte técnico e atualizações.

CLÁUSULA 2ª — DA VIGÊNCIA
O acesso à plataforma será disponibilizado a partir de {{DATA_INICIO}}, com vigência até {{DATA_FIM}}, renovando-se automaticamente por períodos iguais salvo manifestação em contrário com 30 dias de antecedência.

CLÁUSULA 3ª — DO VALOR E PAGAMENTO
Pelo uso da plataforma, o LICENCIADO pagará o valor mensal de R$ {{VALOR}}.
O não pagamento por prazo superior a 10 (dez) dias acarretará a suspensão temporária do acesso.
O não pagamento por prazo superior a 30 (trinta) dias acarretará o cancelamento do acesso e possível exclusão dos dados.

CLÁUSULA 4ª — DOS LIMITES DE USO
a) O plano contratado inclui: [descrever limites — usuários, contatos, armazenamento, etc.];
b) A utilização acima dos limites poderá gerar cobrança adicional;
c) O LICENCIADO não poderá sublicenciar, copiar, modificar ou fazer engenharia reversa do software.

CLÁUSULA 5ª — DA DISPONIBILIDADE E SUPORTE
a) Disponibilidade mínima da plataforma: 99,5% mensal;
b) Manutenções programadas serão comunicadas com antecedência mínima de 48 horas;
c) Suporte técnico disponível por chat/e-mail em horário comercial.

CLÁUSULA 6ª — DAS ATUALIZAÇÕES
A LICENCIANTE poderá realizar atualizações e melhorias na plataforma sem aviso prévio, desde que não reduzam funcionalidades já contratadas.

CLÁUSULA 7ª — DA PROTEÇÃO DE DADOS
a) A LICENCIANTE se compromete a tratar os dados do LICENCIADO em conformidade com a LGPD (Lei 13.709/2018);
b) Os dados inseridos pelo LICENCIADO na plataforma são de propriedade exclusiva do LICENCIADO;
c) Em caso de encerramento do contrato, os dados serão disponibilizados para exportação pelo prazo de 30 dias.

CLÁUSULA 8ª — DA RESPONSABILIDADE DO LICENCIADO
a) Manter suas credenciais de acesso em sigilo;
b) Não utilizar a plataforma para atividades ilegais ou que violem direitos de terceiros;
c) Responsabilizar-se pelo conteúdo inserido na plataforma.

CLÁUSULA 9ª — DA SUSPENSÃO E CANCELAMENTO
A LICENCIANTE poderá suspender o acesso em caso de:
a) Inadimplência superior a 10 dias;
b) Uso indevido ou que comprometa a integridade da plataforma;
c) Violação dos termos deste contrato.

CLÁUSULA 10ª — DA RESCISÃO
O contrato poderá ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias, sem multa.

CLÁUSULA 11ª — DO FORO
As partes elegem o foro da comarca de {{CIDADE}}.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
LICENCIADO

_______________________________
{{CONTRATADA_NOME}}
LICENCIANTE`,
  },
  {
    id: 'implementacao-onboarding',
    name: 'Implementação / Onboarding / Setup',
    category: 'Serviços',
    description: 'Taxa inicial de implantação separada da mensalidade. Ideal para implantação de CRM, integrações, configuração de automações.',
    icon: '🚀',
    content: `CONTRATO DE IMPLEMENTAÇÃO E ONBOARDING

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}, e-mail {{CONTRATANTE_EMAIL}}.

CONTRATADA: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}, e-mail {{CONTRATADA_EMAIL}}.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem como objeto a prestação de serviços de implementação, configuração e onboarding de: {{OBJETO}}.

CLÁUSULA 2ª — DO ESCOPO DA IMPLEMENTAÇÃO
A implementação compreenderá as seguintes etapas:

Etapa 1 — Levantamento e Planejamento
• Reunião de kickoff e definição de requisitos
• Mapeamento de processos existentes
• Cronograma de implementação

Etapa 2 — Configuração e Integração
• Configuração da plataforma conforme requisitos levantados
• Integração com sistemas existentes (WhatsApp, e-mail, etc.)
• Configuração de automações e fluxos

Etapa 3 — Migração de Dados
• Importação de dados existentes (contatos, histórico, etc.)
• Validação e limpeza de dados

Etapa 4 — Treinamento
• Treinamento da equipe operacional
• Documentação de processos
• Material de apoio

Etapa 5 — Go-Live e Acompanhamento
• Acompanhamento das primeiras semanas de operação
• Ajustes finos conforme feedback

CLÁUSULA 3ª — DO PRAZO
O prazo estimado para conclusão da implementação é de {{DATA_INICIO}} a {{DATA_FIM}}.
Atrasos causados pela falta de fornecimento de informações ou acessos pelo CONTRATANTE não serão imputados à CONTRATADA.

CLÁUSULA 4ª — DO VALOR E PAGAMENTO
O valor total da implementação é de R$ {{VALOR}}, conforme condições:
• 50% na assinatura deste contrato;
• 50% na conclusão da implementação.

CLÁUSULA 5ª — DAS OBRIGAÇÕES DO CONTRATANTE
a) Designar responsável para acompanhar a implementação;
b) Fornecer acessos, dados e informações necessárias em até 5 dias úteis;
c) Participar das reuniões de alinhamento;
d) Validar e aprovar cada etapa concluída.

CLÁUSULA 6ª — DAS OBRIGAÇÕES DA CONTRATADA
a) Executar a implementação conforme escopo definido;
b) Manter comunicação transparente sobre o andamento;
c) Fornecer documentação de tudo que foi configurado;
d) Oferecer suporte durante o período de acompanhamento pós go-live.

CLÁUSULA 7ª — DA MUDANÇA DE ESCOPO
Qualquer alteração no escopo original deverá ser formalizada por aditivo contratual, com nova estimativa de prazo e valor.

CLÁUSULA 8ª — DA RESCISÃO
Em caso de rescisão pelo CONTRATANTE antes da conclusão, serão devidos os valores correspondentes às etapas já executadas.

CLÁUSULA 9ª — DO FORO
As partes elegem o foro da comarca de {{CIDADE}}.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONTRATADA`,
  },
  {
    id: 'suporte-manutencao',
    name: 'Suporte e Manutenção',
    category: 'Serviços',
    description: 'Para quem vende suporte técnico sem desenvolvimento contínuo. Cobre atendimento, resolução de problemas e manutenção preventiva.',
    icon: '🛠️',
    content: `CONTRATO DE SUPORTE TÉCNICO E MANUTENÇÃO

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}, e-mail {{CONTRATANTE_EMAIL}}.

CONTRATADA: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}, e-mail {{CONTRATADA_EMAIL}}.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem como objeto a prestação de serviços de suporte técnico e manutenção para: {{OBJETO}}.

CLÁUSULA 2ª — DA VIGÊNCIA
Vigência de {{DATA_INICIO}} a {{DATA_FIM}}, com renovação automática por períodos iguais.

CLÁUSULA 3ª — DO VALOR
O valor mensal do suporte é R$ {{VALOR}}, com vencimento todo dia 10 de cada mês.

CLÁUSULA 4ª — DO ESCOPO DO SUPORTE
O suporte técnico compreende:
a) Atendimento para dúvidas operacionais;
b) Diagnóstico e resolução de problemas técnicos;
c) Manutenção preventiva (atualizações, backups, monitoramento);
d) Manutenção corretiva (correção de bugs e falhas);
e) Pequenos ajustes de configuração.

Parágrafo 1º — NÃO estão incluídos neste contrato:
a) Desenvolvimento de novas funcionalidades;
b) Redesign ou reformulação de sistemas;
c) Migração para novas plataformas;
d) Suporte para problemas causados por terceiros.

CLÁUSULA 5ª — DO ATENDIMENTO
a) Canais: chat, e-mail e telefone;
b) Horário: segunda a sexta, das 9h às 18h;
c) SLA de primeira resposta: até 4 horas úteis;
d) SLA de resolução: até 48 horas úteis para problemas críticos;
e) Limite de chamados: [definir] chamados por mês.

Parágrafo único: Chamados excedentes serão cobrados à parte no valor de R$ [definir] por chamado.

CLÁUSULA 6ª — DA MANUTENÇÃO PREVENTIVA
a) Atualizações de segurança serão aplicadas mensalmente;
b) Backups serão realizados conforme política acordada;
c) Monitoramento de disponibilidade quando aplicável.

CLÁUSULA 7ª — DA RESCISÃO
Mediante aviso prévio de 30 dias por qualquer das partes.

CLÁUSULA 8ª — DO FORO
Foro da comarca de {{CIDADE}}.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONTRATADA`,
  },
  {
    id: 'desenvolvimento-sob-demanda',
    name: 'Desenvolvimento Sob Demanda',
    category: 'Tecnologia',
    description: 'Para projetos técnicos maiores: sistemas personalizados, módulos, integrações, APIs. Com escopo fechado, horas, entregas por fase e aprovação por etapa.',
    icon: '⚙️',
    content: `CONTRATO DE DESENVOLVIMENTO DE SOFTWARE SOB DEMANDA

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}, e-mail {{CONTRATANTE_EMAIL}}.

CONTRATADA: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}, e-mail {{CONTRATADA_EMAIL}}.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem como objeto o desenvolvimento de: {{OBJETO}}.

CLÁUSULA 2ª — DO ESCOPO E ENTREGAS
O desenvolvimento será realizado conforme o escopo técnico detalhado no Anexo I deste contrato, dividido nas seguintes fases:

Fase 1 — Análise e Especificação
• Levantamento detalhado de requisitos
• Documento de especificação técnica
• Prototipação/wireframes
• Prazo estimado: [definir] dias úteis

Fase 2 — Desenvolvimento
• Codificação conforme especificações aprovadas
• Testes unitários e de integração
• Prazo estimado: [definir] dias úteis

Fase 3 — Testes e Homologação
• Disponibilização em ambiente de homologação
• Período de testes pelo CONTRATANTE: [definir] dias úteis
• Correção de bugs identificados

Fase 4 — Implantação e Go-Live
• Deploy em ambiente de produção
• Monitoramento pós-implantação por [definir] dias

CLÁUSULA 3ª — DO PRAZO
Prazo total estimado: de {{DATA_INICIO}} a {{DATA_FIM}}.
Cada fase será considerada concluída após aprovação formal do CONTRATANTE.

CLÁUSULA 4ª — DAS HORAS PREVISTAS
O projeto está estimado em [definir] horas de desenvolvimento.
Horas excedentes ao escopo original serão cobradas à parte no valor de R$ [definir]/hora.

CLÁUSULA 5ª — DO VALOR E PAGAMENTO
O valor total do desenvolvimento é de R$ {{VALOR}}, pago conforme o cronograma:
• [definir]% na aprovação do escopo (Fase 1);
• [definir]% no início do desenvolvimento (Fase 2);
• [definir]% na entrega para homologação (Fase 3);
• [definir]% no go-live (Fase 4).

CLÁUSULA 6ª — DA APROVAÇÃO POR ETAPA
Cada fase deverá ser formalmente aprovada pelo CONTRATANTE em até 5 (cinco) dias úteis após a entrega. A falta de manifestação no prazo será considerada como aprovação tácita.

CLÁUSULA 7ª — DA MUDANÇA DE ESCOPO
Qualquer alteração nas funcionalidades, requisitos ou especificações após a aprovação do escopo original será objeto de aditivo contratual, com reavaliação de prazo e custo.

CLÁUSULA 8ª — DA PROPRIEDADE INTELECTUAL
a) O código-fonte desenvolvido será de propriedade do CONTRATANTE após quitação integral;
b) Bibliotecas e frameworks de terceiros mantêm suas respectivas licenças;
c) A CONTRATADA poderá reutilizar componentes genéricos em outros projetos.

CLÁUSULA 9ª — DA GARANTIA
A CONTRATADA oferece garantia de 90 (noventa) dias após o go-live para correção de bugs relacionados ao escopo contratado, sem custo adicional.

CLÁUSULA 10ª — DA RESCISÃO
Em caso de rescisão, serão devidos os valores proporcionais às fases já executadas e aprovadas.

CLÁUSULA 11ª — DO FORO
Foro da comarca de {{CIDADE}}.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONTRATADA`,
  },
  {
    id: 'consultoria-mentoria',
    name: 'Consultoria / Mentoria / Acompanhamento',
    category: 'Consultoria',
    description: 'Para venda de conhecimento: mentoria, consultoria comercial, de automação, acompanhamento operacional e reuniões estratégicas.',
    icon: '🎓',
    content: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE CONSULTORIA

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}, e-mail {{CONTRATANTE_EMAIL}}.

CONSULTOR(A): {{CONTRATADA_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com endereço em {{CONTRATADA_ENDERECO}}, e-mail {{CONTRATADA_EMAIL}}.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem como objeto a prestação de serviços de consultoria/mentoria na área de: {{OBJETO}}.

CLÁUSULA 2ª — DA MODALIDADE E FORMATO
Os serviços serão prestados na seguinte modalidade:
a) Reuniões individuais de [definir] minutos, com frequência [semanal/quinzenal/mensal];
b) Acompanhamento assíncrono via [WhatsApp/e-mail/plataforma];
c) Análise de indicadores e relatórios;
d) Total de [definir] sessões no período contratado.

CLÁUSULA 3ª — DA VIGÊNCIA
O contrato terá vigência de {{DATA_INICIO}} a {{DATA_FIM}}.

CLÁUSULA 4ª — DO VALOR E PAGAMENTO
O valor total da consultoria é de R$ {{VALOR}}, podendo ser pago:
a) À vista, com [definir]% de desconto; ou
b) Em [definir] parcelas de R$ [definir].

CLÁUSULA 5ª — DAS OBRIGAÇÕES DO CONSULTOR
a) Realizar as sessões nos horários acordados;
b) Fornecer orientações baseadas em conhecimento técnico e experiência;
c) Manter sigilo sobre informações estratégicas do CONTRATANTE;
d) Disponibilizar materiais de apoio quando pertinente.

CLÁUSULA 6ª — DAS OBRIGAÇÕES DO CONTRATANTE
a) Comparecer às sessões agendadas (cancelamentos com 24h de antecedência);
b) Fornecer informações verdadeiras sobre o negócio;
c) Implementar as ações acordadas;
d) Efetuar os pagamentos pontualmente.

Parágrafo único: Sessões não comparecidas sem aviso prévio serão consideradas realizadas.

CLÁUSULA 7ª — DA LIMITAÇÃO DE RESPONSABILIDADE
O CONSULTOR oferece orientações e recomendações, não garantindo resultados específicos, uma vez que a implementação depende exclusivamente do CONTRATANTE.

CLÁUSULA 8ª — DA CONFIDENCIALIDADE
Ambas as partes se comprometem a manter sigilo sobre informações confidenciais compartilhadas durante a consultoria, inclusive após o término deste contrato.

CLÁUSULA 9ª — DA RESCISÃO
O contrato poderá ser rescindido mediante aviso prévio de 15 (quinze) dias. Sessões já realizadas serão cobradas proporcionalmente.

CLÁUSULA 10ª — DO FORO
Foro da comarca de {{CIDADE}}.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONSULTOR(A)`,
  },
  {
    id: 'nda-confidencialidade',
    name: 'NDA / Termo de Confidencialidade',
    category: 'Jurídico',
    description: 'Acordo de não divulgação para projetos técnicos, software, agências e consultorias. Protege informações sensíveis de ambas as partes.',
    icon: '🔒',
    content: `ACORDO DE CONFIDENCIALIDADE E NÃO DIVULGAÇÃO (NDA)

PARTE REVELADORA: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}.

PARTE RECEPTORA: {{CONTRATADA_NOME}}, inscrita no CPF/CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com endereço em {{CONTRATADA_ENDERECO}}.

CONSIDERANDO que as partes desejam trocar informações confidenciais para fins de: {{OBJETO}}, resolvem celebrar o presente acordo nos seguintes termos:

CLÁUSULA 1ª — DA DEFINIÇÃO DE INFORMAÇÃO CONFIDENCIAL
Para os fins deste acordo, considera-se "Informação Confidencial" toda e qualquer informação, verbal ou escrita, incluindo mas não se limitando a:
a) Dados comerciais, financeiros e estratégicos;
b) Código-fonte, algoritmos e especificações técnicas;
c) Listas de clientes, fornecedores e parceiros;
d) Metodologias, processos e know-how;
e) Dados pessoais de colaboradores e clientes;
f) Qualquer informação expressamente identificada como confidencial.

CLÁUSULA 2ª — DAS OBRIGAÇÕES
A PARTE RECEPTORA se obriga a:
a) Manter absoluto sigilo sobre as Informações Confidenciais;
b) Utilizar as informações exclusivamente para a finalidade descrita;
c) Não divulgar, reproduzir ou transferir as informações a terceiros;
d) Limitar o acesso apenas a colaboradores que necessitem conhecê-las;
e) Adotar medidas de segurança adequadas para proteger as informações;
f) Devolver ou destruir todas as informações ao término do acordo.

CLÁUSULA 3ª — DAS EXCEÇÕES
Não serão consideradas confidenciais as informações que:
a) Já eram de domínio público antes da divulgação;
b) Tornaram-se públicas sem culpa da PARTE RECEPTORA;
c) Foram legalmente obtidas de terceiros sem obrigação de sigilo;
d) Foram desenvolvidas independentemente pela PARTE RECEPTORA;
e) Devam ser divulgadas por determinação legal ou judicial.

CLÁUSULA 4ª — DA VIGÊNCIA
Este acordo vigorará por prazo indeterminado, permanecendo em vigor mesmo após o encerramento do relacionamento comercial entre as partes, pelo período mínimo de 5 (cinco) anos.

CLÁUSULA 5ª — DAS PENALIDADES
A violação deste acordo sujeitará a PARTE RECEPTORA ao pagamento de indenização por perdas e danos, sem prejuízo das sanções civis e penais cabíveis.

CLÁUSULA 6ª — DO FORO
Foro da comarca de {{CIDADE}}.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
PARTE REVELADORA

_______________________________
{{CONTRATADA_NOME}}
PARTE RECEPTORA`,
  },
  {
    id: 'aditivo-contratual',
    name: 'Aditivo Contratual',
    category: 'Jurídico',
    description: 'Para alterar contratos existentes sem criar um novo: mudar valor, prazo, escopo, adicionar serviço ou renovar.',
    icon: '📎',
    content: `TERMO ADITIVO AO CONTRATO Nº [NÚMERO DO CONTRATO ORIGINAL]

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}.

CONTRATADA: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}.

Pelo presente instrumento, as partes acima qualificadas, signatárias do Contrato de [tipo do contrato], firmado em [data do contrato original], resolvem aditar o referido contrato conforme cláusulas a seguir:

CLÁUSULA 1ª — DO OBJETO DO ADITIVO
O presente aditivo tem como finalidade: {{OBJETO}}.

CLÁUSULA 2ª — DAS ALTERAÇÕES

[Opção A — Alteração de Valor]
Fica alterado o valor mensal/total do contrato de R$ [valor anterior] para R$ {{VALOR}}, a partir de {{DATA_INICIO}}.

[Opção B — Alteração de Prazo]
Fica prorrogado o prazo do contrato até {{DATA_FIM}}, mantendo-se todas as demais condições.

[Opção C — Alteração de Escopo]
Ficam incluídos/excluídos os seguintes serviços:
a) [Descrever inclusões]
b) [Descrever exclusões]

[Opção D — Combinação]
[Descrever todas as alterações necessárias]

CLÁUSULA 3ª — DA RATIFICAÇÃO
Permanecem inalteradas e ratificadas todas as demais cláusulas e condições do contrato original que não foram expressamente modificadas por este aditivo.

CLÁUSULA 4ª — DA VIGÊNCIA DO ADITIVO
Este aditivo entra em vigor na data de sua assinatura.

E, por estarem de acordo, firmam o presente em duas vias de igual teor.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONTRATADA`,
  },
  {
    id: 'distrato-encerramento',
    name: 'Distrato / Encerramento Contratual',
    category: 'Jurídico',
    description: 'Para formalizar cancelamento e encerramento de contrato de forma profissional, com quitação e obrigações remanescentes.',
    icon: '📋',
    content: `TERMO DE DISTRATO E ENCERRAMENTO CONTRATUAL

CONTRATANTE: {{CONTRATANTE_NOME}}, inscrito(a) no CPF/CNPJ sob o nº {{CONTRATANTE_DOCUMENTO}}, com endereço em {{CONTRATANTE_ENDERECO}}.

CONTRATADA: {{CONTRATADA_NOME}}, inscrita no CNPJ sob o nº {{CONTRATADA_DOCUMENTO}}, com sede em {{CONTRATADA_ENDERECO}}.

Pelo presente instrumento, as partes acima qualificadas resolvem, de comum acordo, distratar o Contrato de [tipo do contrato], nº [número], firmado em [data de assinatura], nos seguintes termos:

CLÁUSULA 1ª — DO ENCERRAMENTO
As partes declaram encerrado o contrato mencionado a partir de {{DATA_FIM}}, cessando todas as obrigações dele decorrentes, ressalvadas as disposições previstas neste distrato.

CLÁUSULA 2ª — DA QUITAÇÃO FINANCEIRA
[Opção A — Sem pendências]
As partes declaram que não há valores pendentes de pagamento, dando-se mútua e recíproca quitação.

[Opção B — Com pendências]
O CONTRATANTE pagará à CONTRATADA o valor remanescente de R$ {{VALOR}}, referente a [especificar], até a data de {{DATA_INICIO}}.

CLÁUSULA 3ª — DAS OBRIGAÇÕES REMANESCENTES
a) A CONTRATADA entregará todos os materiais, acessos e documentos até [definir] dias após a assinatura deste distrato;
b) Ambas as partes manterão sigilo sobre informações confidenciais conforme cláusula de confidencialidade do contrato original;
c) A CONTRATADA disponibilizará os dados do CONTRATANTE para exportação pelo prazo de 30 (trinta) dias.

CLÁUSULA 4ª — DA DEVOLUÇÃO DE MATERIAIS E ACESSOS
a) Credenciais e acessos a sistemas serão revogados em até [definir] dias;
b) Documentos e materiais do CONTRATANTE serão devolvidos integralmente;
c) Backups e cópias serão eliminados em até 30 (trinta) dias.

CLÁUSULA 5ª — DA RENÚNCIA
As partes renunciam expressamente a quaisquer direitos, ações, reclamações ou pretensões que possam ter em relação ao contrato distratado, ressalvadas as obrigações previstas neste instrumento.

CLÁUSULA 6ª — DO FORO
Foro da comarca de {{CIDADE}}.

{{CIDADE}}, {{DATA_ATUAL}}.

_______________________________
{{CONTRATANTE_NOME}}
CONTRATANTE

_______________________________
{{CONTRATADA_NOME}}
CONTRATADA

Testemunhas:
1. Nome: _________________ CPF: _________________
2. Nome: _________________ CPF: _________________`,
  },
]
