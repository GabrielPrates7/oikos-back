import type { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string }
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'não autenticado' })
    return
  }

  const token = authHeader.slice('Bearer '.length)

  try {
    const payload = jwt.verify(token, env.jwtSecret)
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') {
      throw new Error('invalid token payload')
    }
    request.user = { id: payload.sub }
  } catch {
    reply.code(401).send({ error: 'não autenticado' })
  }
}
