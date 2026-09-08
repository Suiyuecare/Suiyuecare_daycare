import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    try {
      return await operation("a0000000-0000-4000-8000-000000000099");
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        message?: unknown;
        httpStatus?: unknown;
      };
      return Response.json(
        {
          requestId: "a0000000-0000-4000-8000-000000000099",
          status: "error",
          data: null,
          errors: [
            {
              code:
                typeof candidate.code === "string" ? candidate.code : "ERROR",
              message:
                typeof candidate.message === "string"
                  ? candidate.message
                  : "error",
            },
          ],
        },
        {
          status:
            typeof candidate.httpStatus === "number"
              ? candidate.httpStatus
              : 500,
        },
      );
    }
  },
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST as record } from "./record/route";
import { POST as verify } from "./verify/route";

const formalActor = {
  organizationId: "a0000000-0000-4000-8000-000000000001",
  organizationName: "測試機構",
  branchId: "a0000000-0000-4000-8000-000000000002",
  branchName: "測試分支",
  userId: "a0000000-0000-4000-8000-000000000003",
  displayName: "測試人員",
  roles: ["nurse"],
  scopes: ["medications.administer", "medications.verify"],
  assuranceLevel: "aal2",
  recentAal2At: new Date().toISOString(),
  demo: false,
};

describe("medication administration API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(formalActor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
  });

  it.each([
    ["record", record],
    ["verify", verify],
  ])("rejects demo %s before reading any body", async (_name, handler) => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...formalActor,
      demo: true,
    });
    const response = await handler(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        body: "not-json",
      }),
    );
    const body = (await response.json()) as {
      errors: Array<{ code: string }>;
    };
    expect(response.status).toBe(403);
    expect(body.errors[0]?.code).toBe("DEMO_READ_ONLY");
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it.each([
    ["record", record],
    ["verify", verify],
  ])("requires recent AAL2 before parsing a %s body", async (_name, handler) => {
    stubs.requireRecentAal2.mockRejectedValue(
      Object.assign(new Error("請重新驗證。"), {
        code: "AAL2_REQUIRED",
        httpStatus: 403,
      }),
    );
    const response = await handler(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects missing verification scope before parsing the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...formalActor,
      scopes: ["medications.administer"],
    });
    const response = await verify(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects missing administration scope before parsing the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...formalActor,
      scopes: ["medications.verify"],
    });
    const response = await record(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("returns a strict persisted receipt for a confirmed record", async () => {
    const administrationId = "b0000000-0000-4000-8000-000000000001";
    const idempotencyKey = "b0000000-0000-4000-8000-000000000002";
    const occurredAt = "2026-09-01T03:30:00.000Z";
    stubs.readJsonObject.mockResolvedValue({
      medication_administration_id: administrationId,
      status: "administered",
      occurred_at: occurredAt,
      actual_dose: 1,
      dose_unit: "錠",
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        operation_id: "b0000000-0000-4000-8000-000000000003",
        medication_administration_id: administrationId,
        status: "administered",
        administered_at: occurredAt,
        requires_second_verification: false,
        finalization_state: "signed",
        signed_at: "2026-09-01T03:31:00.000Z",
        replayed: false,
      },
      error: null,
    });
    stubs.createServerSupabaseClient.mockResolvedValue({
      rpc: vi.fn().mockReturnValue({ maybeSingle }),
    });
    const response = await record(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: "{}",
      }),
    );
    const body = (await response.json()) as {
      status: string;
      errors: unknown[];
      data: Record<string, unknown>;
    };
    expect(response.status).toBe(201);
    expect(body.status).toBe("ok");
    expect(body.errors).toEqual([]);
    expect(body.data).toMatchObject({
      medicationAdministrationId: administrationId,
      persisted: true,
      demo: false,
    });
  });

  it("rejects a malformed 2xx-shaped database record receipt", async () => {
    const administrationId = "b0000000-0000-4000-8000-000000000001";
    const occurredAt = "2026-09-01T03:30:00.000Z";
    stubs.readJsonObject.mockResolvedValue({
      medication_administration_id: administrationId,
      status: "administered",
      occurred_at: occurredAt,
      actual_dose: 1,
      dose_unit: "錠",
    });
    stubs.createServerSupabaseClient.mockResolvedValue({
      rpc: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            operation_id: "b0000000-0000-4000-8000-000000000003",
            medication_administration_id: administrationId,
            status: "administered",
            administered_at: occurredAt,
            requires_second_verification: false,
            finalization_state: "signed",
            signed_at: "not-a-time",
            replayed: false,
          },
          error: null,
        }),
      }),
    });
    const response = await record(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        headers: {
          "Idempotency-Key": "b0000000-0000-4000-8000-000000000002",
        },
        body: "{}",
      }),
    );
    const body = (await response.json()) as { errors: Array<{ code: string }> };
    expect(response.status).toBe(409);
    expect(body.errors[0]?.code).toBe("MEDICATION_RESULT_INVALID");
  });

  it("returns only a correlated strict verification receipt", async () => {
    const administrationId = "c0000000-0000-4000-8000-000000000001";
    const occurredAt = "2026-09-01T03:30:00.000Z";
    stubs.readJsonObject.mockResolvedValue({
      medication_administration_id: administrationId,
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        operation_id: "c0000000-0000-4000-8000-000000000003",
        medication_administration_id: administrationId,
        status: "held",
        administered_at: occurredAt,
        requires_second_verification: true,
        finalization_state: "signed",
        signed_at: "2026-09-01T03:31:00.000Z",
        replayed: false,
      },
      error: null,
    });
    stubs.createServerSupabaseClient.mockResolvedValue({
      rpc: vi.fn().mockReturnValue({ maybeSingle }),
    });
    const response = await verify(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        headers: {
          "Idempotency-Key": "c0000000-0000-4000-8000-000000000002",
        },
        body: "{}",
      }),
    );
    const body = (await response.json()) as {
      status: string;
      errors: unknown[];
      data: Record<string, unknown>;
    };
    expect(response.status).toBe(201);
    expect(body.status).toBe("ok");
    expect(body.errors).toEqual([]);
    expect(body.data).toEqual({
      operationId: "c0000000-0000-4000-8000-000000000003",
      medicationAdministrationId: administrationId,
      status: "held",
      occurredAt,
      requiresSecondVerification: true,
      finalizationState: "signed",
      signedAt: "2026-09-01T03:31:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
    });
  });

  it("rejects a verification receipt without an explicit signed-at offset", async () => {
    const administrationId = "c0000000-0000-4000-8000-000000000001";
    const occurredAt = "2026-09-01T03:30:00.000Z";
    stubs.readJsonObject.mockResolvedValue({
      medication_administration_id: administrationId,
    });
    stubs.createServerSupabaseClient.mockResolvedValue({
      rpc: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            operation_id: "c0000000-0000-4000-8000-000000000003",
            medication_administration_id: administrationId,
            status: "held",
            administered_at: occurredAt,
            requires_second_verification: true,
            finalization_state: "signed",
            signed_at: "2026-09-01",
            replayed: false,
          },
          error: null,
        }),
      }),
    });
    const response = await verify(
      new Request("https://example.invalid/api/medications", {
        method: "POST",
        headers: {
          "Idempotency-Key": "c0000000-0000-4000-8000-000000000002",
        },
        body: "{}",
      }),
    );
    const body = (await response.json()) as { errors: Array<{ code: string }> };
    expect(response.status).toBe(409);
    expect(body.errors[0]?.code).toBe(
      "MEDICATION_VERIFICATION_RESULT_INVALID",
    );
  });
});
