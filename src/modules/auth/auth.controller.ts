import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../../config/env.js'
import { loginSchema, registerSchema } from './auth.schema.js'
import { authService } from './auth.service.js'

const REFRESH_COOKIE_NAME = 'refreshToken'
const REFRESH_COOKIE_PATH = '/api/auth'
const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  })
}

export async function register(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = registerSchema.parse(request.body)
  const result = await authService.register(body.name, body.email, body.password)
  setRefreshCookie(reply, result.refreshToken)
  reply.code(201).send({ user: result.user, accessToken: result.accessToken })
}

export async function login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = loginSchema.parse(request.body)
  const result = await authService.login(body.email, body.password)
  setRefreshCookie(reply, result.refreshToken)
  reply.code(200).send({ user: result.user, accessToken: result.accessToken })
}

export async function refresh(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[REFRESH_COOKIE_NAME]
  if (!token) {
    reply.code(401).send({ error: 'não autenticado' })
    return
  }

  const result = await authService.refresh(token)
  reply.code(200).send(result)
}

export async function logout(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  authService.logout()
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
  reply.code(204).send()
}

export async function me(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await authService.getProfile(request.user!.id)
  reply.code(200).send({ user })
}
