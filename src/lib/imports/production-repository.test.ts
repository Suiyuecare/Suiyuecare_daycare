import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const factory = vi.hoisted(() => ({ configured: false, user: null as unknown, worker: null as unknown }));
vi.mock("@/lib/env", () => ({ env: { AWS_REGION: "ap-northeast-1", HTML_ARCHIVE_BUCKET: "synthetic-private-archive",
  AWS_KMS_KEY_ID: "arn:aws:kms:ap-northeast-1:123456789012:key/synthetic-only" },
  hasSupabaseAdminConfiguration: () => factory.configured, isDemoMode: () => false }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(async () => factory.user) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => factory.worker) }));

import { ImportError } from "./errors";
import { parseCentralCareHtml } from "./parser";
import { createProductionImportRepository, GeneralProductionImportRepository, type ProductionImportRepositoryDependencies } from "./production-repository";
import { importBatchRecordSchema } from "./production-model";
import { approveHtmlImport, getImportPreview, reparseHtmlImport, uploadHtmlImport } from "./service";
import { CURRENT_MAPPING_VERSION, type ImportActor, type ImportBatchRecord, type ImportUploadOperation,
  type ParsedHtmlImport } from "./types";
import type { StagingRpcClient } from "./trusted-staging";
import { validateHtmlImportFile } from "./validation";
import { wormArchiveInternals, type ArchivedObject } from "./worm-archive";
import { getImportRepository } from "./storage";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { revalidateGeneralImportActor } from "./reauth";

const now = new Date("2026-09-27T13:00:00.000Z");
const actor: ImportActor = { organizationId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001", userId: "30000000-0000-4000-8000-000000000001",
  assuranceLevel: "aal2", recentAal2At: now.toISOString() };
const file = (value = "合成資料，不代表正式個案") => ({ fileName: "synthetic.html", mimeType: "text/html",
  bytes: new TextEncoder().encode(`<!doctype html><meta charset=utf-8><h5>申請資訊</h5><table><tr><th>欄位</th><td>${value}</td></tr></table>`) });
const clone = <T>(value: T): T => structuredClone(value);

/** Synthetic providers implement the actual RPC/archive contracts. This is not
 * a database durability, hosted Auth or real S3 proof. The staging worker/parser
 * and upload -> preview -> reparse -> approve services are not mocked. */
