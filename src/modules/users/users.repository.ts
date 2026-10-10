import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { PublicUser, User } from './users.types.js'

export interface UpdateProfileData {
  name?: string
  email?: string
}

export const usersRepository = {
  async createUser(name: string, email: string, passwordHash: string): Promise<PublicUser> {
    const result = await pool.query<PublicUser>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at, updated_at`,
      [name, email, passwordHash],
    )
    return result.rows[0]
  },

  async findByEmail(email: string): Promise<User | null> {
    const result = await pool.query<User>('SELECT * FROM users WHERE email = $1', [email])
    return result.rows[0] ?? null
  },

  async findById(id: string): Promise<PublicUser | null> {
    const result = await pool.query<PublicUser>(
      'SELECT id, name, email, created_at, updated_at FROM users WHERE id = $1',
      [id],
    )
    return result.rows[0] ?? null
  },

  // Só pra troca de senha — nunca exponha password_hash fora desse fluxo.
  async findByIdWithHash(id: string): Promise<User | null> {
    const result = await pool.query<User>('SELECT * FROM users WHERE id = $1', [id])
    return result.rows[0] ?? null
  },

  // Lookup mínimo do middleware de autenticação — roda em TODA requisição autenticada, então
  // só busca as duas colunas necessárias pra confirmar que o usuário ainda existe e que o
  // token_version do JWT ainda bate com o atual.
  async findAuthInfo(id: string): Promise<{ id: string; token_version: number } | null> {
    const result = await pool.query<{ id: string; token_version: number }>(
      'SELECT id, token_version FROM users WHERE id = $1',
      [id],
    )
    return result.rows[0] ?? null
  },

  async updateProfile(id: string, data: UpdateProfileData): Promise<PublicUser | null> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return usersRepository.findById(id)
    }

    const fields = entries.map(([key], i) => `${key} = $${i + 1}`)
    const values = entries.map(([, value]) => value)
    values.push(id)

    const result = await pool.query<PublicUser>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${entries.length + 1}
       RETURNING id, name, email, created_at, updated_at`,
      values,
    )
    return result.rows[0] ?? null
  },

  async updatePasswordHash(id: string, newHash: string): Promise<void> {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, id])
  },

  // Troca de senha: hash novo + token_version incrementado na MESMA transação (invalida toda
  // sessão anterior — a de quem está trocando incluída — assim que a resposta volta).
  // Retorna o token_version NOVO, pra emitir os tokens de resposta já com ele se algum dia
  // este fluxo passar a reautenticar direto (hoje o front redireciona pro /login).
  async updatePasswordAndBumpTokenVersion(id: string, newHash: string): Promise<number> {
    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<{ token_version: number }>(
        `UPDATE users SET password_hash = $1, token_version = token_version + 1
         WHERE id = $2
         RETURNING token_version`,
        [newHash, id],
      )
      await client.query('COMMIT')
      return result.rows[0].token_version
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  },
}
