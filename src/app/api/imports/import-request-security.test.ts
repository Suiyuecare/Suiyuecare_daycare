import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ demo: true, context: vi.fn(), recent: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => state.demo, hasSupabaseConfiguration: () => true, hasSupabaseAdminConfiguration: () => false,
  env: { NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://daycare.example.test" } }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: state.context, hasRecentAal2: state.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: async () => ({
  data: await state.recent() ? { organizationId: "00000000-0000-4000-8000-000000000001",
    branchId: "00000000-0000-4000-8000-000000000002", actorUserId: "00000000-0000-4000-8000-000000000003", verifiedAt: new Date().toISOString() } : null,
  error: null,
}) }) }));

// Actual route handlers, request admission, static parser, services and memory
// repository are retained. Only external configuration/auth providers are mocked.
import { POST as upload } from "./html/route";
import { GET as preview } from "./[id]/preview/route";
import { POST as approve } from "./[id]/approve/route";
import { POST as reparse } from "./[id]/reparse/route";
import { CURRENT_MAPPING_VERSION } from "@/lib/imports/types";

const origin = "https://daycare.example.test";
const id = "a5100000-0000-4000-8000-000000000001";
const actor = { organizationId: "00000000-0000-4000-8000-000000000001", branchId: "00000000-0000-4000-8000-000000000002", userId: "00000000-0000-4000-8000-000000000003", scopes: ["imports.manage", "imports.approve"], assuranceLevel: "aal2" };
const html = "<!doctype html><meta charset=utf-8><h5>需要服務者基本資料</h5><table><tr><th>個案姓名</th><td>合成一般匯入姓名</td></tr></table>";
const params = (batchId: string) => ({ params: Promise.resolve({ id: batchId }) });
type JsonAction = "approve" | "reparse";
const handler = (action: JsonAction) => action === "approve" ? approve : reparse;
function form(key = "original-upload") {
  const value = new FormData();
  value.append("file", new File([html], "synthetic.html", { type: "text/html" }));
  value.append("idempotency_key", key);
  return value;
}
function uploadRequest(options: { value?: FormData; url?: string; headers?: HeadersInit; key?: string } = {}) {
  const request = new Request(options.url ?? `${origin}/api/imports/html`, {
    method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "idempotency-key": options.key ?? "original-upload" }, body: options.value ?? form(options.key),
  });
  for (const [key, value] of new Headers(options.headers)) request.headers.set(key, value);
  return request;
}
function jsonRequest(action: JsonAction, options: { batchId?: string; value?: unknown; bytes?: Uint8Array; url?: string; headers?: HeadersInit; key?: string } = {}) {
  return new Request(options.url ?? `${origin}/api/imports/${options.batchId ?? id}/${action}`, {
    method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "idempotency-key": options.key ?? action, ...Object.fromEntries(new Headers(options.headers)) },
    body: options.bytes ? Buffer.from(options.bytes) : JSON.stringify("value" in options ? options.value : { idempotency_key: options.key ?? action }),
  });
}
async function expectDenial(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text(); const envelope = JSON.parse(text);
  expect(envelope.data).toBeNull();
  if (code) expect(envelope.errors[0].code).toBe(code);
  expect(text).not.toMatch(/SYNTHETIC_SECRET|合成一般匯入姓名|stack/u);
}
function noAuth() { expect(state.context).not.toHaveBeenCalled(); expect(state.recent).not.toHaveBeenCalled(); }
async function createBatch() {
  const response = await upload(uploadRequest()); expect(response.status).toBe(201);
  return (await response.json()).data.batch.id as string;
}
async function readBatch(batchId: string) {
  const response = await preview(new Request(`${origin}/api/imports/${batchId}/preview`), params(batchId));
  expect(response.status).toBe(200); return (await response.json()).data;
}
beforeEach(() => {
  state.demo = true; vi.clearAllMocks();
  state.context.mockResolvedValue(actor); state.recent.mockResolvedValue(true);
  delete (globalThis as { __daycareDemoImportRepository?: unknown }).__daycareDemoImportRepository;
});

