export class CollectError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "CollectError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function isCollectError(error: unknown): error is CollectError {
  return error instanceof CollectError;
}
