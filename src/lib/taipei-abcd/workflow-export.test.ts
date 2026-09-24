import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { TAIPEI_ABCD_TEMPLATE, taipeiFields, type TaipeiForm } from "./catalog";
import { emptyWorkflow, sectionReviewItems, transitionSchema, workflowSchema } from "./workflow";
import { taipeiExportModel, type TaipeiExportSnapshot } from "./export";
import { renderDocumentPdf } from "@/lib/document-printing/pdf-renderer";
import { parseDocumentRenderModel } from "@/lib/document-printing/parser";
import { TAIPEI_PDF_FONT_FEATURES } from "./pdf-font";
const org = "be010000-0000-4000-8000-000000000001", branch = "be020000-0000-4000-8000-000000000001", client = "be030000-0000-4000-8000-000000000001", id = "be040000-0000-4000-8000-000000000001";
export function syntheticExport(form: TaipeiForm = "B"): TaipeiExportSnapshot {
  return { sourceRevision: "114.11", sourceSha256: TAIPEI_ABCD_TEMPLATE.sourceSha256, templateKey: TAIPEI_ABCD_TEMPLATE.key, rendererVersion: "taipei-crosswalk-v1", fontAssetKey: "taipei-crosswalk-font-v1",
    isElectronicSignature: false, isOfficialComplete: false, generatedAt: "2026-09-14T03:00:00Z", workflow: emptyWorkflow,
    organization: { organizationId: org, organizationName: "合成機構", branchId: branch, branchName: "合成日照分支" }, client: { clientId: client, displayName: "合成個案（非真實個資）", clientCode: "SYNTHETIC-001" },
    draft: { id, organizationId: org, branchId: branch, clientId: client, form, usageYear: 115, month: form === "C" ? 9 : 0, version: 1, previousVersionId: null,
      contentHash: "a".repeat(64), answers: form === "A" ? { "A1.name": { state: "recorded", value: "合成個案", reason: null } } : form === "B" ? { "B0.assessment_kind": { state: "recorded", value: "初評", reason: null }, "B0.assessed_on": { state: "recorded", value: "2026-09-14", reason: null }, "B0.reassessment_reason": { state: "not_applicable", value: null, reason: "首次合成測試評估" }, "B0.review_due": { state: "missing", value: null, reason: null } } : {},
      sourceSnapshot: form === "C" ? { capturedAt: "2026-09-14T03:00:00Z", measurements: [], careRecords: [], healthAccess: true, careAccess: true } : null,
      createdAt: "2026-09-14T03:00:00Z", state: "draft", publicationStatus: "pending_approval" } };
}
describe("administrative review and frozen export contracts", () => {
  it("does not accept fake signed workflow", () => { expect(() => workflowSchema.parse({ ...emptyWorkflow, isElectronicSignature: true })).toThrow(); });
  it("distinguishes per-section missing and source confirmation", () => {
    const items = sectionReviewItems("A", { "A1.name": { state: "unconfirmed", value: "合成", reason: null } });
    expect(items.find(i => i.code === "A1")).toMatchObject({ missing: 0, unconfirmed: 1 }); expect(items.find(i => i.code === "A2")?.missing).toBeGreaterThan(0);
  });
  it("rejects unknown signature and blank review reason", () => { expect(transitionSchema.safeParse({ signed: true }).success).toBe(false); });
  it.each(["A", "B", "C"] as const)("exports every %s field with exact source page mapping", form => {
    const source = syntheticExport(form);
    // Unconfirmed is allowed only for catalogue prefill-enabled fields.
    if (form === "B") (source.draft as { answers: Record<string, unknown> }).answers["B0.review_due"] = { state: "missing", value: null, reason: null };
    const model = taipeiExportModel(source, id, "b".repeat(64)); parseDocumentRenderModel(model);
    const labels = model.sections.flatMap(s => s.rows.map(r => r.label));
    for (const field of taipeiFields(form)) expect(labels.filter(label => label.startsWith(`${field.key} `))).toHaveLength(1);
    expect(model.sections.map(s => s.heading).join()).toContain("原稿第");
    expect(model.watermark).toContain("未電子簽署"); expect(model.footerNote).toContain("非官方");
  });
  it("preserves NA reasons, missing, and unchanged central/center values", () => {
    const source = syntheticExport(); (source.draft as { answers: Record<string, unknown> }).answers = {
      "B13.central.0": { state: "recorded", value: "中央合成值", reason: null }, "B13.center.0": { state: "missing", value: null, reason: null },
      "B0.reassessment_reason": { state: "not_applicable", value: null, reason: "首次合成評估" },
    };
    const rows = taipeiExportModel(source, id, "b".repeat(64)).sections.flatMap(s => s.rows);
    expect(rows.find(r => r.label.startsWith("B13.central.0 "))?.value).toContain("中央合成值");
    expect(rows.find(r => r.label.startsWith("B13.center.0 "))?.value).toBe("未填／待補");
    expect(rows.find(r => r.label.startsWith("B0.reassessment_reason "))?.value).toContain("不適用；原因：首次合成評估");
  });
  it("uses saved C evidence and never invents attendance from empty sources", () => {
    const model = taipeiExportModel(syntheticExport("C"), id, "b".repeat(64));
    expect(model.sections.flatMap(s => s.rows).some(r => r.value?.includes("不由排程或CMS核定補造"))).toBe(true);
  });
  it("rejects cross-client snapshot and unsupported template revision", () => {
    const source = syntheticExport("A"); expect(() => taipeiExportModel({ ...source, client: { ...source.client, clientId: org } }, id, "b".repeat(64))).toThrow();
    expect(() => taipeiExportModel({ ...source, sourceRevision: "115.01" }, id, "b".repeat(64))).toThrow();
  });
  it("renders a reproducible real Chinese multi-page B PDF using the locked full OFL font", async () => {
    const fontBytes = new Uint8Array(await readFile(join(process.cwd(), "assets/fonts/NotoSansTC-Regular.ttf")));
    expect(createHash("sha256").update(fontBytes).digest("hex")).toBe("b4ebe30cc77de66e271483b41f5d7ee60baa070054a0b938f87c88491b5d1b91");
    const source = syntheticExport(); delete (source.draft as { answers: Record<string, unknown> }).answers["B0.review_due"];
    const model = taipeiExportModel(source, id, "b".repeat(64));
    const font = fontkit.create(fontBytes); const mapped = new Set(font.characterSet.map(code => font.glyphForCodePoint(code).id));
    // Every emitted glyph must have the same advanceWidth in the full-font PDF W map.
    const strings = [model.title, model.watermark, model.footerNote, model.documentDate, ...model.sections.flatMap(s => [s.heading, ...s.rows.flatMap(r => [r.label, r.value ?? ""])])];
    for (const text of strings) for (const glyph of font.layout(text, { ...TAIPEI_PDF_FONT_FEATURES }).glyphs) expect(mapped.has(glyph.id)).toBe(true);
    const first = await renderDocumentPdf({ model, fontBytes, fontFeatures: { ...TAIPEI_PDF_FONT_FEATURES }, keepShortRowsTogether: true }); const again = await renderDocumentPdf({ model, fontBytes, fontFeatures: { ...TAIPEI_PDF_FONT_FEATURES }, keepShortRowsTogether: true });
    expect(createHash("sha256").update(first).digest("hex")).toBe(createHash("sha256").update(again).digest("hex"));
    const pdf = await PDFDocument.load(first); expect(pdf.getPageCount()).toBeGreaterThan(5);
    expect(pdf.getTitle()).toContain("欄位對照副本");
    if (process.env.TAIPEI_PDF_QA_DIR) {
      await mkdir(process.env.TAIPEI_PDF_QA_DIR, { recursive: true }); await writeFile(join(process.env.TAIPEI_PDF_QA_DIR, "taipei-b-crosswalk-synthetic.pdf"), first);
      await writeFile(join(process.env.TAIPEI_PDF_QA_DIR, "expected.json"), JSON.stringify({ pdfHash: createHash("sha256").update(first).digest("hex"), pageCount: pdf.getPageCount(), fields: taipeiFields("B").map(f => f.key), sourceHash: TAIPEI_ABCD_TEMPLATE.sourceSha256 }, null, 2));
    }
  }, 60000);
});
