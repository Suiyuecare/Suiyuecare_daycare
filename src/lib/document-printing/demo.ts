import {
  projectDocumentPrintingSnapshot,
  type DocumentPrintingSnapshotSourceRow,
} from "./projection";
import type { DocumentPrintingFilters, DocumentRenderModel } from "./types";

const IDS = {
  template: "62000000-0000-4000-8000-000000000001",
  client: "62000000-0000-4000-8000-000000000002",
  job: "62000000-0000-4000-8000-000000000003",
};

function taipeiDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildDemoDocumentPrintingSnapshot({
  organizationId,
  branchId,
  filters,
  now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: DocumentPrintingFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const documentDate = taipeiDate(now);
  const model: DocumentRenderModel = {
    schemaVersion: 1,
    locale: "zh-TW",
    timezone: "Asia/Taipei",
    template: {
      versionId: IDS.template,
      templateKey: "synthetic_client_summary",
      version: 1,
      title: "合成個案摘要範本",
      contentHash: "a".repeat(64),
    },
    organization: {
      organizationId,
      organizationName: "合成日照中心",
      branchId,
      branchName: "合成分支",
    },
    client: {
      clientId: IDS.client,
      displayName: "示範個案",
      clientCode: "DEMO-062",
    },
    documentDate,
    generatedAt,
    title: "合成個案照顧摘要",
    watermark: "合成測試資料",
    sections: [{
      heading: "基本資料",
      rows: [
        { label: "個案姓名", value: "示範個案", state: "recorded" },
        { label: "補充欄位", value: null, state: "missing" },
        { label: "結案日期", value: null, state: "not_applicable" },
      ],
    }],
    footerNote: "此為合成介面驗收文件，不是正式照顧紀錄或官方表單。",
  };
  const source: DocumentPrintingSnapshotSourceRow = {
    payload: {
      organization_id: organizationId,
      branch_id: branchId,
      generated_at: generatedAt,
      templates: [{
        version_id: IDS.template,
        template_key: "synthetic_client_summary",
        version: 1,
        title: "合成個案摘要範本",
        effective_from: new Date(now.getTime() - 86_400_000).toISOString(),
        effective_to: null,
        content_hash: "a".repeat(64),
        font_asset_status: "configured",
      }],
      template_total: 1,
      templates_truncated: false,
      clients: [{ client_id: IDS.client, display_name: "示範個案",
        client_code: "DEMO-062" }],
      client_total: 1,
      clients_truncated: false,
      jobs: [{
        job_id: IDS.job,
        template_version_id: IDS.template,
        template_key: "synthetic_client_summary",
        template_version: 1,
        template_title: "合成個案摘要範本",
        client_id: IDS.client,
        client_display_name: "示範個案",
        document_date: documentDate,
        render_model_hash: "b".repeat(64),
        created_by_display_name: "合成文件人員",
        created_at: generatedAt,
        preview_count: 1,
        download_count: 0,
        last_accessed_at: generatedAt,
        render_model: model,
      }],
      job_total: 1,
      jobs_truncated: false,
      template_governance_status: "configured",
      pdf_renderer_status: "available",
      font_asset_status: "configured",
      attachment_status: "not_configured",
      export_status: "pdf_only",
      offline_status: "disabled",
    },
  };
  return projectDocumentPrintingSnapshot({
    row: source,
    expectedOrganizationId: organizationId,
    expectedBranchId: branchId,
    filters,
    demo: true,
  });
}
