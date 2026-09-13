# Oikos — Documento Técnico de Arquitetura

Sistema de controle financeiro pessoal. Nome derivado do grego "oikos" (raiz de "economia" / "administração da casa").

Stack: React + TypeScript (front), Node.js + TypeScript (back), PostgreSQL via pgAdmin 4 (local) e Neon (produção). Deploy: Vercel (front) e Render (back). Repositórios separados no GitHub.

---

## 1. Princípios de arquitetura (não negociáveis)

1. **Nenhuma regra financeira no frontend.** O React envia intenção (`{description, amount, installments, paymentMethod}`), o backend decide o resultado.
2. **Saldo e limite não são campos mutáveis.** São valores derivados por consulta agregada sobre a tabela de lançamentos (modelo de razão contábil). Um campo `balance` atualizado por `UPDATE` a cada transação cria risco de deriva de dado em concorrência e impossibilita auditoria retroativa. Saldo "atual" pode ser cacheado em uma view materializada por performance, mas nunca é a fonte de verdade.
3. **Valores monetários em inteiro (centavos).** Colunas `amount_cents INTEGER`, nunca `FLOAT`. Motivo adicional ao erro de ponto flutuante: o driver `pg` retorna colunas `NUMERIC` como `string` em JavaScript, exigindo parsing manual em toda leitura. Trabalhar em centavos como inteiro elimina as duas fontes de erro.
4. **Datas de domínio financeiro usam `DATE`, não `TIMESTAMPTZ`.** Data de compra, vencimento e fechamento não têm componente de hora; usar `TIMESTAMPTZ` nelas introduz bug de fuso horário sem necessidade. `TIMESTAMPTZ` fica restrito a `created_at`/`updated_at` de auditoria.
5. **Usuário existe desde a primeira migration.** Toda tabela financeira carrega `user_id`, mesmo com um único usuário hoje. Isso evita reescrever o modelo quando o sistema passar a ser multiusuário (V5).
6. **Frontend nunca acessa o banco diretamente.** Toda leitura e escrita passa por API HTTP autenticada.
7. **Ambiente local e produção são bancos fisicamente separados** (`oikos_dev` local via pgAdmin 4, `oikos_prod` no Neon), sem overlap de credenciais.

---

## 2. Arquitetura geral

```
GitHub
├── oikos-front   (React + TypeScript + Vite)
└── oikos-back    (Node.js + TypeScript + PostgreSQL)

Produção:
Vercel (front) ──HTTP/JSON──> Render (back) ──SQL──> Neon (PostgreSQL)

Desenvolvimento:
localhost:5173 (Vite) ──HTTP/JSON──> localhost:3000 (Node) ──SQL──> Postgres local ──> pgAdmin 4
```

Fluxo de camadas no backend:

```
Requisição HTTP
   ↓
Middleware (auth, validação)
   ↓
Controller (recebe request, chama service, formata response)
   ↓
Service (regra de negócio: cálculo de parcela, atribuição de fatura, saldo)
   ↓
Repository (única camada que fala SQL)
   ↓
PostgreSQL
```

---

## 3. Estrutura de pastas — Frontend (`oikos-front`)

```
oikos-front/
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── ui/            # botões, inputs, modais genéricos
│   │   ├── layout/         # sidebar, header, shell responsivo
│   │   └── feedback/       # toasts, loading, empty states
│   ├── contexts/
│   │   ├── AuthContext.tsx
│   │   └── ThemeContext.tsx
│   ├── modules/
│   │   ├── dashboard/
│   │   ├── entradas/
│   │   ├── despesas/
│   │   ├── contas/
│   │   ├── cartoes/
│   │   ├── faturas/
│   │   ├── categorias/
│   │   ├── transferencias/
│   │   ├── relatorios/
│   │   ├── orcamentos/      # V4
│   │   ├── metas/           # V4
│   │   └── configuracoes/
│   ├── services/
│   │   ├── api.ts           # instância HTTP (fetch/axios) com interceptor de token
│   │   └── auth.ts
│   ├── hooks/
│   ├── types/
│   ├── utils/
│   │   └── currency.ts      # formatação de centavos → R$, nunca cálculo aqui
│   ├── routes/
│   │   └── AppRoutes.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── .env / .env.example
├── vite.config.ts
├── vercel.json
└── package.json
```

