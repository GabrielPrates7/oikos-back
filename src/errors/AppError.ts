export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message)
    this.name = 'ConflictError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(401, message)
    this.name = 'UnauthorizedError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message)
    this.name = 'NotFoundError'
  }
}
