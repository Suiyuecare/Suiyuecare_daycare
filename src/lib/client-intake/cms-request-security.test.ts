import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), recent: vi.fn(), client: vi.fn(), admin: vi.fn(), rpc: vi.fn(), stage: vi.fn(), archive: vi.fn(),
  env: { NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test", AWS_REGION: "ap-northeast-1", HTML_ARCHIVE_BUCKET: "synthetic-cms-archive", AWS_KMS_KEY_ID: "synthetic-kms" },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: mocks.env, isDemoMode: () => false, hasSupabaseConfiguration: () => true, hasSupabaseAdminConfiguration: () => true }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/imports/trusted-staging", () => ({ stageTrustedIntakeHtmlImport: mocks.stage }));
vi.mock("@/lib/imports/worm-archive", () => ({ S3ComplianceArchive: class { constructor() { mocks.archive(); } } }));

// These are the actual handlers, routine-intake authorizer and same-origin guard.
// Only external auth/database/archive providers are synthetic; no cloud is used.
import { GET as preview, POST as upload } from "@/app/api/client-intake/imports/route";
import { POST as approve } from "@/app/api/client-intake/imports/approve/route";

const origin = "https://daycare.example.test";
const batch = "a2700000-0000-4000-8000-000000000001";
const operation = "a2800000-0000-4000-8000-000000000001";
const client = "a2900000-0000-4000-8000-000000000001";
const actor: TenantContext = {
  organizationId: "a2500000-0000-4000-8000-000000000001", organizationName: "合成機構",
  branchId: "a2600000-0000-4000-8000-000000000001", branchName: "合成分支",
  userId: "a2400000-0000-4000-8000-000000000001", displayName: "合成收案人員", roles: ["branch_director"],
  scopes: ["clients.read", "clients.demographics.read", "clients.manage", "clients.view_all", "imports.manage", "imports.approve"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false,
};
const commitInput = {
  batchId: batch, idempotency_key: operation, payloadSha256: "a".repeat(64), clientId: null,
  expectedVersion: 0, expectedClientVersion: 0, clientCode: "SYN-CMS-ONLY", sourceReviewReason: null,
  decisions: [{ fieldId: "f1", target: "displayName", choice: "use_source" }, { fieldId: "f2", target: "identityNumber", choice: "use_source" }],
};
const html = "<!doctype html><html><body><h5>需要服務者基本資料</h5><table><tr><td>姓名</td><td>合成個案</td></tr></table></body></html>";
function form() {
  const value = new FormData();
  value.append("file", new File([html], "synthetic.html", { type: "text/html" }));
  return value;
}
function uploadRequest(options: { url?: string; headers?: HeadersInit; value?: FormData } = {}) {
  const request = new Request(options.url ?? `${origin}/api/client-intake/imports`, {
    method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "idempotency-key": operation }, body: options.value ?? form(),
  });
  for (const [key, value] of new Headers(options.headers)) request.headers.set(key, value);
  return request;
}
function approveRequest(options: { url?: string; headers?: HeadersInit; value?: unknown } = {}) {
  return new Request(options.url ?? `${origin}/api/client-intake/imports/approve`, {
    method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...Object.fromEntries(new Headers(options.headers)) },
    body: JSON.stringify(options.value ?? commitInput),
  });
}
async function denial(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text();
  expect(JSON.parse(text).data).toBeNull();
  expect(text).not.toMatch(/SYNTHETIC_SECRET|synthetic-cms-archive|synthetic-kms|stack|合成個案/u);
}
function noProviders() {
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(mocks.stage).not.toHaveBeenCalled();
}
function noBusinessMutation() {
  expect(mocks.rpc.mock.calls.every(([name]) => name === "has_routine_intake_access")).toBe(true);
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(mocks.stage).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  mocks.env.HTML_ARCHIVE_BUCKET = "synthetic-cms-archive";
  mocks.env.AWS_KMS_KEY_ID = "synthetic-kms";
  mocks.context.mockResolvedValue(actor);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.admin.mockReturnValue({ rpc: vi.fn() });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "has_routine_intake_access") return { data: true, error: null };
    if (name === "find_cms_intake_source") return { data: null, error: null };
    if (name === "cms_intake_preview") return { data: { batchId: batch, payloadSha256: "a".repeat(64), mappingVersion: "central-care-plan-html@1", fields: [], sections: [], warnings: [], conflicts: [], current: null, imported: false, importReceipt: null }, error: null };
    if (name === "commit_cms_intake") return { data: { operationId: operation, clientId: client, profileVersion: 1, clientRowVersion: 1, pending: true, replayed: false, formallyImported: true, batchId: batch }, error: null };
    throw new Error("SYNTHETIC_SECRET unexpected provider call");
  });
  mocks.stage.mockResolvedValue({ reservation_id: batch, status: "completed", staging_only: true, formally_imported: false, replayed: false });
});
afterEach(() => vi.useRealTimers());