Cada módulo replica o padrão:

```
modules/despesas/
├── components/
│   ├── DespesaForm.tsx
│   ├── DespesaList.tsx
│   └── DespesaFilters.tsx
├── hooks/useDespesas.ts
├── services/despesasService.ts
├── types/despesa.types.ts
└── despesas.tsx
```

`Context` fica restrito a `AuthContext` e `ThemeContext`. Estado de módulo (lista de despesas, filtros) vive em hooks/serviços locais, não em Context global — evita re-render em cascata e acoplamento desnecessário entre módulos.

---

## 4. Estrutura de pastas — Backend (`oikos-back`)

```
oikos-back/
├── src/
│   ├── config/
│   │   ├── database.ts
│   │   └── env.ts
│   ├── middlewares/
│   │   ├── auth.ts
│   │   └── errorHandler.ts
│   ├── errors/
│   ├── utils/
│   │   └── money.ts          # conversão centavos ↔ exibição, nunca aritmética de ponto flutuante
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── accounts/
│   │   ├── categories/
│   │   ├── income-entries/
│   │   ├── expenses/
│   │   ├── credit-cards/
│   │   ├── purchases/
│   │   ├── installments/
│   │   ├── invoices/
│   │   ├── transfers/
│   │   ├── reports/
│   │   ├── budgets/           # V4
│   │   └── goals/             # V4
│   ├── app.ts
│   └── server.ts
├── tests/
├── migrations/
├── .env / .env.example
└── package.json
```

Cada módulo:

```
modules/purchases/
├── purchases.controller.ts
├── purchases.service.ts
├── purchases.repository.ts
├── purchases.routes.ts
└── purchases.schema.ts        # validação Zod
```

**Decisão em aberto — framework HTTP:** Fastify tem melhor performance e schema-validation nativa via Zod/TypeBox; Express tem mais material didático e comunidade maior. Para um projeto solo em aprendizado, Express reduz atrito inicial; para o objetivo de portfólio técnico, Fastify demonstra domínio de ferramenta mais atual. Recomendo Fastify, mas a escolha não altera a estrutura de módulos acima.

**Decisão em aberto — migrations:** pgAdmin 4 sozinho não versiona schema. Recomendo `node-pg-migrate` (SQL puro, sem ORM, compatível com o fluxo pg/pgAdmin que você já usa) para ter histórico de alterações versionado no Git, mesmo inspecionando o resultado no pgAdmin depois.

---

## 5. Modelo de dados

### 5.1 Diagrama de entidades

```
users
  │
  ├── accounts ──────────┐
  ├── categories         │
  ├── credit_cards       │
  │      │               │
  │      └── invoices    │
  │             │        │
  │      purchases       │
  │             │        │
  │      installments ───┤ (installment.invoice_id)
  ├── income_entries ────┤ (account_id)
  ├── expenses ──────────┤ (account_id)
  ├── transfers ─────────┤ (from_account_id / to_account_id)
  └── invoice_payments ──┘ (account_id / invoice_id)
```

### 5.2 Tabelas — V1 (núcleo)

**users**
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| name | TEXT | |
| email | TEXT UNIQUE | |
| password_hash | TEXT | bcrypt |
| created_at / updated_at | TIMESTAMPTZ | |

**accounts**
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users | |
| name | TEXT | ex: "Nubank" |
| bank_name | TEXT | |
| type | ENUM(checking, savings, cash) | |
| initial_balance_cents | INTEGER | ponto de partida do saldo, não o saldo atual |
| status | ENUM(active, archived) | |
| created_at / updated_at | TIMESTAMPTZ | |

