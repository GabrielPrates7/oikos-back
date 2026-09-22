export interface InvoicePayment {
  id: string
  invoice_id: string
  account_id: string
  amount_cents: number
  payment_date: string
  created_at: Date
  // NULL = pagamento ativo. Preenchido = cancelado (soft-cancel: o registro nunca é apagado,
  // preserva auditoria — ver invoicesService.cancelPayment).
  canceled_at: Date | null
}

export interface InvoicePaymentForAccountRow {
  id: string
  amount_cents: number
  date: string
  created_at: Date
  card_name: string
}
