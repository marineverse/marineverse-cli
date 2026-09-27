export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 7, public retryAfterSeconds?: number) {
    super(message);
  }
}

export function usage(message: string): never {
  throw new CliError('INVALID_USAGE', message, 2);
}

export function authRequired(message = 'Run marineverse login for this environment.'): never {
  throw new CliError('AUTH_REQUIRED', message, 3);
}