function fixture(permission: ProductionImportRepositoryDependencies["permission"] = "upload") {
  const records = new Map<string, ImportBatchRecord>();
  const operations = new Map<string, { kind: string; request: unknown; result: ImportBatchRecord | ImportUploadOperation }>();
  const reservations = new Map<string, Record<string, unknown>>();
  const completions = new Map<string, { parsed: ParsedHtmlImport; receipt: Record<string, unknown>; archive: ArchivedObject }>();
  const objects = new Map<string, { reference: ArchivedObject; bytes: Uint8Array }>();
  const order: string[] = [];
  const override = new Map<string, unknown>();
  let granted = true;
  const reauthorize = vi.fn<ProductionImportRepositoryDependencies["reauthorize"]>(async () => {
    order.push("authority");
    if (!granted) throw new ImportError("IMPORT_PERMISSION_DENIED", "權限已撤銷", 403);
    return clone(actor);
  });
  const fail = (code: string) => ({ data: null, error: { code, message: "PRIVATE_UPSTREAM_DETAILS" } });
  const userRpc = vi.fn<StagingRpcClient["rpc"]>(async (name, args) => {
    order.push(name);
    if (override.has(name)) return { data: clone(override.get(name)), error: null };
    if (name === "reserve_import_upload") {
      const existing = [...reservations.values()].find(value => value.key === args.p_idempotency_key);
      if (existing) {
        const complete = completions.get(existing.reservation_id as string);
        const reservation = clone(existing); delete reservation.key;
        return { data: { ...reservation, replayed: true, status: complete ? "completed" : "queued",
          receipt: complete ? { ...complete.receipt, replayed: true } : null }, error: null };
      }
      const reservation = { reservation_id: randomUUID(), organization_id: actor.organizationId, branch_id: actor.branchId,
        actor_user_id: actor.userId, file_sha256: args.p_file_sha256, file_name: args.p_file_name, mime_type: args.p_mime_type,
        file_size_bytes: args.p_file_size_bytes, mapping_version: args.p_mapping_version,
        created_at: now.toISOString(), status: "queued", replayed: false, receipt: null };
      reservations.set(reservation.reservation_id, { ...reservation, key: args.p_idempotency_key });
      return { data: reservation, error: null };
    }
    expect(args.p_org).toBe(actor.organizationId); expect(args.p_branch).toBe(actor.branchId);
    const id = args.p_batch as string; const key = args.p_key as string;
    const prior = operations.get(key);
    switch (name) {
      case "general_import_repository_authorize":
        return granted ? { data: { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId,
          assuranceLevel: "aal2", verifiedAt: args.p_action === "read" ? null : now.toISOString() }, error: null } : fail("42501");
      case "general_import_repository_read": return { data: clone(records.get(id) ?? null), error: null };
      case "general_import_repository_find_hash": return { data: clone([...records.values()].find(value => value.fileSha256 === args.p_sha) ?? null), error: null };
      case "general_import_repository_find_upload":
        if (prior?.kind !== "upload") return prior ? fail("23505") : { data: null, error: null };
        return { data: { ...clone(prior.result as ImportUploadOperation), replayed: true }, error: null };
      case "general_import_repository_attach": {
        const reservation = reservations.get(args.p_reservation as string)!;
        const complete = completions.get(args.p_reservation as string)!;
        const batch: ImportBatchRecord = { id, organizationId: actor.organizationId, branchId: actor.branchId, version: 1,
          status: complete.parsed.fields.some(field => field.mappingState === "unknown") || complete.parsed.sections.some(section => !section.recognized)
            ? "mapping_required" : "ready_for_approval",
          fileName: reservation.file_name as string, mimeType: reservation.mime_type as string, charset: "utf-8",
          byteLength: reservation.file_size_bytes as number, fileSha256: reservation.file_sha256 as string,
          createdAt: reservation.created_at as string, createdBy: actor.userId, updatedAt: complete.receipt.completed_at as string,
          ...clone(complete.parsed), approval: null, operationKeys: { upload: key },
          originalObjectReference: JSON.stringify({ reservationId: args.p_reservation, archive: complete.archive }) };
        const result = { batch, request: { fileSha256: batch.fileSha256, fileName: batch.fileName, mimeType: batch.mimeType }, duplicate: false, replayed: false };
        records.set(id, clone(batch)); operations.set(key, { kind: "upload", request: result.request, result: clone(result) });
        return { data: result, error: null };
      }
      case "general_import_repository_duplicate": {
        const batch = records.get(id)!;
        const request = { fileSha256: args.p_file_sha256 as string, fileName: args.p_file_name as string, mimeType: args.p_mime_type as string };
        const result = { batch: clone(batch), request, duplicate: true, replayed: false };
        operations.set(key, { kind: "upload", request, result: clone(result) }); return { data: result, error: null };
      }
      case "general_import_repository_find_reparse":
        if (!prior) return { data: null, error: null };
        if (prior.kind !== "reparse" || JSON.stringify(prior.request) !== JSON.stringify([id, args.p_parsed, args.p_status])) return fail("23505");
        return { data: clone(prior.result), error: null };
      case "general_import_repository_reparse": {
        if (prior) return prior.kind === "reparse" ? { data: clone(prior.result), error: null } : fail("23505");
        const current = records.get(id)!;
        if (current.approval) return fail("55000");
        if (args.p_expected_version !== current.version) return fail("40001");
        const result: ImportBatchRecord = { ...clone(current), ...clone(args.p_parsed as ParsedHtmlImport), version: current.version + 1,
          status: args.p_status as ImportBatchRecord["status"], updatedAt: now.toISOString(),
          operationKeys: { ...current.operationKeys, [`reparse:${CURRENT_MAPPING_VERSION}`]: key } };
        records.set(id, clone(result)); operations.set(key, { kind: "reparse", request: [id, args.p_parsed, args.p_status], result: clone(result) });
        return { data: result, error: null };
      }
      case "general_import_repository_approve": {
        if (prior) return prior.kind === "approve" ? { data: clone(prior.result), error: null } : fail("23505");
        const current = records.get(id)!;
        if (current.approval) return fail("55000");
        if (args.p_expected_version !== current.version) return fail("40001");
        const result: ImportBatchRecord = { ...clone(current), version: current.version + 1, updatedAt: now.toISOString(),
          approval: { approvedAt: now.toISOString(), approvedBy: actor.userId, idempotencyKey: key, conflictResolutions: clone(args.p_resolutions as Record<string, string>) },
          operationKeys: { ...current.operationKeys, approve: key } };
        records.set(id, clone(result)); operations.set(key, { kind: "approve", request: [id, args.p_resolutions], result: clone(result) });
        return { data: result, error: null };
      }
      default: throw new Error("Unexpected RPC " + name);
    }
  });
  const archive = vi.fn<ProductionImportRepositoryDependencies["archive"]["archive"]>(async (scope, id, bytes, sha256, createdAt) => {
    order.push("archive");
    const retainUntil = new Date(createdAt); retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + 7);
    const reference = { key: wormArchiveInternals.objectKey(scope, id, sha256), versionId: "synthetic-worm-version",
      sha256, byteLength: bytes.byteLength, createdAt: createdAt.toISOString(), retainUntil: retainUntil.toISOString() };
    objects.set(id, { reference, bytes: Uint8Array.from(bytes) }); return clone(reference);
  });
  const read = vi.fn<ProductionImportRepositoryDependencies["archive"]["read"]>(async (scope, id, reference) => {
    order.push("read-archive"); expect(scope).toEqual({ organizationId: actor.organizationId, branchId: actor.branchId });
    expect(reference).toEqual(objects.get(id)!.reference); return Uint8Array.from(objects.get(id)!.bytes);
  });
  const workerRpc = vi.fn<StagingRpcClient["rpc"]>(async (name, args) => {
    order.push(name); expect(name).toBe("complete_import_upload");
    const reservation = reservations.get(args.p_reservation_id as string)!;
    const parsed = JSON.parse(args.p_parsed_payload as string) as ParsedHtmlImport;
    const receipt = { reservation_id: args.p_reservation_id, status: "completed", staging_only: true, formally_imported: false,
      file_sha256: reservation.file_sha256, content_fingerprint: parsed.contentFingerprint, mapping_version: parsed.mappingVersion,
      payload_sha256: createHash("sha256").update(args.p_parsed_payload as string).digest("hex"), section_count: parsed.sections.length,
      field_count: parsed.fields.length, completed_at: now.toISOString(), replayed: false };
    completions.set(args.p_reservation_id as string, { parsed, receipt, archive: clone(args.p_archive_reference as ArchivedObject) });
    return { data: receipt, error: null };
  });
  const deps: ProductionImportRepositoryDependencies = { actor: clone(actor), permission, userClient: { rpc: userRpc },
    workerClient: { rpc: workerRpc }, archive: { archive, read }, reauthorize };
  return { repository: new GeneralProductionImportRepository(deps), deps, records, operations, completions, objects, order,
    override, userRpc, workerRpc, archive, read, reauthorize, revoke: () => { granted = false; } };
}

