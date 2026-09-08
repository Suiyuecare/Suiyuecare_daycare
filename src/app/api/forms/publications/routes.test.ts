import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/integrations/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/http")>();
  return {
    ...actual,
    authorizeStaffRequest: stubs.authorizeStaffRequest,
    readJsonObject: stubs.readJsonObject,
    requireRecentAal2: stubs.requireRecentAal2,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST as approvePublication } from "./approve/route";
import { POST as requestPublication } from "./request/route";

const versionId = "82100000-0000-4000-8000-000000000031";
const publicationRequestId = "82200000-0000-4000-8000-000000000031";
const idempotencyKey = "82500000-0000-4000-8000-000000000031";

const formalActor = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "測試機構",
  branchId: "22222222-2222-4222-8222-222222222222",
  branchName: "測試分支",
  userId: "33333333-3333-4333-8333-333333333333",
  displayName: "表單管理者",
  roles: ["organization_manager"],
  scopes: ["forms.manage"],
  assuranceLevel: "aal2",
  recentAal2At: new Date().toISOString(),
  demo: false,
};

function request(url: string) {
  return new Request(url, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: "{}",
  });
}

describe("form publication API authorization order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(formalActor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
  });

  it.each([
    ["送審", requestPublication, "/api/forms/publications/request"],
    ["核准", approvePublication, "/api/forms/publications/approve"],
  ])("rejects demo %s before reading the body and never fakes success", async (_label, handler, path) => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...formalActor,
      demo: true,
    });
    const response = await handler(request(`https://example.invalid${path}`));
    const body = (await response.json()) as {
      status: string;
      errors: Array<{ code: string }>;
    };

    expect(response.status).toBe(403);
    expect(body.status).toBe("error");
    expect(body.errors[0]?.code).toBe("DEMO_READ_ONLY");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(stubs.requireRecentAal2).toHaveBeenCalledTimes(1);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects missing recent AAL2 before parsing or database access", async () => {
    stubs.requireRecentAal2.mockRejectedValue(
      new IntegrationError(
        "AAL2_REQUIRED",
        "這項操作需要在最近 15 分鐘內重新完成雙因素驗證。",
        403,
      ),
    );
    const response = await requestPublication(
      request("https://example.invalid/api/forms/publications/request"),
    );
    const body = (await response.json()) as {
      errors: Array<{ code: string }>;
    };
    expect(response.status).toBe(403);
    expect(body.errors[0]?.code).toBe("AAL2_REQUIRED");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects missing forms.manage before recent AAL2 and body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...formalActor,
      scopes: [],
    });
    const response = await approvePublication(
      request("https://example.invalid/api/forms/publications/approve"),
    );
    const body = (await response.json()) as {
      errors: Array<{ code: string }>;
    };
    expect(response.status).toBe(403);
    expect(body.errors[0]?.code).toBe(
      "FORM_PUBLICATION_APPROVAL_NOT_AUTHORIZED",
    );
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("uses the 4 KiB body cap and returns the exact formal request receipt", async () => {
    stubs.readJsonObject.mockResolvedValue({ form_version_id: versionId });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        request_id: publicationRequestId,
        status: "pending",
        form_content_hash: "a".repeat(64),
        replayed: false,
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ maybeSingle });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc });
    const incoming = request(
      "https://example.invalid/api/forms/publications/request",
    );
    const response = await requestPublication(incoming);
    const body = (await response.json()) as {
      requestId: string;
      status: string;
      data: { persisted: boolean; demo: boolean };
      errors: unknown[];
    };

    expect(response.status).toBe(201);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(body.status).toBe("ok");
    expect(body.data).toMatchObject({ persisted: true, demo: false });
    expect(body.errors).toEqual([]);
    expect(stubs.readJsonObject).toHaveBeenCalledWith(incoming, 4 * 1024);
    expect(rpc).toHaveBeenCalledWith("request_form_publication", {
      p_expected_organization_id: formalActor.organizationId,
      p_expected_branch_id: formalActor.branchId,
      p_form_version_id: versionId,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("uses the 4 KiB body cap and correlates the exact formal approval receipt", async () => {
    stubs.readJsonObject.mockResolvedValue({ request_id: publicationRequestId });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        request_id: publicationRequestId,
        form_version_id: versionId,
        status: "approved",
        published_at: "2026-09-01T08:00:00+08:00",
        replayed: false,
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ maybeSingle });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc });
    const incoming = request(
      "https://example.invalid/api/forms/publications/approve",
    );
    const response = await approvePublication(incoming);
    const body = (await response.json()) as {
      status: string;
      data: {
        publication: { requestId: string; formVersionId: string };
        persisted: boolean;
        demo: boolean;
      };
      errors: unknown[];
    };

    expect(response.status).toBe(201);
    expect(body.status).toBe("ok");
    expect(body.data).toMatchObject({
      publication: { requestId: publicationRequestId, formVersionId: versionId },
      persisted: true,
      demo: false,
    });
    expect(body.errors).toEqual([]);
    expect(stubs.readJsonObject).toHaveBeenCalledWith(incoming, 4 * 1024);
  });
});
