import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const stubs = vi.hoisted(() => ({
  authorize: vi.fn(), queue: vi.fn(), preview: vi.fn(), decision: vi.fn(),
}));
vi.mock("@/lib/jubo-review/server", () => ({
  authorizeJuboReview: stubs.authorize,
  readJuboReviewQueue: stubs.queue,
  previewJuboProfile: stubs.preview,
  reviewJuboProfile: stubs.decision,
}));

import { GET as queueGet } from "./queue/route";
import { POST as previewPost } from "./preview/route";
import { POST as decisionPost } from "./decision/route";

const pairId = "b1000000-0000-4000-8000-000000000001";
const sourceRowId = "b2000000-0000-4000-8000-000000000001";
const body = { pairId, sourceRowId, previewId: "b3000000-0000-4000-8000-000000000001",
  sourceRowSha256: "a".repeat(64), mappingReviewSha256: "b".repeat(64), previewSha256: "c".repeat(64),
  decision: "held", reason: "合成資料逐欄核對後暫緩等待確認", idempotencyKey: "b4000000-0000-4000-8000-000000000001" };

function request(path: string, payload: object, origin = "https://daycare.invalid") {
  return new Request(`https://daycare.invalid/api/jubo-profile-review/${path}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("JUBO source-bound review API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorize.mockResolvedValue({ organizationId: "b5000000-0000-4000-8000-000000000001",
      branchId: "b6000000-0000-4000-8000-000000000001" });
    stubs.queue.mockResolvedValue({ reviewPurpose: "jubo_intake_profile_mapping_v2", pairs: [] });
    stubs.preview.mockResolvedValue({ pairId, sourceRowId, previewId: body.previewId });
    stubs.decision.mockResolvedValue({ reviewVersion: 1, decision: "held" });
  });

  it("never accepts review POSTs without same-origin JSON", async () => {
    const denied = await decisionPost(request("decision", body, "https://other.invalid"));
    expect(denied.status).toBe(403);
    expect(stubs.authorize).not.toHaveBeenCalled();
    const noOrigin = new Request("https://daycare.invalid/api/jubo-profile-review/decision", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect((await decisionPost(noOrigin)).status).toBe(403);
    expect(stubs.decision).not.toHaveBeenCalled();
  });

  it("rejects invented scope and malformed reason before authorization", async () => {
    const scope = await decisionPost(request("decision", { ...body, organizationId: "other" }));
    expect(scope.status).toBe(400);
    const short = await decisionPost(request("decision", { ...body, reason: "核准" }));
    expect(short.status).toBe(400);
    expect(stubs.authorize).not.toHaveBeenCalled();
  });

  it("binds preview and review to server-selected tenant, branch and source IDs", async () => {
    const previewResponse = await previewPost(request("preview", { pairId, sourceRowId }));
    expect(previewResponse.status).toBe(200);
    expect(stubs.preview).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "b5000000-0000-4000-8000-000000000001",
      branchId: "b6000000-0000-4000-8000-000000000001",
    }), pairId, sourceRowId);
    const result = await decisionPost(request("decision", body));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(stubs.decision).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "b5000000-0000-4000-8000-000000000001",
    }), body);
  });

  it("keeps the queue no-store and behind the same authorization function", async () => {
    const response = await queueGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(stubs.authorize).toHaveBeenCalledOnce();
    expect(stubs.queue).toHaveBeenCalledOnce();
  });
});
