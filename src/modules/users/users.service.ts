import bcrypt from 'bcrypt'
import { ConflictError, UnauthorizedError } from '../../errors/AppError.js'
import { isUniqueViolation } from '../../utils/postgres.js'
import { usersRepository } from './users.repository.js'
import type { UpdateProfileData } from './users.repository.js'
import type { PublicUser } from './users.types.js'

const BCRYPT_COST = 12

export const usersService = {
  // currentPassword só é exigido/checado quando o e-mail está de fato MUDANDO (reenviar o
  // mesmo e-mail atual, ou só trocar o nome, não pede senha) — trocar o e-mail é sensível o
  // bastante (chave de login) pra merecer a mesma confirmação de troca de senha.
  async updateProfile(
    userId: string,
    data: UpdateProfileData,
    currentPassword?: string,
  ): Promise<PublicUser> {
    const user = await usersRepository.findByIdWithHash(userId)
    if (!user) {
      throw new UnauthorizedError('não autenticado')
    }

    const isChangingEmail = data.email !== undefined && data.email !== user.email
    if (isChangingEmail) {
      if (!currentPassword) {
        throw new UnauthorizedError('senha atual é obrigatória para trocar o e-mail')
      }
      const currentPasswordMatches = await bcrypt.compare(currentPassword, user.password_hash)
      if (!currentPasswordMatches) {
        throw new UnauthorizedError('senha atual incorreta')
      }

      const existing = await usersRepository.findByEmail(data.email!)
      if (existing && existing.id !== userId) {
        throw new ConflictError('e-mail já cadastrado')
      }
    }

    let updated: PublicUser | null
    try {
      updated = await usersRepository.updateProfile(userId, data)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('e-mail já cadastrado')
      }
      throw error
    }

    if (!updated) {
      throw new UnauthorizedError('não autenticado')
    }
    return updated
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await usersRepository.findByIdWithHash(userId)
    if (!user) {
      throw new UnauthorizedError('não autenticado')
    }

    const currentPasswordMatches = await bcrypt.compare(currentPassword, user.password_hash)
    if (!currentPasswordMatches) {
      throw new UnauthorizedError('senha atual incorreta')
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_COST)
    // Incrementa token_version na mesma transação do hash novo — invalida toda sessão emitida
    // antes (a desta própria requisição incluída: só esta resposta ainda completa com o token
    // antigo, a próxima chamada com ele já cai em 401 no middleware).
    await usersRepository.updatePasswordAndBumpTokenVersion(userId, newHash)
  },
}
