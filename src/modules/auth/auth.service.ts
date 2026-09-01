import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { ConflictError, NotFoundError, UnauthorizedError } from '../../errors/AppError.js'
import { usersRepository } from '../users/users.repository.js'
import type { PublicUser } from '../users/users.types.js'

const ACCESS_TOKEN_TTL = '20m'
const REFRESH_TOKEN_TTL = '7d'
const BCRYPT_COST = 12

function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL })
}

function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtRefreshSecret, { expiresIn: REFRESH_TOKEN_TTL })
}

interface AuthResult {
  user: PublicUser
  accessToken: string
  refreshToken: string
}

export const authService = {
  async register(name: string, email: string, password: string): Promise<AuthResult> {
    const existing = await usersRepository.findByEmail(email)
    if (existing) {
      throw new ConflictError('e-mail já cadastrado')
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    const user = await usersRepository.createUser(name, email, passwordHash)

    return {
      user,
      accessToken: signAccessToken(user.id),
      refreshToken: signRefreshToken(user.id),
    }
  },

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await usersRepository.findByEmail(email)
    if (!user) {
      throw new UnauthorizedError('credenciais inválidas')
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatches) {
      throw new UnauthorizedError('credenciais inválidas')
    }

    const publicUser: PublicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at,
      updated_at: user.updated_at,
    }

    return {
      user: publicUser,
      accessToken: signAccessToken(user.id),
      refreshToken: signRefreshToken(user.id),
    }
  },

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    let payload: jwt.JwtPayload
    try {
      const decoded = jwt.verify(refreshToken, env.jwtRefreshSecret)
      if (typeof decoded !== 'object' || typeof decoded.sub !== 'string') {
        throw new Error('invalid token payload')
      }
      payload = decoded
    } catch {
      throw new UnauthorizedError('não autenticado')
    }

    return { accessToken: signAccessToken(payload.sub as string) }
  },

  logout(): void {
    // Sem tabela de tokens revogados nesta fase (fica pra V5, multiusuário público).
    // O controller apenas limpa o cookie do refresh token.
  },

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await usersRepository.findById(userId)
    if (!user) {
      throw new NotFoundError('usuário não encontrado')
    }
    return user
  },
}