**categories**
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK NULLABLE | NULL = categoria padrão do sistema |
| name | TEXT | |
| type | ENUM(income, expense) | impede categoria de entrada ser usada em despesa e vice-versa |
| icon | TEXT | |
| created_at | TIMESTAMPTZ | |

**income_entries** (entradas)
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | |
| account_id | UUID FK → accounts | |
| category_id | UUID FK → categories | |
| description | TEXT | |
| amount_cents | INTEGER | |
| entry_date | DATE | |
| created_at | TIMESTAMPTZ | |

**expenses** (despesas pagas direto da conta: débito, dinheiro, PIX)
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | |
| account_id | UUID FK → accounts | |
| category_id | UUID FK → categories | |
| description | TEXT | |
| amount_cents | INTEGER | |
| payment_method | ENUM(debit, cash, pix) | compra em crédito NÃO entra aqui, vai para `purchases` |
| expense_date | DATE | |
| created_at | TIMESTAMPTZ | |

**transfers**
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | |
| from_account_id | UUID FK → accounts | |
| to_account_id | UUID FK → accounts | |
| amount_cents | INTEGER | |
| transfer_date | DATE | |
| description | TEXT | |
| created_at | TIMESTAMPTZ | |

Regra de cálculo de saldo de conta (query, não coluna):

```sql
saldo(account_id) =
  initial_balance_cents
  + SUM(income_entries.amount_cents WHERE account_id = X)
  - SUM(expenses.amount_cents WHERE account_id = X)
  - SUM(transfers.amount_cents WHERE from_account_id = X)
  + SUM(transfers.amount_cents WHERE to_account_id = X)
  - SUM(invoice_payments.amount_cents WHERE account_id = X)
```

### 5.3 Tabelas — V2 (cartão de crédito)

**credit_cards**
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | |
| name | TEXT | |
| brand | TEXT | |
| credit_limit_cents | INTEGER | |
| closing_day | SMALLINT (1-31) | dia de fechamento da fatura |
| due_day | SMALLINT (1-31) | dia de vencimento |
| status | ENUM(active, archived) | |
| created_at / updated_at | TIMESTAMPTZ | |

**purchases** (compra no cartão, à vista ou parcelada)
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | |
| credit_card_id | UUID FK → credit_cards | |
| category_id | UUID FK → categories | |
| description | TEXT | |
| total_amount_cents | INTEGER | |
| installments_count | SMALLINT | 1 = à vista |
| purchase_date | DATE | |
| created_at | TIMESTAMPTZ | |

**invoices** (fatura)
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| credit_card_id | UUID FK → credit_cards | |
| reference_month | DATE | primeiro dia do mês de referência (ex: 2026-09-01) |
| closing_date | DATE | |
| due_date | DATE | |
| status | ENUM(open, closed, paid, overdue) | |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE(credit_card_id, reference_month) |

**installments** (parcela)
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| purchase_id | UUID FK → purchases | |
| invoice_id | UUID FK → invoices | definido pela regra de atribuição (5.4) |
| installment_number | SMALLINT | 1 de N |
| amount_cents | INTEGER | total_amount_cents dividido por N, resto ajustado na última parcela |
| created_at | TIMESTAMPTZ | |

**invoice_payments** (pagamento de fatura)
| Coluna | Tipo | Observação |
|---|---|---|
| id | UUID PK | |
| invoice_id | UUID FK → invoices | |
| account_id | UUID FK → accounts | de onde saiu o dinheiro |
| amount_cents | INTEGER | |
| payment_date | DATE | |
| created_at | TIMESTAMPTZ | |

Regra de cálculo de limite disponível (query, não coluna):

```sql
limite_utilizado(credit_card_id) =
  SUM(installments.amount_cents)
  JOIN invoices ON installments.invoice_id = invoices.id
  WHERE invoices.credit_card_id = X AND invoices.status != 'paid'

limite_disponivel = credit_limit_cents - limite_utilizado
```

### 5.4 Regra de atribuição de fatura (ponto crítico do sistema)

