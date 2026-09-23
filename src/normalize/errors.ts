export class NormalizeError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "NormalizeError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function isNormalizeError(error: unknown): error is NormalizeError {
  return error instanceof NormalizeError;
}
