import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { payInvoiceSchema } from './invoices.schema.js'
import { invoicesService } from './invoices.service.js'

const listQuerySchema = z.object({
  creditCardId: z.string().uuid().optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { creditCardId } = listQuerySchema.parse(request.query)
  const invoices = await invoicesService.listForUser(request.user!.id, creditCardId)
  reply.send({ invoices })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const invoice = await invoicesService.getDetail(id, request.user!.id)
  reply.send({ invoice })
}

export async function pay(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = payInvoiceSchema.parse(request.body)
  const result = await invoicesService.payInvoice(request.user!.id, id, body)
  reply.send(result)
}