Uma compra não entra automaticamente na fatura do mês calendário em que foi feita. Ela entra na fatura cujo ciclo ainda não fechou:

```
SE dia(purchase_date) <= closing_day do cartão
  ENTÃO a compra entra na fatura cujo reference_month = mês da compra
SENÃO
  a compra entra na fatura cujo reference_month = mês seguinte
```

Exemplo: cartão com fechamento dia 25. Compra em 20/08 entra na fatura de agosto. Compra em 27/08 entra na fatura de setembro, mesmo sendo feita em agosto.

Cada parcela subsequente (parcela 2, 3...) recebe `reference_month` incrementado em um mês a partir da fatura da parcela 1. A criação da compra deve, na mesma transação de banco, gerar as N linhas de `installments` e as faturas correspondentes (criando a fatura se ainda não existir para aquele mês).

### 5.5 Tabelas — V4 (avançado)

**budgets**
| Coluna | Tipo |
|---|---|
| id | UUID PK |
| user_id | UUID FK |
| category_id | UUID FK |
| reference_month | DATE |
| limit_amount_cents | INTEGER |

**financial_goals**
| Coluna | Tipo |
|---|---|
| id | UUID PK |
| user_id | UUID FK |
| name | TEXT |
| target_amount_cents | INTEGER |
| target_date | DATE |
| created_at | TIMESTAMPTZ |

`current_amount_cents` de uma meta não é campo próprio: é calculado a partir de entradas marcadas com uma categoria/tag vinculada à meta, ou de aportes registrados em uma tabela auxiliar `goal_contributions` (a definir na Fase 15).

---

## 6. Telas do sistema

| # | Módulo | Tela | Versão |
|---|---|---|---|
| 1 | Auth | Login | V1 |
| 2 | Auth | Cadastro de usuário | V1 (interno) / V5 (público) |
| 3 | Auth | Recuperação de senha | V5 |
| 4 | Dashboard | Visão geral (cards + gráficos) | V1 (esqueleto) / V3 (completo) |
| 5 | Contas | Lista de contas bancárias | V1 |
| 6 | Contas | Formulário de conta (criar/editar) | V1 |
| 7 | Contas | Extrato da conta (filtro por período/categoria) | V1 |
| 8 | Categorias | Lista e gestão de categorias | V1 |
| 9 | Entradas | Lista de entradas | V1 |
| 10 | Entradas | Formulário de entrada | V1 |
| 11 | Despesas | Lista de despesas | V1 |
| 12 | Despesas | Formulário de despesa (com forma de pagamento) | V1 |
| 13 | Transferências | Lista de transferências | V1 |
| 14 | Transferências | Formulário de transferência | V1 |
| 15 | Cartões | Lista de cartões de crédito | V2 |
| 16 | Cartões | Formulário de cartão (limite, dias de fechamento/vencimento) | V2 |
| 17 | Cartões | Detalhe do cartão (limite usado/disponível, histórico) | V2 |
| 18 | Faturas | Lista de faturas do cartão | V2 |
| 19 | Faturas | Detalhe da fatura (itens, status, pagar fatura) | V2 |
| 20 | Relatórios | Gastos por categoria | V3 |
| 21 | Relatórios | Evolução mensal | V3 |
| 22 | Relatórios | Comparativo entre meses | V3 |
| 23 | Orçamentos | Lista de orçamentos por categoria | V4 |
| 24 | Orçamentos | Formulário de orçamento | V4 |
| 25 | Metas | Lista de metas financeiras | V4 |
| 26 | Metas | Formulário de meta / aporte | V4 |
| 27 | Configurações | Perfil do usuário | V1 |
| 28 | Configurações | Preferências (tema) | V1 |
| 29 | Configurações | Segurança (troca de senha) | V1 |

Total: 29 telas distribuídas em 5 versões. V1 concentra 16 telas (núcleo funcional sem cartão), o que é consistente com a decisão de adiar dashboard e cartão para depois do fluxo básico de conta corrente estar validado.

