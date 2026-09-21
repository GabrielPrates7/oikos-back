import { z } from 'zod'

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve estar no formato YYYY-MM-DD')

export const NOTES_MAX_LENGTH = 500

// Surrogate solto (metade de um par UTF-16) não é UTF-8 válido: o Postgres recusaria a linha com um
// erro 500. Barra aqui como "dados inválidos". O caractere NUL (U+0000) também não cabe em TEXT.
const LONE_SURROGATE = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/

// Observação livre de entradas, despesas e compras. Só trim: string vazia ou só espaços vira null; o
// texto é guardado como digitado (sem sanitização por remoção — o cliente renderiza como texto). O
// limite de 500 CARACTERES é contado por pontos de código (Array.from), o mesmo que char_length do
// Postgres na CHECK do banco (um emoji conta 1, não 2). Aceita string ou null.
export const notesSchema = z
  .string()
  .refine((value) => !LONE_SURROGATE.test(value) && !value.includes('\u0000'), {
    message: 'observação contém caracteres inválidos',
  })
  .transform((value) => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  })
  .refine((value) => value === null || Array.from(value).length <= NOTES_MAX_LENGTH, {
    message: `observação deve ter no máximo ${NOTES_MAX_LENGTH} caracteres`,
  })
  .nullable()
