import type { ClientMasterOperationResult } from "./master-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ENVELOPE_KEYS = new Set(["requestId", "status", "data", "errors"]);
const RESULT_KEYS = new Set([
  "operationId",
  "clientId",
  "rowVersion",
  "replayed",
  "persisted",
  "demo",
]);

export type ClientMasterSuccess = ClientMasterOperationResult & {
  requestId: string;
  persisted: true;
  demo: false;
};

export class ClientMasterResponseContractError extends Error {
  constructor() {
    super("CLIENT_MASTER_RESPONSE_INVALID");
    this.name = "ClientMasterResponseContractError";
  }
}

function invalid(): never {
  throw new ClientMasterResponseContractError();
}

function record(value: unknown, exactKeys: ReadonlySet<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  const keys = Object.keys(result);
  if (
    keys.length !== exactKeys.size ||
    keys.some((key) => !exactKeys.has(key))
  ) {
    invalid();
  }
  return result;
}

function uuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

export function parseClientMasterSuccessResponse(input: {
  value: unknown;
  operation: "create" | "update";
  httpStatus: number;
  expectedClientId?: string;
  expectedRowVersion: number;
}): ClientMasterSuccess {
  const envelope = record(input.value, ENVELOPE_KEYS);
  const requestId = uuid(envelope.requestId);
  if (
    envelope.status !== "ok" ||
    !Array.isArray(envelope.errors) ||
    envelope.errors.length !== 0
  ) {
    invalid();
  }

  const result = record(envelope.data, RESULT_KEYS);
  const operationId = uuid(result.operationId);
  const clientId = uuid(result.clientId);
  if (
    !Number.isSafeInteger(result.rowVersion) ||
    result.rowVersion !== input.expectedRowVersion ||
    typeof result.replayed !== "boolean" ||
    result.persisted !== true ||
    result.demo !== false ||
    (input.expectedClientId !== undefined &&
      clientId !== uuid(input.expectedClientId))
  ) {
    invalid();
  }

  const expectedHttpStatus =
    input.operation === "create" && result.replayed === false ? 201 : 200;
  if (input.httpStatus !== expectedHttpStatus) invalid();

  return {
    requestId,
    operationId,
    clientId,
    rowVersion: result.rowVersion as number,
    replayed: result.replayed,
    persisted: true,
    demo: false,
  };
}
