export interface User {
  id: string
  name: string
  email: string
  password_hash: string
  // Incrementado ao trocar a senha (e, no futuro, ao excluir a conta) — embutido em todo JWT
  // emitido; o middleware de autenticação rejeita qualquer token com um valor diferente do
  // atual, invalidando de imediato todas as sessões anteriores.
  token_version: number
  created_at: Date
  updated_at: Date
}

// token_version nunca vai pro cliente — é só um detalhe interno de invalidação de sessão.
export type PublicUser = Omit<User, 'password_hash' | 'token_version'>
