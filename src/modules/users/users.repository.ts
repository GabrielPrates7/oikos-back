import { pool } from '../../config/database.js'
import type { PublicUser, User } from './users.types.js'

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
}