describe("actual general import request security", () => {
  it.each(["upload", "approve", "reparse"] as const)("rejects %s without Origin before auth and body", async action => {
    state.demo = false;
    const request = action === "upload" ? uploadRequest() : jsonRequest(action);
    request.headers.delete("origin");
    await expectDenial(await (action === "upload" ? upload(request) : handler(action)(request, params(id))), 403);
    expect(request.bodyUsed).toBe(false); noAuth();
  });
  it.each(["upload", "approve", "reparse"] as const)("rejects %s foreign Origin/host/site before auth and body", async action => {
    state.demo = false;
    const variants: Array<{ url?: string; headers?: Record<string, string> }> = [
      { headers: { origin: "https://foreign.example.test" } },
      { headers: { "sec-fetch-site": "same-site" } },
      { headers: { "sec-fetch-site": "cross-site" } },
      { url: `https://foreign.example.test/api/imports/${action}`, headers: { "x-forwarded-host": "daycare.example.test", "x-forwarded-proto": "https" } },
    ];
    for (const options of variants) {
      const request = action === "upload" ? uploadRequest(options) : jsonRequest(action, options);
      await expectDenial(await (action === "upload" ? upload(request) : handler(action)(request, params(id))), 403);
      expect(request.bodyUsed).toBe(false);
    }
    noAuth();
  });
  it.each(["approve", "reparse"] as const)("rejects %s pseudo JSON MIME before auth/body", async action => {
    state.demo = false;
    for (const mime of ["application/jsonx", "application/json;broken", "application/json;charset=utf-8;", "text/plain", "application/json,application/json"]) {
      const request = jsonRequest(action, { headers: { "content-type": mime } });
      await expectDenial(await handler(action)(request, params(id)), 415); expect(request.bodyUsed).toBe(false);
    }
    noAuth();
  });
  it.each(["multipart/form-data", "multipart/form-datax;boundary=test", "multipart/form-data;boundary=test;extra=value", "application/json"])("rejects invalid upload MIME %s before auth/body", async mime => {
    state.demo = false;
    const request = uploadRequest({ headers: { "content-type": mime } });
    await expectDenial(await upload(request), 415); expect(request.bodyUsed).toBe(false); noAuth();
  });
  it.each(["upload", "approve", "reparse"] as const)("rejects %s URL query scope before auth/body", async action => {
    state.demo = false;
    for (const query of ["unexpected=SYNTHETIC_SECRET", `branchId=${actor.branchId}`, "key=one&key=two"]) {
      const options = { url: `${origin}/api/imports/${action}?${query}` };
      const request = action === "upload" ? uploadRequest(options) : jsonRequest(action, options);
      await expectDenial(await (action === "upload" ? upload(request) : handler(action)(request, params(id))), 400);
      expect(request.bodyUsed).toBe(false);
    }
    noAuth();
  });
  it.each(["unexpected=SYNTHETIC_SECRET", "branchId=wrong", "key=one&key=two", "id=one&id=one"])("rejects private preview query %s before auth", async query => {
    state.demo = false;
    await expectDenial(await preview(new Request(`${origin}/api/imports/${id}/preview?${query}`), params(id)), 400); noAuth();
  });
  it.each(["1", "00", "bad", "-1"])("rejects preview Content-Length %s before auth", async length => {
    state.demo = false;
    await expectDenial(await preview(new Request(`${origin}/api/imports/${id}/preview`, { headers: { "content-length": length } }), params(id)), 400); noAuth();
  });
  it("rejects preview transfer encoding before auth", async () => {
    state.demo = false;
    await expectDenial(await preview(new Request(`${origin}/api/imports/${id}/preview`, { headers: { "transfer-encoding": "chunked" } }), params(id)), 400); noAuth();
  });
  it.each(["preview", "approve", "reparse"] as const)("validates exact %s batch UUID before auth/body", async action => {
    state.demo = false;
    for (const bad of ["-".repeat(36), "a".repeat(36), "a5100000-0000-0000-0000-000000000001", "a5100000-0000-9000-8000-000000000001", "a5100000-0000-4000-7000-000000000001"]) {
      const request = action === "preview" ? new Request(`${origin}/api/imports/${bad}/preview`) : jsonRequest(action, { batchId: bad });
      await expectDenial(await (action === "preview" ? preview(request, params(bad)) : handler(action)(request, params(bad))), 400, "INVALID_IMPORT_ID");
      expect(request.bodyUsed).toBe(false);
    }
    noAuth();
  });
  it.each(["approve", "reparse"] as const)("bounds actual streamed %s JSON bytes even with a lying Content-Length", async action => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"idempotency_key":"')); controller.enqueue(new Uint8Array(64 * 1024)); }, cancel }, { highWaterMark: 0 });
    const request = new Request(`${origin}/api/imports/${id}/${action}`, { method: "POST", headers: { origin, "content-type": "application/json", "content-length": "1", "idempotency-key": action }, body: stream, duplex: "half" } as RequestInit & { duplex: string });
    await expectDenial(await handler(action)(request, params(id)), 413, "REQUEST_TOO_LARGE");
    expect(request.bodyUsed).toBe(true); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["approve", "reparse"] as const)("rejects %s invalid UTF-8 rather than replacing source bytes", async action => {
    const request = jsonRequest(action, { bytes: Uint8Array.from([123, 34, 120, 34, 58, 34, 0xc0, 0xaf, 34, 125]) });
    await expectDenial(await handler(action)(request, params(id)), 400, "INVALID_JSON"); expect(request.bodyUsed).toBe(true);
  });
  it.each(["approve", "reparse"] as const)("rejects %s nonobject JSON shapes", async action => {
    for (const value of [null, [], true, 1, "SYNTHETIC_SECRET"]) await expectDenial(await handler(action)(jsonRequest(action, { value }), params(id)), 400, "INVALID_JSON");
  });
  it.each(["approve", "reparse"] as const)("rejects %s unknown JSON fields without changing existing staging", async action => {
    const batchId = await createBatch(); const before = await readBatch(batchId);
    await expectDenial(await handler(action)(jsonRequest(action, { batchId, value: { idempotency_key: action, originalObjectReference: "SYNTHETIC_SECRET" } }), params(batchId)), 400, "INVALID_IMPORT_BODY");
    expect(await readBatch(batchId)).toEqual(before);
  });
  it("does not silently default an explicit null mapping version", async () => {
    const batchId = await createBatch(); const before = await readBatch(batchId);
    await expectDenial(await reparse(jsonRequest("reparse", { batchId, value: { idempotency_key: "reparse", mapping_version: null } }), params(batchId)), 400, "INVALID_IMPORT_BODY");
    expect(await readBatch(batchId)).toEqual(before);
  });
  it("does not reflect an invalid conflict key or value in its structured error", async () => {
    const batchId = await createBatch(); const before = await readBatch(batchId);
    const response = await approve(jsonRequest("approve", { batchId, value: {
      idempotency_key: "approve", conflict_resolutions: { SYNTHETIC_SECRET: "fieldinvalid" },
    } }), params(batchId));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text(); const envelope = JSON.parse(text);
    expect(envelope.data).toBeNull();
    expect(envelope.errors).toEqual([{ code: "INVALID_CONFLICT_RESOLUTIONS", message: expect.any(String), field: "conflict_resolutions" }]);
    expect(text).not.toContain("SYNTHETIC_SECRET"); expect(text).not.toContain("fieldinvalid");
    expect(await readBatch(batchId)).toEqual(before);
  });
  it.each(["duplicate-file", "duplicate-key", "unknown-field", "file-key"] as const)("rejects multipart %s before altering staging", async kind => {
    const batchId = await createBatch(); const before = await readBatch(batchId); const value = form("another-upload");
    if (kind === "duplicate-file") value.append("file", new File([html], "second.html", { type: "text/html" }));
    if (kind === "duplicate-key") value.append("idempotency_key", "another-upload");
    if (kind === "unknown-field") value.append("parsed_payload", "SYNTHETIC_SECRET");
    if (kind === "file-key") value.set("idempotency_key", new File(["SYNTHETIC_SECRET"], "key.txt"));
    await expectDenial(await upload(uploadRequest({ value, key: "another-upload" })), kind === "file-key" ? 409 : 400);
    expect(await readBatch(batchId)).toEqual(before);
  });
  it.each(["upload", "approve", "reparse"] as const)("rejects %s conflicting header/body idempotency key with no change", async action => {
    const batchId = await createBatch(); const before = await readBatch(batchId);
    const request = action === "upload" ? uploadRequest({ value: form("different-body"), key: "different-header" }) : jsonRequest(action, { batchId, key: "different-header", value: { idempotency_key: "different-body" } });
    await expectDenial(await (action === "upload" ? upload(request) : handler(action)(request, params(batchId))), 409, "IDEMPOTENCY_KEY_REUSED");
    expect(await readBatch(batchId)).toEqual(before);
  });
  it("keeps production missing durable storage as 503 before streamed body consumption", async () => {
    state.demo = false; const request = uploadRequest();
    await expectDenial(await upload(request), 503, "IMPORT_STORAGE_NOT_CONFIGURED");
    expect(state.context).toHaveBeenCalledOnce(); expect(state.recent).toHaveBeenCalledOnce(); expect(request.bodyUsed).toBe(false);
  });
  it("completes same-origin demo upload, masked preview, reparse and staging-only approval", async () => {
    const batchId = await createBatch(); const initial = await readBatch(batchId);
    expect(JSON.stringify(initial)).not.toContain("合成一般匯入姓名");
    const reparsed = await reparse(jsonRequest("reparse", { batchId, value: { idempotency_key: "reparse", mapping_version: CURRENT_MAPPING_VERSION }, headers: { "content-type": "application/json; charset=utf-8" } }), params(batchId));
    expect(reparsed.status).toBe(200); expect((await reparsed.json()).data.version).toBe(2);
    const approved = await approve(jsonRequest("approve", { batchId }), params(batchId));
    expect(approved.status).toBe(200); expect(approved.headers.get("cache-control")).toContain("no-store");
    const receipt = (await approved.json()).data;
    expect(receipt).toMatchObject({ staging_only: true, formally_imported: false, batch: { id: batchId, version: 3, status: "ready_for_approval" } });
    const replay = await approve(jsonRequest("approve", { batchId }), params(batchId));
    expect(replay.status).toBe(200); expect((await replay.json()).data).toEqual(receipt); noAuth();
  });
});
