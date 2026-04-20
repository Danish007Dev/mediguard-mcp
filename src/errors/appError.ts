export class AppError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  public constructor(
    message: string,
    code = 'INTERNAL_ERROR',
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function toAppError(
  error: unknown,
  fallbackMessage = 'An unexpected error occurred'
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, 'INTERNAL_ERROR');
  }

  return new AppError(fallbackMessage, 'INTERNAL_ERROR', {
    cause: String(error)
  });
}
