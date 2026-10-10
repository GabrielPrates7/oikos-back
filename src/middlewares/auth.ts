import type { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { usersRepository } from '../modules/users/users.repository.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string }
  }
}

// Roda em TODA requisição autenticada (1 SELECT por chamada, por escolha explícita — troca de
// senha ou exclusão de conta precisam invalidar sessões antigas de imediato, não só depois do
// access token expirar sozinho em até 20min). Além de comparar token_version, o próprio lookup
// já cobre o caso de o usuário ter sido excluído: sem linha, 401 na mesma hora, com ou sem
// token ainda "válido" (assinatura/expiração) do ponto de vista do JWT.
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'não autenticado' })
    return
  }

  const token = authHeader.slice('Bearer '.length)

  let sub: string
  let tv: number
  try {
    const payload = jwt.verify(token, env.jwtSecret)
    if (
      typeof payload !== 'object' ||
      typeof payload.sub !== 'string' ||
      typeof payload.tv !== 'number'
    ) {
      throw new Error('invalid token payload')
    }
    sub = payload.sub
    tv = payload.tv
  } catch {
    reply.code(401).send({ error: 'não autenticado' })
    return
  }

  const user = await usersRepository.findAuthInfo(sub)
  if (!user || user.token_version !== tv) {
    reply.code(401).send({ error: 'sessão expirada, faça login novamente' })
    return
  }

  request.user = { id: sub }
}
