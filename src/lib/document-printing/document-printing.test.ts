import { describe, expect, it } from "vitest";

import {
  parseCreateDocumentPrintJob,
  parseDocumentPrintAccessResult,
  parseDocumentPrintJobApiEnvelope,
  parseDocumentPrintJobOperationResult,
} from "./parser";
import {
  projectDocumentPrintingSnapshot,
  type DocumentPrintingSnapshotSourceRow,
} from "./projection";
import { parseDocumentPrintingFilters } from "./query";
import type { DocumentPrintingFilters, DocumentRenderModel } from "./types";

const ORG = "62000000-0000-4000-8000-000000000101";
const BRANCH = "62000000-0000-4000-8000-000000000102";
const TEMPLATE = "62000000-0000-4000-8000-000000000103";
const CLIENT = "62000000-0000-4000-8000-000000000104";
const JOB = "62000000-0000-4000-8000-000000000105";
const OPERATION = "62000000-0000-4000-8000-000000000106";
const KEY = "62000000-0000-4000-8000-000000000107";
const REQUEST = "62000000-0000-4000-8000-000000000108";
const HASH = "a".repeat(64);
const FILTERS: DocumentPrintingFilters = {
  templateVersionId: null,
  clientId: null,
  documentDate: null,
  query: "",
};

function model(overrides: Partial<DocumentRenderModel> = {}): DocumentRenderModel {
  return {
    schemaVersion: 1,
    locale: "zh-TW",
    timezone: "Asia/Taipei",
    template: { versionId: TEMPLATE, templateKey: "synthetic_summary",
      version: 1, title: "合成摘要", contentHash: HASH },
    organization: { organizationId: ORG, organizationName: "合成機構",
      branchId: BRANCH, branchName: "合成分支" },
    client: { clientId: CLIENT, displayName: "合成個案", clientCode: "P62" },
    documentDate: "2026-09-02",
    generatedAt: "2026-09-02T08:00:00.000Z",
    title: "合成文件",
    watermark: "合成測試",
    sections: [{ heading: "合成段落", rows: [
      { label: "有值", value: "內容", state: "recorded" },
      { label: "缺值", value: null, state: "missing" },
      { label: "不適用", value: null, state: "not_applicable" },
    ] }],
    footerNote: "合成資料，不是正式表單。",
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}): DocumentPrintingSnapshotSourceRow {
  return { payload: {
    organization_id: ORG,
    branch_id: BRANCH,
    generated_at: "2026-09-02T08:00:00.000Z",
    templates: [{ version_id: TEMPLATE, template_key: "synthetic_summary",
      version: 1, title: "合成摘要",
      effective_from: "2026-09-01T08:00:00.000Z", effective_to: null,
      content_hash: HASH, font_asset_status: "configured" }],
    template_total: 1,
    templates_truncated: false,
    clients: [{ client_id: CLIENT, display_name: "合成個案",
      client_code: "P62" }],
    client_total: 1,
    clients_truncated: false,
    jobs: [{ job_id: JOB, template_version_id: TEMPLATE,
      template_key: "synthetic_summary", template_version: 1,
      template_title: "合成摘要", client_id: CLIENT,
      client_display_name: "合成個案", document_date: "2026-09-02",
      render_model_hash: HASH, created_by_display_name: "合成人員",
      created_at: "2026-09-02T08:00:00.000Z", preview_count: 1,
      download_count: 2, last_accessed_at: "2026-09-02T08:01:00.000Z",
      render_model: model() }],
    job_total: 1,
    jobs_truncated: false,
    template_governance_status: "configured",
    pdf_renderer_status: "available",
    font_asset_status: "configured",
    attachment_status: "not_configured",
    export_status: "pdf_only",
    offline_status: "disabled",
    ...overrides,
  } as DocumentPrintingSnapshotSourceRow["payload"] };
}