describe("actual CMS request-source security", () => {
  it.each(["upload", "approve"] as const)("rejects %s from a foreign origin before auth or body", async (kind) => {
    const request = kind === "upload" ? uploadRequest({ headers: { origin: "https://foreign.example.test" } }) : approveRequest({ headers: { origin: "https://foreign.example.test" } });
    await denial(await (kind === "upload" ? upload(request) : approve(request)), 403);
    expect(request.bodyUsed).toBe(false); noProviders();
  });
  it.each(["upload", "approve"] as const)("rejects %s without Origin before auth or body", async (kind) => {
    const request = kind === "upload" ? uploadRequest() : approveRequest(); request.headers.delete("origin");
    await denial(await (kind === "upload" ? upload(request) : approve(request)), 403);
    expect(request.bodyUsed).toBe(false); noProviders();
  });
  it.each(["upload", "approve"] as const)("rejects %s from cross-site or same-site fetch metadata", async (kind) => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const request = kind === "upload" ? uploadRequest({ headers: { "sec-fetch-site": site } }) : approveRequest({ headers: { "sec-fetch-site": site } });
      await denial(await (kind === "upload" ? upload(request) : approve(request)), 403);
      expect(request.bodyUsed).toBe(false);
    }
    noProviders();
  });
  it.each(["upload", "approve"] as const)("rejects %s URL host spoofing despite trusted Origin/proxy headers", async (kind) => {
    const options = { url: `https://foreign.example.test/api/client-intake/imports${kind === "approve" ? "/approve" : ""}`, headers: { "x-forwarded-host": "daycare.example.test", "x-forwarded-proto": "https" } };
    const request = kind === "upload" ? uploadRequest(options) : approveRequest(options);
    await denial(await (kind === "upload" ? upload(request) : approve(request)), 403);
    expect(request.bodyUsed).toBe(false); noProviders();
  });
  it.each(["application/jsonx", "application/json;broken", "application/json;charset=utf-8;", "text/plain", "application/json, text/plain"])("rejects pseudo JSON MIME %s before approve auth/body", async (mime) => {
    const request = approveRequest({ headers: { "content-type": mime } });
    await denial(await approve(request), 415); expect(request.bodyUsed).toBe(false); noProviders();
  });
  it.each(["multipart/form-data", "multipart/form-datax;boundary=test", "multipart/form-data;boundary=test;extra=value", "application/json"])("rejects malformed multipart MIME %s before upload auth/body", async (mime) => {
    const request = uploadRequest({ headers: { "content-type": mime } });
    await denial(await upload(request), 415); expect(request.bodyUsed).toBe(false); noProviders();
  });
  it.each(["upload", "approve"] as const)("rejects %s URL-supplied scope or unknown query before auth/body", async (kind) => {
    const path = `/api/client-intake/imports${kind === "approve" ? "/approve" : ""}`;
    for (const query of [`branchId=${actor.branchId}`, `organizationId=${actor.organizationId}`, `client=${client}`, "unexpected=SYNTHETIC_SECRET", `idempotency_key=${operation}`]) {
      const request = kind === "upload" ? uploadRequest({ url: `${origin}${path}?${query}` }) : approveRequest({ url: `${origin}${path}?${query}` });
      await denial(await (kind === "upload" ? upload(request) : approve(request)), 400);
      expect(request.bodyUsed).toBe(false);
    }
    noProviders();
  });
  it.each([`batch=${batch}&batch=${batch}`, `batch=${batch}&client=${client}&client=${client}`, `batch=${batch}&branchId=${actor.branchId}`, `batch=${batch}&unexpected=SYNTHETIC_SECRET`])("rejects ambiguous preview query %s before auth/RPC", async (query) => {
    await denial(await preview(new Request(`${origin}/api/client-intake/imports?${query}`)), 400); noProviders();
  });
  it.each(["content-length", "transfer-encoding"])("rejects preview body metadata %s before auth/RPC", async (header) => {
    await denial(await preview(new Request(`${origin}/api/client-intake/imports?batch=${batch}`, { headers: { [header]: header === "content-length" ? "1" : "chunked" } })), 400); noProviders();
  });
  it("rejects duplicate files after parsing but before lookup/reserve/archive/worker", async () => {
    const value = form(); value.append("file", new File([html], "second.html", { type: "text/html" }));
    await denial(await upload(uploadRequest({ value })), 400); noBusinessMutation();
  });
  it("rejects caller supplied parsed fields or source paths before lookup/reserve/archive", async () => {
    const value = form(); value.append("originalObjectReference", "SYNTHETIC_SECRET");
    await denial(await upload(uploadRequest({ value })), 400); noBusinessMutation();
  });
  it("preserves the approved Google AAL1 upload contract and server-owned scope", async () => {
    const request = uploadRequest(); const response = await upload(request);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("has_routine_intake_access", { target_org_id: actor.organizationId, target_branch_id: actor.branchId, target_action: "cms.stage", target_client_id: null });
    expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userClient: expect.any(Object), workerClient: expect.any(Object) }), { organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId, assuranceLevel: "aal1", recentAal2At: null }, expect.objectContaining({ fileName: "synthetic.html", mimeType: "text/html", bytes: expect.any(Uint8Array) }), operation);
    expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("allows legal parameterized JSON approval without adding MFA", async () => {
    const response = await approve(approveRequest({ headers: { "content-type": "application/json; charset=utf-8" } }));
    expect(response.status).toBe(200); expect((await response.json()).data.persisted).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("has_routine_intake_access", { target_org_id: actor.organizationId, target_branch_id: actor.branchId, target_action: "cms.commit", target_client_id: null });
    expect(mocks.rpc).toHaveBeenCalledWith("commit_cms_intake", expect.objectContaining({ p_org: actor.organizationId, p_branch: actor.branchId, p_operation: operation, p_batch: batch, p_expected_version: null, p_expected_client_version: null }));
    expect(mocks.recent).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("allows a bodyless exact preview query using read scope without mutation or MFA", async () => {
    const response = await preview(new Request(`${origin}/api/client-intake/imports?batch=${batch}`));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("cms_intake_preview", { p_org: actor.organizationId, p_branch: actor.branchId, p_batch: batch, p_client: null });
    expect(mocks.recent).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("retains live Google action denial even for a correctly sourced request", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await denial(await upload(uploadRequest()), 403); noBusinessMutation();
    expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("retains archival-not-ready fail-closed behavior before reading a legal multipart body", async () => {
    mocks.env.HTML_ARCHIVE_BUCKET = ""; const request = uploadRequest();
    await denial(await upload(request), 503); expect(request.bodyUsed).toBe(false); noBusinessMutation(); expect(mocks.admin).not.toHaveBeenCalled();
  });
});

function streamedRequest(path: "approve" | "upload", stream: ReadableStream<Uint8Array>, options: { signal?: AbortSignal; length?: string } = {}) {
  return new Request(`${origin}/api/client-intake/imports${path === "approve" ? "/approve" : ""}`, {
    method: "POST", signal: options.signal,
    headers: { origin, "sec-fetch-site": "same-origin", "idempotency-key": operation,
      "content-type": path === "approve" ? "application/json" : "multipart/form-data;boundary=synthetic-boundary",
      ...(options.length === undefined ? {} : { "content-length": options.length }) },
    body: stream, duplex: "half",
  } as RequestInit & { duplex: string });
}

describe("actual CMS streamed request boundaries", () => {
  it("bounds nonclosing approval JSON at ten seconds before authorization or business writes", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
    const request = streamedRequest("approve", stream);
    const pending = approve(request); const checked = pending.then(response => denial(response, 503));
    await vi.advanceTimersByTimeAsync(9999); noProviders(); expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await checked;
    expect(request.bodyUsed).toBe(true); expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0); noProviders();
  });
  it("explicitly cancels a pending approval body without later authorization or timers", async () => {
    vi.useFakeTimers(); const abort = new AbortController(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
    const request = streamedRequest("approve", stream, { signal: abort.signal });
    const remove = vi.spyOn(request.signal, "removeEventListener");
    const checked = approve(request).then(response => denial(response, 503));
    abort.abort(); await checked;
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function)); noProviders();
    await vi.advanceTimersByTimeAsync(10000); noProviders();
  });
  it("rejects actual 128 KiB approval bytes before EOF despite Content-Length 1", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(128 * 1024)); }, cancel }, { highWaterMark: 0 });
    const request = streamedRequest("approve", stream, { length: "1" });
    let finished = false;
    const checked = approve(request).then(async response => { await denial(response, 413); finished = true; });
    await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(true); await checked;
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0); noProviders();
  });
  it("rejects invalid UTF-8 approval bytes with a neutral error before auth", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([123, 34, 120, 34, 58, 34, 0xc0, 0xaf, 34, 125])); controller.close(); } });
    await denial(await approve(streamedRequest("approve", stream)), 400);
    expect(stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0); noProviders();
  });
  it("bounds a nonclosing multipart upload after actual Google AAL1 admission but before business lookup or archive", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
    const request = streamedRequest("upload", stream);
    const checked = upload(request).then(response => denial(response, 503));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("has_routine_intake_access", { target_org_id: actor.organizationId, target_branch_id: actor.branchId, target_action: "cms.stage", target_client_id: null });
    await vi.advanceTimersByTimeAsync(9999); expect(cancel).not.toHaveBeenCalled(); noBusinessMutation();
    await vi.advanceTimersByTimeAsync(1); await checked;
    expect(request.bodyUsed).toBe(true); expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0); noBusinessMutation(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("does not wait for an uncooperative overflow cancellation before returning FILE_TOO_LARGE", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 64 * 1024 + 1)); }, cancel }, { highWaterMark: 0 });
    let finished = false;
    const checked = upload(streamedRequest("upload", stream, { length: "1" })).then(async response => {
      expect(response.status).toBe(413); expect((await response.json()).errors[0].code).toBe("FILE_TOO_LARGE"); finished = true;
    });
    await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(true); await checked;
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0); noBusinessMutation();
    await vi.advanceTimersByTimeAsync(10000); noBusinessMutation();
  });
});
