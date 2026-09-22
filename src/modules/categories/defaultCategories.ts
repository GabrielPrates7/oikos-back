import type { CategoryType } from './categories.types.js'

export interface DefaultCategory {
  name: string
  type: CategoryType
  icon: string
}

// Mesma lista embutida na migration 1790097890432_give-ownership-to-shared-categories.sql (não
// lida do banco de propósito, nos dois lugares — ver comentário na migration). Usada aqui pelo
// seed de registro (auth.service.ts): todo usuário novo ganha sua própria cópia destas 17 no
// cadastro, já que não existem mais categorias compartilhadas (user_id NULL) para herdar via
// "OR user_id IS NULL". Se esta lista mudar, atualize a migration junto — são mantidas em
// sincronia manualmente, cada uma no seu formato (SQL/TS).
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Moradia', type: 'expense', icon: '🏠' },
  { name: 'Alimentação', type: 'expense', icon: '🍽️' },
  { name: 'Transporte', type: 'expense', icon: '🚗' },
  { name: 'Contas', type: 'expense', icon: '🧾' },
  { name: 'Lazer', type: 'expense', icon: '🎮' },
  { name: 'Tecnologia', type: 'expense', icon: '💻' },
  { name: 'Roupas', type: 'expense', icon: '👕' },
  { name: 'Educação', type: 'expense', icon: '📚' },
  { name: 'Saúde', type: 'expense', icon: '💊' },
  { name: 'Investimentos', type: 'expense', icon: '📈' },
  { name: 'Outros', type: 'expense', icon: '📦' },
  { name: 'Salário', type: 'income', icon: '💼' },
  { name: 'Freelance', type: 'income', icon: '🧑‍💻' },
  { name: 'Venda', type: 'income', icon: '🏷️' },
  { name: 'Investimentos', type: 'income', icon: '📈' },
  { name: 'Presente', type: 'income', icon: '🎁' },
  { name: 'Outros', type: 'income', icon: '📦' },
]
