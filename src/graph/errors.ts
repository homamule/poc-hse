export class GraphError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function isGraphError(error: unknown): error is GraphError {
  return error instanceof GraphError;
}