describe("Page-62 document printing contracts", () => {
  it("projects one strict immutable model and creates only server-owned URLs", () => {
    const snapshot = projectDocumentPrintingSnapshot({
      row: source(), expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: FILTERS, demo: false,
      accessUrl: (jobId, mode) => `/safe/${jobId}/${mode}`,
    });
    expect(snapshot).toMatchObject({ templateTotal: 1, clientTotal: 1,
      jobTotal: 1, shortLivedUrlStatus: "configured", demo: false });
    expect(snapshot.jobs[0]).toMatchObject({ previewUrl: `/safe/${JOB}/preview`,
      downloadUrl: `/safe/${JOB}/download`, previewCount: 1, downloadCount: 2 });
    expect(snapshot.jobs[0]?.renderModel.sections[0]?.rows.map((row) => row.state))
      .toEqual(["recorded", "missing", "not_applicable"]);
  });

  it("filters by exact template, client, date, and bounded text", () => {
    const matching = projectDocumentPrintingSnapshot({
      row: source(), expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: { templateVersionId: TEMPLATE, clientId: CLIENT,
        documentDate: "2026-09-02", query: "合成人員" }, demo: false,
    });
    expect(matching.jobs).toHaveLength(1);
    const hidden = projectDocumentPrintingSnapshot({
      row: source(), expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: { ...FILTERS, query: "不存在" }, demo: false,
    });
    expect(hidden.jobs).toHaveLength(0);
    expect(hidden.jobTotal).toBe(1);
  });

  it.each([
    { organization_id: "62000000-0000-4000-8000-000000000999" },
    { templates_truncated: true },
    { template_governance_status: "not_configured" },
    { extra_private_field: "must fail" },
  ])("fails closed on malformed or cross-scope snapshot %#", (override) => {
    expect(() => projectDocumentPrintingSnapshot({ row: source(override),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: FILTERS, demo: false })).toThrow("DOCUMENT_PRINTING_SNAPSHOT_INVALID");
  });

  it("fails closed when job and frozen model identities drift", () => {
    const row = source();
    (row.payload.jobs as Array<Record<string, unknown>>)[0]!.render_model = model({
      organization: { organizationId: ORG, organizationName: "合成機構",
        branchId: "62000000-0000-4000-8000-000000000999", branchName: "錯誤" },
    });
    expect(() => projectDocumentPrintingSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters: FILTERS, demo: false })).toThrow("DOCUMENT_PRINTING_SNAPSHOT_INVALID");
  });

  it("parses query parameters strictly and rejects arrays or invalid dates", () => {
    expect(parseDocumentPrintingFilters({ template: TEMPLATE, client: CLIENT,
      date: "2026-09-02", q: " 合成 " })).toEqual({ invalid: false,
      filters: { templateVersionId: TEMPLATE, clientId: CLIENT,
        documentDate: "2026-09-02", query: "合成" } });
    expect(parseDocumentPrintingFilters({ q: ["a", "b"] }).invalid).toBe(true);
    expect(parseDocumentPrintingFilters({ date: "2026-02-30" }).invalid).toBe(true);
    expect(parseDocumentPrintingFilters({ client: "not-a-uuid" }).invalid).toBe(true);
  });

  it("requires a strict action, exact date, and UUID idempotency key", () => {
    const input = parseCreateDocumentPrintJob({ action: "create_job",
      templateVersionId: TEMPLATE, clientId: CLIENT,
      documentDate: "2026-09-02" }, KEY);
    expect(input).toMatchObject({ templateVersionId: TEMPLATE, clientId: CLIENT });
    expect(() => parseCreateDocumentPrintJob({ action: "create_job",
      templateVersionId: TEMPLATE, clientId: CLIENT, documentDate: "2026-09-02",
      fontObjectPath: "private/path" }, KEY)).toThrow("未通過驗證");
    expect(() => parseCreateDocumentPrintJob({ action: "create_job",
      templateVersionId: TEMPLATE, clientId: CLIENT,
      documentDate: "2026-02-30" }, KEY)).toThrow("未通過驗證");
  });

  it("binds database completion receipts to the submitted selection", () => {
    const input = parseCreateDocumentPrintJob({ action: "create_job",
      templateVersionId: TEMPLATE, clientId: CLIENT,
      documentDate: "2026-09-02" }, KEY);
    const row = { operation_id: OPERATION, job_id: JOB,
      template_version_id: TEMPLATE, client_id: CLIENT,
      document_date: "2026-09-02", render_model_hash: HASH,
      committed_at: "2026-09-02T08:00:00.000Z", replayed: false };
    expect(parseDocumentPrintJobOperationResult(row, input).jobId).toBe(JOB);
    expect(() => parseDocumentPrintJobOperationResult({ ...row,
      client_id: "62000000-0000-4000-8000-000000000999" }, input))
      .toThrow("資料庫完成憑證不完整");
  });

  it("strictly validates the HTTP envelope and replay status", () => {
    const input = parseCreateDocumentPrintJob({ action: "create_job",
      templateVersionId: TEMPLATE, clientId: CLIENT,
      documentDate: "2026-09-02" }, KEY);
    const receipt = { action: "create_job", operationId: OPERATION, jobId: JOB,
      templateVersionId: TEMPLATE, clientId: CLIENT, documentDate: "2026-09-02",
      renderModelHash: HASH, committedAt: "2026-09-02T08:00:00.000Z",
      replayed: false, persisted: true, demo: false };
    const envelope = { requestId: REQUEST, status: "ok",
      data: { receipt, persisted: true, demo: false }, errors: [] };
    expect(parseDocumentPrintJobApiEnvelope(envelope, input, 201).jobId).toBe(JOB);
    expect(() => parseDocumentPrintJobApiEnvelope(envelope, input, 200))
      .toThrow("完成憑證");
    expect(() => parseDocumentPrintJobApiEnvelope({ ...envelope,
      data: { ...envelope.data, privatePath: "must fail" } }, input, 201))
      .toThrow("完成憑證");
  });

  it("validates DB-authorized private font locators without exposing extra fields", () => {
    const result = parseDocumentPrintAccessResult({
      job_id: JOB, template_version_id: TEMPLATE, client_id: CLIENT,
      render_model: model(), render_model_hash: HASH,
      font_bucket: "private-doc-fonts", font_object_path: "org/template/font.ttf",
      font_sha256: "b".repeat(64), accessed_at: "2026-09-02T08:01:00.000Z",
    }, { jobId: JOB, organizationId: ORG, branchId: BRANCH });
    expect(result.fontObjectPath).toBe("org/template/font.ttf");
    expect(() => parseDocumentPrintAccessResult({
      job_id: JOB, template_version_id: TEMPLATE, client_id: CLIENT,
      render_model: model(), render_model_hash: HASH,
      font_bucket: "private-doc-fonts", font_object_path: "../secret.ttf",
      font_sha256: "b".repeat(64), accessed_at: "2026-09-02T08:01:00.000Z",
    }, { jobId: JOB, organizationId: ORG, branchId: BRANCH }))
      .toThrow("存取憑證不完整");
  });
});
