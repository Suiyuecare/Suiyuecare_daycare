import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  stage: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/imports/http", () => ({ authorizeImportRequest: mocks.authorize }));
vi.mock("@/lib/jubo-import/trusted-pair-runtime", () => ({
  JuboStageRuntimeError: class JuboStageRuntimeError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
  resolveJuboStageRuntimeConfiguration: mocks.resolve,
  stageApprovedJuboPairForCurrentStaff: mocks.stage,
}));

import { JuboStageError } from "@/lib/jubo-import/trusted-pair-staging";
import { ImportError } from "@/lib/imports/errors";
import { JuboXlsxReadError } from "@/lib/jubo-import/xlsx-reader";
import { JuboStageRuntimeError } from "@/lib/jubo-import/trusted-pair-runtime";
import { POST, preferredRegion, runtime } from "./route";

const ORIGIN = "https://daycare.example.invalid";
const URL = `${ORIGIN}/api/jubo-source-stage`;
const KEY = "fb010000-0000-4000-8000-000000000001";
const OPERATION = "fb020000-0000-4000-8000-000000000001";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REVIEW = "已人工核對合成來源第 29 列屬非個案註記";
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function bytes(size = 32) {
  const result = new Uint8Array(size);
  result[0] = 0x50;
  result[1] = 0x4b;
  return result;
}

function form(options: { master?: File; monthlySummary?: File; reason?: string; extra?: boolean;
  duplicateMaster?: boolean } = {}) {
  const result = new FormData();
  result.append("master", options.master ?? new File([bytes()], "synthetic-master.xlsx", { type: XLSX }));
  result.append("monthlySummary", options.monthlySummary ?? new File([bytes()], "synthetic-monthly.xlsx", { type: XLSX }));
  result.append("footerReviewReason", options.reason ?? REVIEW);
  if (options.extra) result.append("actorUserId", "not-authoritative");
  if (options.duplicateMaster) result.append("master", new File([bytes()], "duplicate.xlsx", { type: XLSX }));
  return result;
}

function request(body: BodyInit = form(), headers: Record<string, string> = {}, url = URL) {
  return new Request(url, { method: "POST", body,
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "idempotency-key": KEY, ...headers } });
}

function receipt(replayed = false) {
  return { operationId: OPERATION, verifiedPairId: KEY, masterBatchId: KEY,
    monthlyBatchId: KEY, masterSha256: "a".repeat(64), monthlySha256: "b".repeat(64),
    masterRows: 23, monthlyRows: 17, masterNonRecordRows: 1,
    sourceStatus: { active: 17, suspended: 1, closed: 5, privatePerson: "PRIVATE_PERSON" },
    parserVersion: "jubo-xlsx-reader-202610-v1", stagingOnly: true,
    formallyImported: false, replayed, privateCell: "PRIVATE_CELL" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_ORIGIN", ORIGIN);
  mocks.resolve.mockReturnValue({ organizationId: KEY, branchId: KEY });
  mocks.stage.mockResolvedValue(receipt());
  mocks.authorize.mockResolvedValue({ organizationId: KEY, branchId: KEY, userId: KEY });
});
afterEach(() => vi.unstubAllEnvs());

