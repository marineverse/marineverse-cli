export type RequestDiagnostics = {
  elapsed_ms: number;
  stage: 'headers' | 'body' | 'backoff';
  attempts: number;
  cause: string;
  request_id?: string;
  http_status?: number;
};

export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 7, public retryAfterSeconds?: number, public oauthError?: string,
    public diagnostics?: RequestDiagnostics) {
    super(message);
  }
}

// Only the errno code (such as EACCES) is safe to show; paths and messages may contain private data.
export function errno(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) ? code : 'unknown error';
}

export function usage(message: string): never {
  throw new CliError('INVALID_USAGE', message, 2);
}

export function authRequired(message = 'Run marineverse login for this environment.'): never {
  throw new CliError('AUTH_REQUIRED', message, 3);
}
