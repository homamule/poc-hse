export class CompareError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "CompareError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function isCompareError(error: unknown): error is CompareError {
  return error instanceof CompareError;
}
