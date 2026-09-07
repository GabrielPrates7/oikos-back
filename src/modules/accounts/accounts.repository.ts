import { pool } from '../../config/database.js'
import type { CreateAccountInput, UpdateAccountInput } from './accounts.schema.js'
import type { Account, AccountStatus } from './accounts.types.js'

export const accountsRepository = {
  async create(userId: string, data: CreateAccountInput): Promise<Account> {
    const result = await pool.query<Account>(
      `INSERT INTO accounts (user_id, name, bank_name, type, initial_balance_cents)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, data.name, data.bank_name ?? null, data.type, data.initial_balance_cents],
    )
    return result.rows[0]
  },

  async findAllByUser(userId: string, status?: AccountStatus | 'all'): Promise<Account[]> {
    if (status === 'all') {
      const result = await pool.query<Account>(
        'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at',
        [userId],
      )
      return result.rows
    }

    const result = await pool.query<Account>(
      'SELECT * FROM accounts WHERE user_id = $1 AND status = $2 ORDER BY created_at',
      [userId, status ?? 'active'],
    )
    return result.rows
  },

  async findByIdAndUser(id: string, userId: string): Promise<Account | null> {
    const result = await pool.query<Account>(
      'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(id: string, userId: string, data: UpdateAccountInput): Promise<Account | null> {
    const fields: string[] = []
    const values: unknown[] = []
    let index = 1

    if (data.name !== undefined) {
      fields.push(`name = $${index++}`)
      values.push(data.name)
    }
    if (data.bank_name !== undefined) {
      fields.push(`bank_name = $${index++}`)
      values.push(data.bank_name)
    }
    if (data.type !== undefined) {
      fields.push(`type = $${index++}`)
      values.push(data.type)
    }
    if (data.initial_balance_cents !== undefined) {
      fields.push(`initial_balance_cents = $${index++}`)
      values.push(data.initial_balance_cents)
    }

    if (fields.length === 0) {
      return accountsRepository.findByIdAndUser(id, userId)
    }

    values.push(id, userId)
    const result = await pool.query<Account>(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = $${index++} AND user_id = $${index} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  async archive(id: string, userId: string): Promise<Account | null> {
    const result = await pool.query<Account>(
      "UPDATE accounts SET status = 'archived' WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async activate(id: string, userId: string): Promise<Account | null> {
    const result = await pool.query<Account>(
      "UPDATE accounts SET status = 'active' WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async getBalance(id: string, userId: string): Promise<{ balanceCents: number } | null> {
    // Fórmula completa da seção 5.2 do documento técnico (modelo de razão contábil).
    // Subqueries agregadas (não LEFT JOIN em paralelo) pra não multiplicar linhas.
    // O filtro por a.user_id = $2 já confirma posse antes de calcular.
    const result = await pool.query<{ balance_cents: number }>(
      `SELECT
         (
           a.initial_balance_cents
           + COALESCE((SELECT SUM(amount_cents) FROM income_entries WHERE account_id = a.id), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE account_id = a.id), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE from_account_id = a.id), 0)
           + COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE to_account_id = a.id), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM invoice_payments WHERE account_id = a.id), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM goal_contributions WHERE account_id = a.id), 0)
         )::int AS balance_cents
       FROM accounts a
       WHERE a.id = $1 AND a.user_id = $2`,
      [id, userId],
    )
    const row = result.rows[0]
    if (!row) {
      return null
    }
    return { balanceCents: row.balance_cents }
  },

  // UNION ALL (não UNION) — não precisa deduplicar, só saber se existe QUALQUER linha;
  // EXISTS já para no primeiro achado, sem varrer as 5 tabelas inteiras.
  async hasAnyMovement(id: string): Promise<boolean> {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM income_entries WHERE account_id = $1
         UNION ALL
         SELECT 1 FROM expenses WHERE account_id = $1
         UNION ALL
         SELECT 1 FROM transfers WHERE from_account_id = $1 OR to_account_id = $1
         UNION ALL
         SELECT 1 FROM invoice_payments WHERE account_id = $1
         UNION ALL
         SELECT 1 FROM goal_contributions WHERE account_id = $1
       ) AS exists`,
      [id],
    )
    return result.rows[0].exists
  },

  // Exclusão de verdade (não archive) — só chamada pelo service depois de confirmar posse
  // e ausência de movimentação. rowCount > 0 confirma que a linha existia e foi removida.
  async deletePermanently(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },

  async getBalanceAsOf(
    id: string,
    userId: string,
    beforeDate: string,
  ): Promise<{ balanceCents: number } | null> {
    // Mesma fórmula de getBalance, só que considerando apenas lançamentos anteriores a
    // beforeDate — usada pra calcular o saldo de abertura do extrato (accounts.service.getStatement).
    const result = await pool.query<{ balance_cents: number }>(
      `SELECT
         (
           a.initial_balance_cents
           + COALESCE((SELECT SUM(amount_cents) FROM income_entries WHERE account_id = a.id AND entry_date < $3), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE account_id = a.id AND expense_date < $3), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE from_account_id = a.id AND transfer_date < $3), 0)
           + COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE to_account_id = a.id AND transfer_date < $3), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM invoice_payments WHERE account_id = a.id AND payment_date < $3), 0)
           - COALESCE((SELECT SUM(amount_cents) FROM goal_contributions WHERE account_id = a.id AND contribution_date < $3), 0)
         )::int AS balance_cents
       FROM accounts a
       WHERE a.id = $1 AND a.user_id = $2`,
      [id, userId, beforeDate],
    )
    const row = result.rows[0]
    if (!row) {
      return null
    }
    return { balanceCents: row.balance_cents }
  },
}
