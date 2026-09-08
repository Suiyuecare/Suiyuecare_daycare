export class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError;
}

export function assertImport(
  condition: unknown,
  code: string,
  message: string,
  httpStatus: number,
  field?: string,
): asserts condition {
  if (!condition) {
    throw new ImportError(code, message, httpStatus, field);
  }
}
