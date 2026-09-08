import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { parseDocumentRenderModel } from "./parser";
import type {
  DocumentPrintingFilters,
  DocumentPrintingSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const count = z.preprocess((value) =>
  typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value,
z.number().int().nonnegative().safe());
const clean = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));

const templateSchema = z.object({
  version_id: uuid,
  template_key: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,79}$/u),
  version: z.number().int().positive().safe(),
  title: clean(160),
  effective_from: timestamp,
  effective_to: timestamp.nullable(),
  content_hash: hash,
  font_asset_status: z.literal("configured"),
}).strict();

const clientSchema = z.object({
  client_id: uuid,
  display_name: clean(160),
  client_code: z.string().trim().min(1).max(80).nullable(),
}).strict();

const jobSchema = z.object({
  job_id: uuid,
  template_version_id: uuid,
  template_key: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,79}$/u),
  template_version: z.number().int().positive().safe(),
  template_title: clean(160),
  client_id: uuid,
  client_display_name: clean(160),
  document_date: date,
  render_model_hash: hash,
  created_by_display_name: clean(120),
  created_at: timestamp,
  preview_count: count,
  download_count: count,
  last_accessed_at: timestamp.nullable(),
  render_model: z.unknown(),
}).strict();

const payloadSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  templates: z.array(templateSchema).max(100),
  template_total: count,
  templates_truncated: z.boolean(),
  clients: z.array(clientSchema).max(200),
  client_total: count,
  clients_truncated: z.boolean(),
  jobs: z.array(jobSchema).max(100),
  job_total: count,
  jobs_truncated: z.boolean(),
  template_governance_status: z.enum(["configured", "not_configured"]),
  pdf_renderer_status: z.literal("available"),
  font_asset_status: z.enum(["configured", "not_configured"]),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("pdf_only"),
  offline_status: z.literal("disabled"),
}).strict();

export type DocumentPrintingSnapshotSourceRow = {
  payload: z.input<typeof payloadSchema>;
};

type AccessUrlFactory = (jobId: string, mode: "preview" | "download") => string;

function invalid(): never {
  throw new Error("DOCUMENT_PRINTING_SNAPSHOT_INVALID");
}

function distinct(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function includesQuery(job: z.output<typeof jobSchema>, query: string) {
  if (!query) return true;
  return [job.template_title, job.client_display_name, job.template_key,
    job.document_date, job.created_by_display_name]
    .join("\n").toLocaleLowerCase("zh-TW")
    .includes(query.toLocaleLowerCase("zh-TW"));
}

export function projectDocumentPrintingSnapshot({
  row: source,
  expectedOrganizationId,
  expectedBranchId,
  filters,
  demo,
  accessUrl,
}: {
  row: DocumentPrintingSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: DocumentPrintingFilters;
  demo: boolean;
  accessUrl?: AccessUrlFactory;
}): DocumentPrintingSnapshot {
  const parsed = payloadSchema.safeParse(source.payload);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId.toLowerCase() ||
    row.branch_id !== expectedBranchId.toLowerCase() ||
    row.templates.length > row.template_total ||
    row.clients.length > row.client_total || row.jobs.length > row.job_total ||
    row.templates_truncated !== (row.template_total > 100) ||
    row.clients_truncated !== (row.client_total > 200) ||
    row.jobs_truncated !== (row.job_total > 100) ||
    (row.template_governance_status === "configured") !==
      (row.template_total > 0) ||
    (row.font_asset_status === "configured") !== (row.template_total > 0) ||
    !distinct(row.templates.map((item) => item.version_id)) ||
    !distinct(row.templates.map((item) => item.template_key)) ||
    !distinct(row.clients.map((item) => item.client_id)) ||
    !distinct(row.jobs.map((item) => item.job_id))) invalid();

  for (const template of row.templates) {
    if (template.effective_to !== null &&
      template.effective_to <= template.effective_from) invalid();
  }
  for (const [index, job] of row.jobs.entries()) {
    const model = parseDocumentRenderModel(job.render_model);
    if (model.organization.organizationId !== row.organization_id ||
      model.organization.branchId !== row.branch_id ||
      model.client.clientId !== job.client_id ||
      model.client.displayName !== job.client_display_name ||
      model.template.versionId !== job.template_version_id ||
      model.template.templateKey !== job.template_key ||
      model.template.version !== job.template_version ||
      model.template.title !== job.template_title ||
      model.documentDate !== job.document_date ||
      model.generatedAt !== job.created_at ||
      (job.last_accessed_at !== null && job.last_accessed_at < job.created_at) ||
      (index > 0 && row.jobs[index - 1]!.created_at < job.created_at)) invalid();
  }

  const jobs = row.jobs.filter((job) =>
    (!filters.templateVersionId ||
      job.template_version_id === filters.templateVersionId) &&
    (!filters.clientId || job.client_id === filters.clientId) &&
    (!filters.documentDate || job.document_date === filters.documentDate) &&
    includesQuery(job, filters.query),
  ).map((job) => {
    const renderModel = parseDocumentRenderModel(job.render_model);
    return {
      jobId: job.job_id,
      templateVersionId: job.template_version_id,
      templateKey: job.template_key,
      templateVersion: job.template_version,
      templateTitle: job.template_title,
      clientId: job.client_id,
      clientDisplayName: job.client_display_name,
      documentDate: job.document_date,
      renderModelHash: job.render_model_hash,
      createdByDisplayName: job.created_by_display_name,
      createdAt: job.created_at,
      previewCount: job.preview_count,
      downloadCount: job.download_count,
      lastAccessedAt: job.last_accessed_at,
      renderModel,
      previewUrl: accessUrl?.(job.job_id, "preview") ?? null,
      downloadUrl: accessUrl?.(job.job_id, "download") ?? null,
    };
  });

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    templates: row.templates.map((item) => ({
      versionId: item.version_id,
      templateKey: item.template_key,
      version: item.version,
      title: item.title,
      effectiveFrom: item.effective_from,
      effectiveTo: item.effective_to,
      contentHash: item.content_hash,
      fontAssetStatus: item.font_asset_status,
    })),
    templateTotal: row.template_total,
    templatesTruncated: row.templates_truncated,
    clients: row.clients.map((item) => ({
      clientId: item.client_id,
      displayName: item.display_name,
      clientCode: item.client_code,
    })),
    clientTotal: row.client_total,
    clientsTruncated: row.clients_truncated,
    jobs,
    jobTotal: row.job_total,
    jobsTruncated: row.jobs_truncated,
    templateGovernanceStatus: row.template_governance_status,
    pdfRendererStatus: row.pdf_renderer_status,
    fontAssetStatus: row.font_asset_status,
    shortLivedUrlStatus: accessUrl ? "configured" : "not_configured",
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    offlineStatus: row.offline_status,
    demo,
  };
}