function useActualAdmission(f: ReturnType<typeof fixture>) {
  f.reauthorize.mockImplementation(permission => revalidateGeneralImportActor(actor,
    permission === "preview" ? "read" : permission === "approve" ? "approve" : "write", f.deps.userClient));
}

beforeEach(() => {
  vi.useFakeTimers({ now, toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
  factory.configured = false; factory.user = null; factory.worker = null;
  vi.clearAllMocks();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("request-owned general import production repository", () => {
  it("runs actual services/parser/trusted staging through upload, preview, reparse and staging approval", async () => {
    const f = fixture(); const uploaded = await uploadHtmlImport(f.repository, actor, file(), "upload-original");
    expect(uploaded).toMatchObject({ duplicate: false, replayed: false, batch: { version: 1, status: "ready_for_approval" } });
    const stored = f.records.get(uploaded.batch.id)!;
    expect(importBatchRecordSchema.safeParse(stored).success).toBe(true);
    expect(stored).not.toHaveProperty("originalBytes");
    expect(f.order.indexOf("archive")).toBeLessThan(f.order.indexOf("complete_import_upload"));
    expect(f.order.indexOf("complete_import_upload")).toBeLessThan(f.order.indexOf("general_import_repository_attach"));
    const preview = await getImportPreview(f.repository, actor, uploaded.batch.id);
    expect(preview.batch.id).toBe(uploaded.batch.id); expect(preview).not.toHaveProperty("originalObjectReference");
    const reparse = await reparseHtmlImport(f.repository, actor, uploaded.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-original" });
    expect(reparse.version).toBe(2); expect(f.read).toHaveBeenCalledTimes(1);
    const approved = await approveHtmlImport(f.repository, actor, uploaded.batch.id, { conflictResolutions: {}, idempotencyKey: "approve-original" });
    expect(approved).toMatchObject({ staging_only: true, formally_imported: false, batch: { version: 3, status: "ready_for_approval" } });
    expect(await approveHtmlImport(f.repository, actor, uploaded.batch.id, { conflictResolutions: {}, idempotencyKey: "approve-original" })).toEqual(approved);
    expect(f.workerRpc).toHaveBeenCalledTimes(1);
  });

  it("returns original upload and reparse historical receipts after later versions, never current head", async () => {
    const f = fixture(); const upload = await uploadHtmlImport(f.repository, actor, file(), "upload-original");
    const first = await reparseHtmlImport(f.repository, actor, upload.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-original" });
    await reparseHtmlImport(f.repository, actor, upload.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-newer" });
    expect((await uploadHtmlImport(f.repository, actor, file(), "upload-original")).batch).toEqual(upload.batch);
    expect(await reparseHtmlImport(f.repository, actor, upload.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-original" })).toEqual(first);
    expect(f.records.get(upload.batch.id)!.version).toBe(3);
    expect(f.archive).toHaveBeenCalledTimes(1);
  });

  it("duplicate upload binds new file metadata/key but preserves original batch creator/key/snapshot", async () => {
    const f = fixture(); const first = await uploadHtmlImport(f.repository, actor, file(), "first-upload");
    const renamed = { ...file(), fileName: "renamed.htm", mimeType: "application/xhtml+xml" };
    const duplicate = await uploadHtmlImport(f.repository, actor, renamed, "duplicate-new-key");
    expect(duplicate).toMatchObject({ duplicate: true, replayed: false, batch: { ...first.batch, status: "duplicate" } });
    await reparseHtmlImport(f.repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "newer" });
    const replay = await uploadHtmlImport(f.repository, actor, renamed, "duplicate-new-key");
    expect(replay).toMatchObject({ duplicate: true, replayed: true, batch: { ...first.batch, status: "duplicate" } });
    expect(f.archive).toHaveBeenCalledTimes(1); expect(f.workerRpc).toHaveBeenCalledTimes(1);
    await expect(uploadHtmlImport(f.repository, actor, { ...renamed, fileName: "changed.html" }, "duplicate-new-key")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rejects different actor/scope before RPC and never treats denial as not-found", async () => {
    const f = fixture();
    await expect(f.repository.findById({ ...actor, branchId: randomUUID() }, randomUUID())).rejects.toMatchObject({ httpStatus: 403 });
    await expect(f.repository.findByOperationKey({ ...actor, userId: randomUUID() }, "key")).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.userRpc).not.toHaveBeenCalled();
    f.userRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "SECRET" } });
    await expect(f.repository.findById(actor, randomUUID())).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("read-only preview permits current AAL2 without recent reauth but writes do not", async () => {
    const f = fixture("preview"); f.reauthorize.mockResolvedValue({ ...actor, recentAal2At: null });
    expect(await f.repository.findById(actor, randomUUID())).toBeNull();
    await expect(f.repository.findByOperationKey(actor, "key")).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.userRpc).toHaveBeenCalledTimes(1);
  });

  it("post-RPC revocation prevents clinical disclosure", async () => {
    const f = fixture(); const uploaded = await uploadHtmlImport(f.repository, actor, file(), "upload");
    f.userRpc.mockImplementationOnce(async () => { f.revoke(); return { data: f.records.get(uploaded.batch.id), error: null }; });
    await expect(f.repository.findById(actor, uploaded.batch.id)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("post-archive revocation prevents bytes or parser/mutation from escaping", async () => {
    const f = fixture(); const uploaded = await uploadHtmlImport(f.repository, actor, file(), "upload");
    f.read.mockImplementationOnce(async () => { f.revoke(); return file().bytes; });
    await expect(reparseHtmlImport(f.repository, actor, uploaded.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse" })).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.userRpc.mock.calls.some(([name]) => name === "general_import_repository_reparse")).toBe(false);
  });

  it("post-archive version replacement refuses even exact immutable original bytes", async () => {
    const f = fixture(); const uploaded = await uploadHtmlImport(f.repository, actor, file(), "upload");
    f.read.mockImplementationOnce(async () => { const record = f.records.get(uploaded.batch.id)!; record.version += 1; return file().bytes; });
    await expect(f.repository.readOriginal(actor, uploaded.batch.id)).rejects.toMatchObject({ code: "IMPORT_VERSION_CONFLICT" });
  });

  it("reads the exact opaque reservation/version reference, not the public batch id or latest object", async () => {
    const f = fixture(); const uploaded = await uploadHtmlImport(f.repository, actor, file(), "upload");
    const record = f.records.get(uploaded.batch.id)!; const reference = JSON.parse(record.originalObjectReference!);
    expect(reference.reservationId).not.toBe(uploaded.batch.id);
    expect(await f.repository.readOriginal(actor, uploaded.batch.id)).toEqual(file().bytes);
    expect(f.read).toHaveBeenCalledWith({ organizationId: actor.organizationId, branchId: actor.branchId }, reference.reservationId, reference.archive);
    f.read.mockResolvedValueOnce(new TextEncoder().encode("different bytes"));
    await expect(f.repository.readOriginal(actor, uploaded.batch.id)).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_INVALID_RESPONSE" });
  });

  it.each(["organization", "id", "rawBytes", "objectScope", "unscannedStatus", "malformedDate"])("rejects malformed or misbound %s source receipt", async kind => {
    const f = fixture(); const uploaded = await uploadHtmlImport(f.repository, actor, file(), "upload");
    const record = clone(f.records.get(uploaded.batch.id)!) as ImportBatchRecord & { rawBytes?: unknown };
    if (kind === "organization") record.organizationId = randomUUID();
    if (kind === "id") record.id = randomUUID();
    if (kind === "rawBytes") record.rawBytes = [1, 2];
    if (kind === "objectScope") { const ref = JSON.parse(record.originalObjectReference!); ref.archive.key = ref.archive.key.replace(actor.branchId, randomUUID()); record.originalObjectReference = JSON.stringify(ref); }
    if (kind === "unscannedStatus") record.status = "imported";
    if (kind === "malformedDate") record.updatedAt = "2026-02-30T13:00:00Z";
    f.override.set("general_import_repository_read", record);
    await expect(f.repository.findById(actor, uploaded.batch.id)).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_INVALID_RESPONSE" });
  });

  it("does not accept current head with a different original reparse key as a historical receipt", async () => {
    const f = fixture(); const upload = await uploadHtmlImport(f.repository, actor, file(), "upload");
    const input = { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "original-reparse" } as const;
    await reparseHtmlImport(f.repository, actor, upload.batch.id, input);
    await reparseHtmlImport(f.repository, actor, upload.batch.id, { ...input, idempotencyKey: "newer-reparse" });
    f.override.set("general_import_repository_find_reparse", f.records.get(upload.batch.id));
    await expect(reparseHtmlImport(f.repository, actor, upload.batch.id, input)).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_INVALID_RESPONSE" });
  });

  it("malformed completed staging receipt cannot attach or invent a successful batch", async () => {
    const f = fixture(); f.workerRpc.mockResolvedValueOnce({ data: { status: "completed", reservation_id: randomUUID() }, error: null });
    await expect(uploadHtmlImport(f.repository, actor, file(), "original-key")).rejects.toMatchObject({ code: "IMPORT_STAGING_INVALID_RESPONSE" });
    expect(f.records.size).toBe(0); expect(f.userRpc.mock.calls.some(([name]) => name === "general_import_repository_attach")).toBe(false);
    expect(f.objects.size).toBe(1); // A WORM object is retained; no false rollback/deletion.
  });

  it("recovers an unknown attachment with the exact original key and completed reservation, without uploading or completing again", async () => {
    const f = fixture(); const dispatch = f.userRpc.getMockImplementation()!; let refused = false;
    f.userRpc.mockImplementation(async (name, args) => {
      if (name === "general_import_repository_attach" && !refused) { refused = true; throw new Error("UNKNOWN_COMMIT_OR_REPLY"); }
      return dispatch(name, args);
    });
    await expect(uploadHtmlImport(f.repository, actor, file(), "exact-original-key")).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_RESULT_UNKNOWN" });
    expect(f.records.size).toBe(0); expect(f.completions.size).toBe(1);
    const recovered = await uploadHtmlImport(f.repository, actor, file(), "exact-original-key");
    expect(recovered).toMatchObject({ batch: { version: 1 }, duplicate: false });
    expect(f.archive).toHaveBeenCalledTimes(1); expect(f.workerRpc).toHaveBeenCalledTimes(1);
    const reserveKeys = f.userRpc.mock.calls.filter(([name]) => name === "reserve_import_upload").map(([, args]) => args.p_idempotency_key);
    expect(reserveKeys).toHaveLength(2); expect(reserveKeys[0]).toBe(reserveKeys[1]);
  });

  it("revocation after archive prevents service worker completion", async () => {
    const f = fixture(); const original = f.archive.getMockImplementation()!;
    f.archive.mockImplementationOnce(async (...args) => { const result = await original(...args); f.revoke(); return result; });
    await expect(uploadHtmlImport(f.repository, actor, file(), "original-key")).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.workerRpc).not.toHaveBeenCalled(); expect(f.records.size).toBe(0); expect(f.objects.size).toBe(1);
  });

  it("actual admission revocation before reserve cannot create a reservation or archive", async () => {
    const f = fixture(); useActualAdmission(f); const authorize = f.reauthorize.getMockImplementation()!;
    f.reauthorize.mockImplementationOnce(async permission => { const result = await authorize(permission); f.revoke(); return result; });
    await expect(uploadHtmlImport(f.repository, actor, file(), "original-key")).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.userRpc.mock.calls.some(([name]) => name === "reserve_import_upload")).toBe(false);
    expect(f.archive).not.toHaveBeenCalled(); expect(f.workerRpc).not.toHaveBeenCalled();
  });

  it("actual admission withdrawal while reserve completes prevents the subsequent WORM upload", async () => {
    const f = fixture(); useActualAdmission(f); const dispatch = f.userRpc.getMockImplementation()!;
    f.userRpc.mockImplementation(async (name, args) => {
      const result = await dispatch(name, args); if (name === "reserve_import_upload") f.revoke(); return result;
    });
    await expect(uploadHtmlImport(f.repository, actor, file(), "original-key")).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.userRpc.mock.calls.filter(([name]) => name === "reserve_import_upload")).toHaveLength(1);
    expect(f.archive).not.toHaveBeenCalled(); expect(f.workerRpc).not.toHaveBeenCalled(); expect(f.objects.size).toBe(0);
  });

  it("actual admission withdrawal after the reserve post-fence is checked again immediately before archive", async () => {
    const f = fixture(); useActualAdmission(f); const dispatch = f.userRpc.getMockImplementation()!; let authorization = 0;
    f.userRpc.mockImplementation(async (name, args) => {
      const result = await dispatch(name, args);
      if (name === "general_import_repository_authorize" && ++authorization === 7) f.revoke();
      return result;
    });
    // upload service preflights find_upload/find_hash (four fences), then create,
    // reserve pre/post (three). The next archive pre-fence must catch withdrawal.
    await expect(uploadHtmlImport(f.repository, actor, file(), "original-key")).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.userRpc.mock.calls.filter(([name]) => name === "reserve_import_upload")).toHaveLength(1);
    expect(f.archive).not.toHaveBeenCalled(); expect(f.workerRpc).not.toHaveBeenCalled();
  });

  it("actual admission withdrawal during archive preserves WORM custody but cannot complete or attach", async () => {
    const f = fixture(); useActualAdmission(f); const archive = f.archive.getMockImplementation()!;
    f.archive.mockImplementationOnce(async (...args) => { const result = await archive(...args); f.revoke(); return result; });
    await expect(uploadHtmlImport(f.repository, actor, file(), "original-key")).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.objects.size).toBe(1); expect(f.workerRpc).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
    expect(f.userRpc.mock.calls.some(([name]) => name === "general_import_repository_attach")).toBe(false);
  });

  it("uncooperative archive deadline preserves original key and does not launch a late completion", async () => {
    const f = fixture(); let finish!: (value: ArchivedObject) => void;
    f.archive.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const result = uploadHtmlImport(f.repository, actor, file(), "exact-original-key");
    const expectation = expect(result).rejects.toMatchObject({ httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(20_001); await expectation;
    finish({ key: "late", versionId: "late", createdAt: now.toISOString(), retainUntil: "2033-09-27T13:00:00.000Z",
      sha256: validateHtmlImportFile(file()).sha256, byteLength: file().bytes.byteLength });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.workerRpc).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
    expect(f.userRpc.mock.calls.find(([name]) => name === "reserve_import_upload")?.[1].p_idempotency_key).toBeTruthy();
    expect(f.order.filter(name => name === "reserve_import_upload")).toHaveLength(1);
    await expect(f.repository.findById(actor, randomUUID())).rejects.toMatchObject({ httpStatus: 503 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uncooperative JSON/RPC result is bounded and late replies never disclose data", async () => {
    const f = fixture(); f.userRpc.mockImplementationOnce(() => new Promise(() => {}));
    const result = f.repository.findById(actor, randomUUID());
    const expectation = expect(result).rejects.toMatchObject({ httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(20_001); await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("strict receipt parsing that starves the timer still fails the monotonic overall deadline", async () => {
    const f = fixture(); const upload = await uploadHtmlImport(f.repository, actor, file(), "upload");
    const parse = importBatchRecordSchema.safeParse.bind(importBatchRecordSchema);
    vi.spyOn(importBatchRecordSchema, "safeParse").mockImplementationOnce(value => {
      const result = parse(value); vi.spyOn(performance, "now").mockReturnValue(20_001); return result;
    });
    await expect(f.repository.findById(actor, upload.batch.id)).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_RESULT_UNKNOWN", httpStatus: 503 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects caller-created completion attestations before any staging write", async () => {
    const f = fixture(); const validated = validateHtmlImportFile(file()); const parsed = parseCentralCareHtml(validated, CURRENT_MAPPING_VERSION);
    const record: ImportBatchRecord = { id: randomUUID(), organizationId: actor.organizationId, branchId: actor.branchId,
      version: 1, status: "ready_for_approval", fileName: validated.fileName, mimeType: validated.mimeType, charset: "utf-8",
      byteLength: validated.bytes.byteLength, fileSha256: validated.sha256, createdAt: now.toISOString(), createdBy: actor.userId,
      updatedAt: now.toISOString(), ...parsed, approval: null, originalBytes: validated.bytes, operationKeys: {},
      originalObjectReference: JSON.stringify({ reservationId: randomUUID(), archive: {} }) };
    await expect(f.repository.create(record, "key")).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_INVALID_RESPONSE" });
    expect(f.userRpc).not.toHaveBeenCalled(); expect(f.archive).not.toHaveBeenCalled();
  });

  it.each(["", " ", "a\nkey", "x".repeat(201)])("rejects invalid raw key before contacting providers", async key => {
    const f = fixture(); await expect(f.repository.findByOperationKey(actor, key)).rejects.toMatchObject({ httpStatus: 400 });
    expect(f.userRpc).not.toHaveBeenCalled();
  });

  it.each(["nonduplicateActor", "nonduplicateKey", "requestHash", "notReplay"])("rejects %s original upload receipt mismatch", async kind => {
    const f = fixture(); await uploadHtmlImport(f.repository, actor, file(), "original-key");
    const receipt = clone(f.operations.get("original-key")!.result as ImportUploadOperation); receipt.replayed = true;
    if (kind === "nonduplicateActor") receipt.batch.createdBy = randomUUID();
    if (kind === "nonduplicateKey") receipt.batch.operationKeys.upload = "different-key";
    if (kind === "requestHash") receipt.request.fileSha256 = "a".repeat(64);
    if (kind === "notReplay") receipt.replayed = false;
    f.override.set("general_import_repository_find_upload", receipt);
    await expect(f.repository.findByOperationKey(actor, "original-key")).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_INVALID_RESPONSE" });
  });

  it("reparse receipts bind the full original parsed payload, not only fingerprint", async () => {
    const f = fixture(); const upload = await uploadHtmlImport(f.repository, actor, file(), "upload");
    await reparseHtmlImport(f.repository, actor, upload.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse" });
    const receipt = clone(f.operations.get("reparse")!.result as ImportBatchRecord);
    receipt.fields[0].rawValue = "different source preserved under same fingerprint";
    f.override.set("general_import_repository_find_reparse", receipt);
    const parsed = parseCentralCareHtml(validateHtmlImportFile(file()), CURRENT_MAPPING_VERSION);
    await expect(f.repository.findReparseOperation(actor, upload.batch.id, parsed, "ready_for_approval", "reparse"))
      .rejects.toMatchObject({ code: "IMPORT_REPOSITORY_INVALID_RESPONSE" });
  });

  it("readOriginal always requires live recent reparse admission, including preview-owned repositories", async () => {
    const f = fixture("preview"); f.reauthorize.mockResolvedValue({ ...actor, recentAal2At: null });
    await expect(f.repository.readOriginal(actor, randomUUID())).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.userRpc).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });

  it("sanitizes upstream exceptions even when a dependency throws a forged ImportError", async () => {
    const f = fixture(); f.userRpc.mockRejectedValueOnce(new ImportError("PRIVATE_CODE", "PRIVATE_TOKEN_AND_PII", 400));
    await expect(f.repository.findById(actor, randomUUID())).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_RESULT_UNKNOWN", httpStatus: 503 });
  });

  it("does not leak the original even when a remote archive provider throws forged public errors", async () => {
    const f = fixture(); const upload = await uploadHtmlImport(f.repository, actor, file(), "upload");
    f.read.mockRejectedValueOnce(new ImportError("PRIVATE_CODE", "PRIVATE_OBJECT_AND_TOKEN", 400));
    await expect(f.repository.readOriginal(actor, upload.batch.id)).rejects.toMatchObject({ code: "IMPORT_REPOSITORY_RESULT_UNKNOWN", httpStatus: 503 });
  });

  it("accepts an archive-owned exact snapshot but returns independent original bytes", async () => {
    const f = fixture(); const upload = await uploadHtmlImport(f.repository, actor, file(), "upload");
    const source = file().bytes; f.read.mockResolvedValueOnce(source);
    const result = await f.repository.readOriginal(actor, upload.batch.id);
    source.fill(0); expect(result).toEqual(file().bytes);
  });
});

describe("actual request-scoped production factory", () => {
  const proof = () => ({ organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId,
    assuranceLevel: "aal2", verifiedAt: now.toISOString() });

  it("fails closed without production storage configuration, never registers a demo fallback", async () => {
    await expect(getImportRepository(actor, "upload")).rejects.toMatchObject({ code: "IMPORT_STORAGE_NOT_CONFIGURED", httpStatus: 503 });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    await expect(getImportRepository()).rejects.toMatchObject({ code: "IMPORT_STORAGE_NOT_CONFIGURED" });
  });

  it("uses actual narrow authorization RPC on each new request rather than trusting supplied actor/header", async () => {
    factory.configured = true;
    const rpc = vi.fn<StagingRpcClient["rpc"]>(async () => ({ data: proof(), error: null }));
    factory.user = { rpc }; factory.worker = { rpc: vi.fn() };
    const first = await createProductionImportRepository(actor, "upload");
    const second = await createProductionImportRepository(actor, "approve");
    expect(first).not.toBe(second); expect(first.kind).toBe("production"); expect(createServerSupabaseClient).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "general_import_repository_authorize", { p_org: actor.organizationId, p_branch: actor.branchId, p_action: "write" });
    expect(rpc).toHaveBeenNthCalledWith(2, "general_import_repository_authorize", { p_org: actor.organizationId, p_branch: actor.branchId, p_action: "approve" });
    rpc.mockResolvedValueOnce({ data: { ...proof(), actorUserId: randomUUID() }, error: null });
    await expect(createProductionImportRepository(actor, "upload")).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("preview actual authorization retains AAL2 read policy without demanding a recent write challenge", async () => {
    factory.configured = true;
    const rpc = vi.fn<StagingRpcClient["rpc"]>(async (name) => ({ data: name === "general_import_repository_read"
      ? null : { ...proof(), verifiedAt: null }, error: null }));
    factory.user = { rpc }; factory.worker = { rpc: vi.fn() };
    const repository = await createProductionImportRepository({ ...actor, recentAal2At: null }, "preview");
    expect(await repository.findById(actor, randomUUID())).toBeNull();
    expect(rpc.mock.calls.filter(([name]) => name === "general_import_repository_authorize").every(([, args]) => args.p_action === "read")).toBe(true);
  });

  it("actual live authority denial is not storage-not-found or fake recent success", async () => {
    factory.configured = true; factory.user = { rpc: vi.fn(async () => ({ data: null, error: { code: "42501", message: "PRIVATE_DENIAL" } })) };
    factory.worker = { rpc: vi.fn() };
    await expect(createProductionImportRepository(actor, "upload")).rejects.toMatchObject({ httpStatus: 403 });
  });
});