describe("JUBO 23/17 source-pair staging boundary", () => {
  it("is a Tokyo Node.js, non-cached POST and returns only an aggregate staging receipt", async () => {
    expect(runtime).toBe("nodejs");
    expect(preferredRegion).toBe("hnd1");
    const uploadRequest = request();
    expect(uploadRequest.headers.get("idempotency-key")).toBe(KEY);
    const response = await POST(uploadRequest);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "approve");
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "upload");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    const result = await response.json();
    expect(result).toMatchObject({ status: "ok", requestId: expect.any(String), data: {
      operationId: OPERATION, masterRows: 23, monthlyRows: 17,
      sourceStatus: { active: 17, suspended: 1, closed: 5 },
      stagingOnly: true, formallyImported: false, replayed: false,
    } });
    expect(Object.keys(result.data).sort()).toEqual([
      "formallyImported", "masterNonRecordRows", "masterRows", "monthlyRows",
      "operationId", "replayed", "sourceStatus", "stagingOnly",
    ]);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/PRIVATE_|synthetic-|masterSha256|monthlySha256|verifiedPairId|parserVersion/u);
    expect(mocks.stage).toHaveBeenCalledWith({ idempotencyKey: KEY, footerReviewReason: REVIEW,
      master: { kind: "master", fileName: "synthetic-master.xlsx", mimeType: XLSX, bytes: bytes() },
      monthlySummary: { kind: "monthlySummary", fileName: "synthetic-monthly.xlsx", mimeType: XLSX, bytes: bytes() },
    });
  });

  it("treats an exact-key replay as the same successful operation", async () => {
    mocks.stage.mockResolvedValue(receipt(true));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.replayed).toBe(true);
  });

  it("fails closed before consuming multipart bytes when the production switch is off", async () => {
    mocks.resolve.mockImplementation(() => { throw new JuboStageRuntimeError("DISABLED"); });
    const response = await POST(request(new Uint8Array([1, 2, 3]), { "content-type": "application/octet-stream" }));
    expect(response.status).toBe(503);
    expect((await response.json()).errors[0].code).toBe("JUBO_STAGE_DISABLED");
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("rejects unadmitted staff before reading the multipart body", async () => {
    mocks.authorize.mockRejectedValueOnce(new ImportError("RECENT_AAL2_REQUIRED", "需要近期驗證。", 403));
    const response = await POST(request(new Uint8Array([1, 2, 3]), { "content-type": "application/octet-stream" }));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe("RECENT_AAL2_REQUIRED");
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("rejects missing imports.manage before reading the multipart body", async () => {
    mocks.authorize.mockResolvedValueOnce({ organizationId: KEY, branchId: KEY, userId: KEY });
    mocks.authorize.mockRejectedValueOnce(new ImportError("IMPORT_PERMISSION_DENIED", "無匯入管理權限。", 403));
    const response = await POST(request(new Uint8Array([1, 2, 3]),
      { "content-type": "application/octet-stream" }));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe("IMPORT_PERMISSION_DENIED");
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("rejects another organization's or branch's staff before reading the multipart body", async () => {
    const other = "fb030000-0000-4000-8000-000000000001";
    for (const actor of [
      { organizationId: other, branchId: KEY },
      { organizationId: KEY, branchId: other },
    ]) {
      mocks.authorize.mockResolvedValueOnce(actor);
      const response = await POST(request(new Uint8Array([1, 2, 3]),
        { "content-type": "application/octet-stream" }));
      expect(response.status).toBe(403);
      expect((await response.json()).errors[0].code).toBe("JUBO_STAGE_SCOPE_DENIED");
    }
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it.each([
    [{ origin: "https://evil.example.invalid" }, URL],
    [{ origin: "null" }, URL],
    [{ "sec-fetch-site": "same-site" }, URL],
    [{ origin: "" }, URL],
    [{}, "https://evil.example.invalid/api/jubo-source-stage"],
    [{}, `${URL}?actor=someone`],
  ])("rejects cross-origin or modified-target requests before enabling a stage", async (headers, url) => {
    const response = await POST(request(form(), headers, url));
    expect(response.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("requires a canonical UUID key and exact multipart encoding", async () => {
    expect((await POST(request(form(), { "idempotency-key": "bad" }))).status).toBe(400);
    expect((await POST(request("{}", { "content-type": "application/json" }))).status).toBe(400);
    expect((await POST(request(form(), { "content-encoding": "gzip" }))).status).toBe(400);
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("rejects declared and actual request overflow, even without Content-Length", async () => {
    const declared = await POST(request(form(), { "content-length": String(MAX_REQUEST_BYTES + 1) }));
    expect(declared.status).toBe(413);
    const streamed = await POST(request(new Uint8Array(MAX_REQUEST_BYTES + 1),
      { "content-type": "multipart/form-data; boundary=synthetic" }));
    expect(streamed.status).toBe(413);
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("rejects malformed files, duplicate/extra fields and absent human review", async () => {
    const badFile = new File([bytes()], "wrong.txt", { type: XLSX });
    const badMime = new File([bytes()], "wrong.xlsx", { type: "application/octet-stream" });
    const escapedName = new File([bytes()], "../escape.xlsx", { type: XLSX });
    const bidiName = new File([bytes()], "synthetic\u202e.xlsx", { type: XLSX });
    const missingMonthly = form();
    missingMonthly.delete("monthlySummary");
    for (const candidate of [
      form({ master: badFile }), form({ monthlySummary: badMime }),
      form({ master: escapedName }), form({ master: bidiName }), missingMonthly,
      form({ extra: true }), form({ duplicateMaster: true }), form({ reason: "短" }),
    ]) expect((await POST(request(candidate))).status).toBe(400);
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("enforces an independent per-file limit below the request limit", async () => {
    const large = new File([bytes(1536 * 1024 + 1)], "synthetic-master.xlsx", { type: XLSX });
    const response = await POST(request(form({ master: large })));
    expect(response.status).toBe(413);
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("never turns invalid source, conflicting key or unknown COMMIT into a client record", async () => {
    for (const [error, status, code] of [
      [new JuboXlsxReadError("HASH_MISMATCH"), 422, "JUBO_STAGE_SOURCE_REJECTED"],
      [new JuboStageError("UNVERIFIED_ACTOR"), 403, "JUBO_STAGE_AUTH_DENIED"],
      [new JuboStageError("IDEMPOTENCY_CONFLICT"), 409, "JUBO_STAGE_CONFLICT"],
      [new JuboStageError("STAGING_RESULT_UNKNOWN"), 503, "JUBO_STAGE_RESULT_UNKNOWN"],
    ] as const) {
      mocks.stage.mockRejectedValueOnce(error);
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect((await response.json()).errors[0].code).toBe(code);
    }
  });

  it("rejects an inconsistent internal receipt and never echoes unknown exceptions or PII", async () => {
    mocks.stage.mockResolvedValueOnce({ ...receipt(), formallyImported: true });
    const invalid = await POST(request());
    expect(invalid.status).toBe(502);
    expect(JSON.stringify(await invalid.json())).not.toContain("PRIVATE_PERSON");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stage.mockRejectedValueOnce(new Error("PRIVATE_IDENTITY_NUMBER"));
    const unknown = await POST(request());
    expect(unknown.status).toBe(503);
    expect(await unknown.text()).not.toContain("PRIVATE_IDENTITY_NUMBER");
    expect(log).toHaveBeenCalledWith("JUBO_STAGE_UNEXPECTED", expect.any(String));
    log.mockRestore();
  });
});
