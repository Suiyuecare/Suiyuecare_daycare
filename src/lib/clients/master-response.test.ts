import { describe, expect, it } from "vitest";

import {
  ClientMasterResponseContractError,
  parseClientMasterSuccessResponse,
} from "./master-response";

const requestId = "60000000-0000-4000-8000-000000000010";
const operationId = "60000000-0000-4000-8000-000000000011";
const clientId = "60000000-0000-4000-8000-000000000012";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    status: "ok",
    data: {
      operationId,
      clientId,
      rowVersion: 4,
      replayed: false,
      persisted: true,
      demo: false,
    },
    errors: [],
    ...overrides,
  };
}

describe("client master browser response contract", () => {
  it("binds an update receipt to the requested client and exact next version", () => {
    expect(
      parseClientMasterSuccessResponse({
        value: envelope(),
        operation: "update",
        httpStatus: 200,
        expectedClientId: clientId,
        expectedRowVersion: 4,
      }),
    ).toEqual({
      requestId,
      operationId,
      clientId,
      rowVersion: 4,
      replayed: false,
      persisted: true,
      demo: false,
    });
  });

  it("accepts only v1 create receipts with HTTP 201 or exact HTTP 200 replay", () => {
    const create = envelope({
      data: {
        operationId,
        clientId,
        rowVersion: 1,
        replayed: false,
        persisted: true,
        demo: false,
      },
    });
    expect(
      parseClientMasterSuccessResponse({
        value: create,
        operation: "create",
        httpStatus: 201,
        expectedRowVersion: 1,
      }).clientId,
    ).toBe(clientId);
    expect(
      parseClientMasterSuccessResponse({
        value: {
          ...create,
          data: { ...(create.data as object), replayed: true },
        },
        operation: "create",
        httpStatus: 200,
        expectedRowVersion: 1,
      }).replayed,
    ).toBe(true);
  });

  it.each([
    envelope({ requestId: "request" }),
    envelope({ errors: [{ code: "WARNING", message: "not empty" }] }),
    envelope({ status: "partial" }),
    envelope({ extra: true }),
    envelope({ data: { operationId, clientId, rowVersion: 4, replayed: false, persisted: true, demo: false, extra: true } }),
    envelope({ data: { operationId, clientId: crypto.randomUUID(), rowVersion: 4, replayed: false, persisted: true, demo: false } }),
    envelope({ data: { operationId, clientId, rowVersion: 5, replayed: false, persisted: true, demo: false } }),
  ])("rejects malformed, widened, cross-client, or wrong-version 2xx envelopes", (value) => {
    expect(() =>
      parseClientMasterSuccessResponse({
        value,
        operation: "update",
        httpStatus: 200,
        expectedClientId: clientId,
        expectedRowVersion: 4,
      }),
    ).toThrow(ClientMasterResponseContractError);
  });

  it("rejects an HTTP status that disagrees with create replay state", () => {
    expect(() =>
      parseClientMasterSuccessResponse({
        value: envelope({
          data: {
            operationId,
            clientId,
            rowVersion: 1,
            replayed: false,
            persisted: true,
            demo: false,
          },
        }),
        operation: "create",
        httpStatus: 200,
        expectedRowVersion: 1,
      }),
    ).toThrow(ClientMasterResponseContractError);
  });
});
