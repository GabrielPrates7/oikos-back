export interface User {
  id: string
  name: string
  email: string
  password_hash: string
  created_at: Date
  updated_at: Date
}

export type PublicUser = Omit<User, 'password_hash'>
