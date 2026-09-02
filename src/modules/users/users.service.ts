import bcrypt from 'bcrypt'
import { ConflictError, UnauthorizedError } from '../../errors/AppError.js'
import { isUniqueViolation } from '../../utils/postgres.js'
import { usersRepository } from './users.repository.js'
import type { UpdateProfileData } from './users.repository.js'
import type { PublicUser } from './users.types.js'

const BCRYPT_COST = 12

export const usersService = {
  async updateProfile(userId: string, data: UpdateProfileData): Promise<PublicUser> {
    if (data.email !== undefined) {
      const existing = await usersRepository.findByEmail(data.email)
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

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await usersRepository.findByIdWithHash(userId)
    if (!user) {
      throw new UnauthorizedError('não autenticado')
    }

    const currentPasswordMatches = await bcrypt.compare(currentPassword, user.password_hash)
    if (!currentPasswordMatches) {
      throw new UnauthorizedError('senha atual incorreta')
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_COST)
    await usersRepository.updatePasswordHash(userId, newHash)
  },
}
