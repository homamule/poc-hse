export class RelationsError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "RelationsError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function isRelationsError(error: unknown): error is RelationsError {
  return error instanceof RelationsError;
}
