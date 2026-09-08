import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  from: vi.fn(),
  lookupClientDirectoryRow: vi.fn(),
  parseSyncBatch: vi.fn(),
  readJsonObject: vi.fn(),
}));

vi.mock("@/lib/clients/directory", () => ({
  lookupClientDirectoryRow: stubs.lookupClientDirectoryRow,
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  databaseFailure: (code: string, message: string) =>
    Object.assign(new Error(message), { code }),
  handleIntegrationRoute: (
    operation: (requestId: string) => Promise<Response>,
  ) => operation("sync-route-test-request"),
  readJsonObject: stubs.readJsonObject,
}));

vi.mock("@/lib/integrations/sync", () => ({
  hasVersionConflict: vi.fn(() => false),
  parseSyncBatch: stubs.parseSyncBatch,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

describe("offline sync replay authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue({
      organizationId: "11111111-1111-4111-8111-111111111111",
      organizationName: "測試機構",
      branchId: "22222222-2222-4222-8222-222222222222",
      branchName: "測試分支",
      userId: "33333333-3333-4333-8333-333333333333",
      displayName: "測試人員",
      roles: ["care_worker"],
      scopes: ["clients.read", "sync.use"],
      assuranceLevel: "aal2",
      recentAal2At: new Date().toISOString(),
      demo: false,
    });
    stubs.readJsonObject.mockResolvedValue({});
    stubs.parseSyncBatch.mockReturnValue([
      {
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        entityType: "care-note",
        entityId: "55555555-5555-4555-8555-555555555555",
        baseVersion: 1,
        occurredAt: new Date().toISOString(),
        deviceId: "assigned-device",
        payloadHash: "a".repeat(64),
        clientId: "66666666-6666-4666-8666-666666666666",
        payload: {},
      },
    ]);
    stubs.lookupClientDirectoryRow.mockResolvedValue(null);
    stubs.createServerSupabaseClient.mockResolvedValue({ from: stubs.from });
  });

  it("revalidates the current client assignment before revealing an idempotent replay", async () => {
    const response = await POST(
      new Request("https://example.invalid/api/sync/batch", {
        method: "POST",
        body: "{}",
      }),
    );
    const body = (await response.json()) as {
      data: {
        operations: Array<Record<string, unknown>>;
        persisted: boolean;
      };
      errors: Array<{ code: string; field?: string }>;
    };

    expect(response.status).toBe(207);
    expect(stubs.lookupClientDirectoryRow).toHaveBeenCalledWith(
      expect.objectContaining({ from: stubs.from }),
      expect.objectContaining({
        userId: "33333333-3333-4333-8333-333333333333",
      }),
      "offline_sync",
      "66666666-6666-4666-8666-666666666666",
    );
    expect(stubs.from).not.toHaveBeenCalled();
    expect(body.data.operations).toEqual([
      {
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        status: "rejected",
        persisted: false,
      },
    ]);
    expect(body.errors).toEqual([
      {
        code: "CLIENT_NOT_ACCESSIBLE",
        message: "找不到可同步的授權個案。",
        field: "operations.0.payload.client_id",
      },
    ]);
  });
});
