import { describe, expect, it, vi } from "vitest";
import { DemoMemoryImportRepository } from "./memory-repository";
import { approveHtmlImport, reparseHtmlImport, uploadHtmlImport } from "./service";
import { CURRENT_MAPPING_VERSION, type ImportActor, type ImportBatchRecord } from "./types";
import { parseCentralCareHtml } from "./parser";
import { validateHtmlImportFile } from "./validation";

const actor: ImportActor = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  branchId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(),
};
const file = (value = "合成值") => ({ fileName: "synthetic.html", mimeType: "text/html",
  bytes: new TextEncoder().encode("<!doctype html><meta charset=utf-8><h5>申請資訊</h5><table><tr><th>欄位</th><td>" + value + "</td></tr></table>"),
});

describe("import operation and staging integrity", () => {
  it("binds upload keys to actor as well as organization and branch", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "same-key");
    const other = await uploadHtmlImport(repository, { ...actor, userId: "00000000-0000-4000-8000-000000000004" }, file("不同合成值"), "same-key");
    expect(other.replayed).toBe(false);
    expect(other.batch.id).not.toBe(first.batch.id);
    expect(repository.size).toBe(2);
    expect(await repository.findById({ ...actor, branchId: "00000000-0000-4000-8000-000000000099" }, first.batch.id)).toBeNull();
  });

  it("rejects changing bytes or file metadata while reusing an upload key", async () => {
    const repository = new DemoMemoryImportRepository();
    await uploadHtmlImport(repository, actor, file(), "upload");
    for (const changed of [file("不同值"), { ...file(), fileName: "renamed.html" }]) {
      await expect(uploadHtmlImport(repository, actor, changed, "upload")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    }
    expect(repository.size).toBe(1);
  });

  it("rejects reuse between upload, reparse and approval without mutation", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "one-key");
    await expect(reparseHtmlImport(repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "one-key" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(approveHtmlImport(repository, actor, first.batch.id, { conflictResolutions: {}, idempotencyKey: "one-key" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await repository.findById(actor, first.batch.id))?.version).toBe(1);
  });

  it("returns an immutable receipt on replay instead of a newer batch", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    const firstReparse = await reparseHtmlImport(repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-1" });
    await reparseHtmlImport(repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-2" });
    const uploadReplay = await uploadHtmlImport(repository, actor, file(), "upload");
    expect(uploadReplay.batch).toEqual(first.batch);
    const reparseReplay = await reparseHtmlImport(repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse-1" });
    expect(reparseReplay).toEqual(firstReparse);
    expect((await repository.findById(actor, first.batch.id))?.version).toBe(3);
  });

  it("cannot use a reparse key as a later upload receipt", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    await reparseHtmlImport(repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse" });
    await expect(uploadHtmlImport(repository, actor, file(), "reparse")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("binds reparse replay to the exact parsed payload", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    const parsed = parseCentralCareHtml(validateHtmlImportFile(file()), CURRENT_MAPPING_VERSION);
    await repository.replaceParsedResult(actor, first.batch.id, 1, parsed, "ready_for_approval", "reparse");
    await expect(repository.replaceParsedResult(actor, first.batch.id, 2, { ...parsed, warnings: [{ id: "warning-test", code: "changed", severity: "warning", message: "changed" }] }, "ready_for_approval", "reparse")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("staging approval freezes data and explicitly never reports a formal import", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    const input = { idempotencyKey: "approval", conflictResolutions: {} };
    const receipt = await approveHtmlImport(repository, actor, first.batch.id, input);
    expect(receipt).toMatchObject({ staging_only: true, formally_imported: false, batch: { version: 2, status: "ready_for_approval" } });
    expect(await approveHtmlImport(repository, actor, first.batch.id, input)).toEqual(receipt);
    await expect(approveHtmlImport(repository, actor, first.batch.id, { ...input, idempotencyKey: "different" })).rejects.toMatchObject({ code: "IMMUTABLE_IMPORT" });
    await expect(reparseHtmlImport(repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse" })).rejects.toMatchObject({ code: "IMMUTABLE_IMPORT" });
    expect((await repository.findById(actor, first.batch.id))?.version).toBe(2);
  });

  it("concurrent identical approval retries return one receipt despite different server call times", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    const approve = repository.approveAtomically.bind(repository);
    let call = 0;
    vi.spyOn(repository, "approveAtomically").mockImplementation(async (who, id, version, approval) =>
      approve(who, id, version, { ...approval, approvedAt: new Date(Date.parse(approval.approvedAt) + call++).toISOString() }));
    const receipts = await Promise.all(Array.from({ length: 8 }, () =>
      approveHtmlImport(repository, actor, first.batch.id, { idempotencyKey: "approve", conflictResolutions: {} })));
    for (const receipt of receipts) expect(receipt).toEqual(receipts[0]);
    expect((await repository.findById(actor, first.batch.id))?.version).toBe(2);
  });

  it("rejects changed approval decisions using an old key, including after approval", async () => {
    const repository = new DemoMemoryImportRepository();
    const conflictFile = file("甲</td></tr><tr><th>欄位</th><td>乙");
    const first = await uploadHtmlImport(repository, actor, conflictFile, "upload");
    const batch = (await repository.findById(actor, first.batch.id))!;
    const conflict = batch.conflicts[0]!;
    expect(conflict.candidates.length).toBe(2);
    await approveHtmlImport(repository, actor, batch.id, { idempotencyKey: "approve", conflictResolutions: { [conflict.id]: conflict.candidates[0]!.fieldId } });
    await expect(approveHtmlImport(repository, actor, batch.id, { idempotencyKey: "approve", conflictResolutions: { [conflict.id]: conflict.candidates[1]!.fieldId } })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await repository.findById(actor, batch.id))?.approval?.conflictResolutions[conflict.id]).toBe(conflict.candidates[0]!.fieldId);
  });

  it("does not silently accept unknown reviewer decisions", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    await expect(approveHtmlImport(repository, actor, first.batch.id, { idempotencyKey: "approve", conflictResolutions: { unexpected: "field" } })).rejects.toMatchObject({ code: "UNKNOWN_CONFLICT_RESOLUTION" });
    expect((await repository.findById(actor, first.batch.id))?.approval).toBeNull();
  });

  it("checks error warnings even if a stored status says ready", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    const parsed = parseCentralCareHtml(validateHtmlImportFile(file()), CURRENT_MAPPING_VERSION);
    parsed.warnings.push({ id: "fatal", code: "PARSE_ERROR", severity: "error", message: "合成錯誤" });
    await repository.replaceParsedResult(actor, first.batch.id, 1, parsed, "ready_for_approval", "replace");
    await expect(approveHtmlImport(repository, actor, first.batch.id, { idempotencyKey: "approve", conflictResolutions: {} })).rejects.toMatchObject({ code: "IMPORT_NOT_READY" });
    expect((await repository.findById(actor, first.batch.id))?.approval).toBeNull();
  });

  it("concurrent identical retries produce one batch and one immutable receipt", async () => {
    const repository = new DemoMemoryImportRepository();
    const results = await Promise.all(Array.from({ length: 8 }, () => uploadHtmlImport(repository, actor, file(), "one-upload")));
    expect(new Set(results.map((result) => result.batch.id)).size).toBe(1);
    expect(repository.size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
  });

  it("binds duplicate keys to the requested filename and returns the original duplicate snapshot", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "first");
    const renamed = { ...file(), fileName: "renamed.html" };
    const duplicate = await uploadHtmlImport(repository, actor, renamed, "duplicate");
    expect(duplicate).toMatchObject({ status: "duplicate", duplicate: true, replayed: false });
    expect(duplicate.batch.fileName).toBe("synthetic.html");
    await reparseHtmlImport(repository, actor, first.batch.id, { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse" });
    const replay = await uploadHtmlImport(repository, actor, renamed, "duplicate");
    expect(replay).toEqual({ ...duplicate, replayed: true });
    for (const changed of [file("different"), file(), { ...renamed, mimeType: "application/xhtml+xml" }]) {
      await expect(uploadHtmlImport(repository, actor, changed, "duplicate")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    }
    expect(repository.size).toBe(1);
    await expect(approveHtmlImport(repository, actor, first.batch.id, { idempotencyKey: "duplicate", conflictResolutions: {} })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("keeps duplicate receipts actor-scoped and safely deduplicates concurrent different keys", async () => {
    const repository = new DemoMemoryImportRepository();
    const results = await Promise.all(["a", "b", "c"].map((key) => uploadHtmlImport(repository, actor, file(), key)));
    expect(repository.size).toBe(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(2);
    const otherActor = { ...actor, userId: "00000000-0000-4000-8000-000000000004" };
    const other = await uploadHtmlImport(repository, otherActor, file("another"), "b");
    expect(other.duplicate).toBe(false);
    expect(repository.size).toBe(2);
  });

  it("replays an exact reparse after staging approval without reopening the frozen batch", async () => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    const input = { mappingVersion: CURRENT_MAPPING_VERSION, idempotencyKey: "reparse" } as const;
    const original = await reparseHtmlImport(repository, actor, first.batch.id, input);
    await approveHtmlImport(repository, actor, first.batch.id, { idempotencyKey: "approve", conflictResolutions: {} });
    const frozen = await repository.findById(actor, first.batch.id);
    expect(await reparseHtmlImport(repository, actor, first.batch.id, input)).toEqual(original);
    await expect(reparseHtmlImport(repository, actor, first.batch.id, { ...input, idempotencyKey: "new" })).rejects.toMatchObject({ code: "IMMUTABLE_IMPORT" });
    expect(await repository.findById(actor, first.batch.id)).toEqual(frozen);
    const other = await uploadHtmlImport(repository, actor, file("other"), "other-upload");
    await expect(reparseHtmlImport(repository, actor, other.batch.id, input)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  const tampering: Array<[string, (record: ImportBatchRecord) => void]> = [
    ["batch ID", (value) => { value.id = "00000000-0000-4000-8000-000000000099"; }],
    ["organization", (value) => { value.organizationId = "another"; }],
    ["branch", (value) => { value.branchId = "another"; }],
    ["version", (value) => { value.version += 1; }],
    ["author", (value) => { value.approval!.approvedBy = "another"; }],
    ["key", (value) => { value.approval!.idempotencyKey = "another"; }],
    ["decisions", (value) => { value.approval!.conflictResolutions = { unexpected: "field" }; }],
    ["timestamp", (value) => { value.approval!.approvedAt = "2020-01-01T00:00:00Z"; }],
    ["source content", (value) => { value.fields[0]!.normalizedValue = "changed"; }],
    ["operation keys", (value) => { value.operationKeys.upload = "changed"; }],
  ];
  it.each(tampering)("does not report approval success for a substituted %s", async (_label, change) => {
    const repository = new DemoMemoryImportRepository();
    const first = await uploadHtmlImport(repository, actor, file(), "upload");
    const approve = repository.approveAtomically.bind(repository);
    vi.spyOn(repository, "approveAtomically").mockImplementation(async (...args) => {
      const result = await approve(...args);
      change(result);
      return result;
    });
    await expect(approveHtmlImport(repository, actor, first.batch.id, { idempotencyKey: "approve", conflictResolutions: {} })).rejects.toMatchObject({ code: "INVALID_STAGING_RECEIPT" });
  });
});
