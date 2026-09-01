import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from '../errors/AppError.js'

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.code(error.statusCode).send({ error: error.message })
    return
  }

  if (error instanceof ZodError) {
    reply.code(400).send({
      error: 'dados inválidos',
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    })
    return
  }

  const statusCode = (error as FastifyError).statusCode
  if (typeof statusCode === 'number' && statusCode < 500) {
    reply.code(statusCode).send({ error: error.message })
    return
  }

  request.log.error(error)
  reply.code(500).send({ error: 'erro interno' })
}
