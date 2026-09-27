/** Typed application errors. `message` is safe to show to end users. */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('PERMISSION_DENIED', message);
    this.name = 'PermissionDeniedError';
  }
}

export class AuthRequiredError extends AppError {
  constructor(message = 'Authentication required.') {
    super('AUTH_REQUIRED', message);
    this.name = 'AuthRequiredError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION', message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super('NOT_FOUND', `${entity} was not found.`);
    this.name = 'NotFoundError';
  }
}

export function toSafeError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  const msg = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL', message: msg || 'An unexpected error occurred.' };
}