---

## 7. API — rotas por módulo

```
POST   /api/auth/login
POST   /api/auth/register

GET    /api/accounts
POST   /api/accounts
GET    /api/accounts/:id
PUT    /api/accounts/:id
DELETE /api/accounts/:id
GET    /api/accounts/:id/balance
GET    /api/accounts/:id/statement        (extrato filtrado)

GET    /api/categories
POST   /api/categories

GET    /api/income-entries
POST   /api/income-entries
PUT    /api/income-entries/:id
DELETE /api/income-entries/:id

GET    /api/expenses
POST   /api/expenses
PUT    /api/expenses/:id
DELETE /api/expenses/:id

GET    /api/transfers
POST   /api/transfers

GET    /api/credit-cards
POST   /api/credit-cards
GET    /api/credit-cards/:id
GET    /api/credit-cards/:id/available-limit

POST   /api/purchases                     (cria compra + installments + invoices)

GET    /api/invoices?credit_card_id=
GET    /api/invoices/:id
POST   /api/invoices/:id/pay

GET    /api/reports/by-category?month=
GET    /api/reports/monthly-evolution
GET    /api/reports/comparison

GET    /api/dashboard/summary
```

---

## 8. Segurança

- Autenticação: JWT (access token curto, 15-30 min) + refresh token (armazenado em cookie httpOnly).
- Senha: bcrypt, custo mínimo 10.
- Toda rota exceto `/auth/*` passa por middleware que valida o token e injeta `user_id` no contexto da requisição.
- Toda query de repositório filtra por `user_id` extraído do token, nunca do body/params — impede um usuário ler dado de outro mesmo manipulando a URL.
- Validação de entrada com Zod em todas as rotas, rejeitando payload antes de chegar ao service.
- CORS restrito a `localhost:5173` (dev) e ao domínio Vercel de produção — nunca `*`.
- Rate limiting básico no endpoint de login (ex: `express-rate-limit` ou plugin equivalente do Fastify).

---

## 9. Ambientes

**Local (`.env` de desenvolvimento):**
```
DATABASE_URL=postgresql://localhost:5432/oikos_dev
PORT=3000
JWT_SECRET=<gerado localmente>
JWT_REFRESH_SECRET=<gerado localmente>
CORS_ORIGIN=http://localhost:5173
```

**Produção (variáveis configuradas direto no Render/Vercel, nunca commitadas):**
```
DATABASE_URL=<connection string do Neon>
PORT=<definido pelo Render>
JWT_SECRET=<segredo de produção, diferente do local>
JWT_REFRESH_SECRET=<idem>
CORS_ORIGIN=https://oikos.vercel.app
```

`.env.example` fica versionado com as chaves vazias. `.env` fica no `.gitignore` em ambos os repositórios, sempre.

---

## 10. Fluxo Git

```
main
 └── develop
      ├── feature/accounts
      ├── feature/expenses
      ├── feature/credit-cards
      └── feature/dashboard
```

Merge de feature → `develop` após teste manual do módulo. Merge de `develop` → `main` apenas em pontos estáveis (fim de cada versão V1, V2, V3...). Para as fases iniciais, com um único desenvolvedor, é aceitável simplificar para commits diretos em `develop` sem branch por feature, promovendo para `main` no fechamento de cada versão.

---

## 11. Responsividade

Mobile-first: layout base construído para largura de celular, com breakpoints expandindo para tablet e desktop.

- Desktop: sidebar fixa à esquerda + área de conteúdo.
- Mobile: menu inferior fixo (bottom navigation) com os módulos mais usados (Dashboard, Entradas/Despesas, Cartões, Configurações) e sidebar colapsada em menu hambúrguer para o restante.
- Gráficos com biblioteca responsiva (Recharts se lidar bem com container fluido) recalculando dimensão conforme viewport, não com largura fixa em pixel.

---

## 12. Ordem de implementação

