export class IntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export function isIntegrationError(
  error: unknown,
): error is IntegrationError {
  return error instanceof IntegrationError;
}

