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

  async getBalance(id: string, userId: string): Promise<{ balanceCents: number } | null> {
    // Fase 5: só a tabela accounts existe, então o saldo é apenas o ponto de partida
    // (initial_balance_cents). A partir das Fases 7-9, quando income_entries, expenses,
    // transfers e invoice_payments existirem, esta query passa a implementar o modelo de
    // razão contábil da seção 5.2 do documento técnico:
    //
    // SELECT
    //   a.initial_balance_cents
    //   + COALESCE(SUM(DISTINCT ie.amount_cents), 0)   -- income_entries.account_id = a.id
    //   - COALESCE(SUM(DISTINCT e.amount_cents), 0)    -- expenses.account_id = a.id
    //   - COALESCE(SUM(DISTINCT t_out.amount_cents), 0) -- transfers.from_account_id = a.id
    //   + COALESCE(SUM(DISTINCT t_in.amount_cents), 0)  -- transfers.to_account_id = a.id
    //   - COALESCE(SUM(DISTINCT ip.amount_cents), 0)   -- invoice_payments.account_id = a.id
    //   AS balance_cents
    // FROM accounts a
    // LEFT JOIN income_entries ie ON ie.account_id = a.id
    // LEFT JOIN expenses e ON e.account_id = a.id
    // LEFT JOIN transfers t_out ON t_out.from_account_id = a.id
    // LEFT JOIN transfers t_in ON t_in.to_account_id = a.id
    // LEFT JOIN invoice_payments ip ON ip.account_id = a.id
    // WHERE a.id = $1 AND a.user_id = $2
    // GROUP BY a.id
    //
    // (os LEFT JOINs em paralelo multiplicam linhas; a versão real usará subqueries
    // agregadas em vez de SUM(DISTINCT ...) quando essas tabelas existirem.)
    const result = await pool.query<{ initial_balance_cents: number }>(
      'SELECT initial_balance_cents FROM accounts WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    const row = result.rows[0]
    if (!row) {
      return null
    }
    return { balanceCents: row.initial_balance_cents }
  },
}