| Fase | Entrega |
|---|---|
| 0 | Este documento aprovado, framework HTTP e ferramenta de migration decididos |
| 1 | Scaffold dos dois repositórios (Vite + Fastify/Express), lint, tsconfig |
| 2 | Postgres local via pgAdmin 4 configurado; projeto Neon criado (sem uso ainda) |
| 3 | Migrations: users, categories, accounts |
| 4 | Autenticação (registro interno, login, JWT, middleware) |
| 5 | Módulo contas (CRUD + cálculo de saldo via query) |
| 6 | Módulo categorias (padrão + customizada) |
| 7 | Módulo entradas |
| 8 | Módulo despesas (débito/dinheiro/PIX) |
| 9 | Módulo transferências |
| 10 | Módulo cartões de crédito (CRUD, limite) |
| 11 | Módulo compras parceladas + regra de atribuição de fatura (5.4) |
| 12 | Módulo faturas (fechamento automático, pagamento) |
| 13 | Dashboard (agregações reais, gráficos) |
| 14 | Relatórios (V3 completo) |
| 15 | Orçamentos e metas (V4) |
| 16 | Multiusuário público: cadastro, recuperação de senha (V5) |
| 17 | Testes automatizados dos cálculos financeiros (saldo, limite, parcelamento, atribuição de fatura) |
| 18 | Deploy: Neon → Render → Vercel, smoke test em produção |

Cada fase segue o ciclo: decidir escopo → criar tabela/migration → implementar repository/service/controller → testar via API (Postman/Insomnia) → conectar no front → testar end-to-end → só então avançar. Nenhuma fase de tela avança sem a fase de backend correspondente já validada.

---

## 13. Backlog / limitações conhecidas

Itens levantados durante a auditoria do redesign do Dashboard contra o relatório técnico-matemático (fórmulas de Patrimônio Líquido, Taxa de Poupança etc.) — escopo reduzido em relação ao relatório, mantido por enquanto por falta de modelagem de dados, não por decisão de produto. Cada card no Dashboard já tem uma legenda discreta apontando pra essa limitação; este item existe pra não perder o contexto de *por quê*.

### Patrimônio Líquido — não modela investimentos nem empréstimo com saldo devedor

O relatório define Patrimônio Líquido como `ΣAtivos (liquidez, imobilizado, investimentos) − ΣPassivos (dívidas, empréstimos, financiamentos)`. A implementação atual (`dashboard.service.ts`) é `saldo_real − dívida_em_aberto_de_cartão`:

- Não existe conceito de "conta de investimento" no schema — `accounts.type` só tem `checking | savings | cash` (seção 5.2). Não há como separar "carteira" de "aplicação" hoje.
- Não existe passivo de empréstimo com saldo devedor amortizável — "Empréstimo" existe só como uma categoria de despesa recorrente (`categories`), sem tabela de financiamento, taxa, parcela restante ou saldo devedor associado.

Pra fechar esse gap: precisaria de (a) um campo/tabela de classificação de conta como investimento, ou uma tabela de posições de investimento separada; e (b) uma tabela de financiamentos (`loans`: principal, taxa, parcelas restantes, saldo devedor), com a categoria de despesa "Empréstimo" apontando pra um financiamento em vez de ser só uma despesa recorrente solta. Nenhum dos dois está desenhado ainda.

### Taxa de Poupança — soma qualquer meta, não só investimento

O relatório define Taxa de Poupança como `Valor_Aportado_em_Investimentos / Entradas`. A implementação atual soma `SUM(goal_contributions do mês) / Entradas` — ou seja, aporte de QUALQUER meta financeira, não só metas de investimento.

Causa: `financial_goals` (seção 5.5) tem só `name`, `target_amount_cents`, `target_date` — nenhum campo de tipo/propósito. Uma meta "Viagem" ou "Reserva de emergência" conta igual a uma meta de investimento de verdade.

Pra fechar esse gap: precisaria de um campo `purpose`/`type` em `financial_goals` (ex: `investment | other`), e a Taxa de Poupança passaria a filtrar só contribuições de metas `investment`.
