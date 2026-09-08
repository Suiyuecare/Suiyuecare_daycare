export const DOCUMENT_VALUE_STATES = [
  "recorded",
  "missing",
  "not_applicable",
] as const;

export type DocumentValueState = (typeof DOCUMENT_VALUE_STATES)[number];

export type DocumentRenderRow = {
  label: string;
  value: string | null;
  state: DocumentValueState;
};

export type DocumentRenderSection = {
  heading: string;
  rows: readonly DocumentRenderRow[];
};

/**
 * Immutable input shared by the HTML summary and PDF renderer. A print job
 * freezes this model before either representation is exposed.
 */
export type DocumentRenderModel = {
  schemaVersion: 1;
  locale: "zh-TW";
  timezone: "Asia/Taipei";
  template: {
    versionId: string;
    templateKey: string;
    version: number;
    title: string;
    contentHash: string;
  };
  organization: {
    organizationId: string;
    organizationName: string;
    branchId: string;
    branchName: string;
  };
  client: {
    clientId: string;
    displayName: string;
    clientCode: string | null;
  };
  documentDate: string;
  generatedAt: string;
  title: string;
  watermark: string;
  sections: readonly DocumentRenderSection[];
  footerNote: string;
};

export type DocumentTemplateOption = {
  versionId: string;
  templateKey: string;
  version: number;
  title: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  contentHash: string;
  fontAssetStatus: "configured" | "not_configured";
};

export type DocumentClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string | null;
};

export type DocumentPrintJobItem = {
  jobId: string;
  templateVersionId: string;
  templateKey: string;
  templateVersion: number;
  templateTitle: string;
  clientId: string;
  clientDisplayName: string;
  documentDate: string;
  renderModelHash: string;
  createdByDisplayName: string;
  createdAt: string;
  previewCount: number;
  downloadCount: number;
  lastAccessedAt: string | null;
  renderModel: DocumentRenderModel;
  previewUrl: string | null;
  downloadUrl: string | null;
};

export type DocumentPrintingSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  templates: readonly DocumentTemplateOption[];
  templateTotal: number;
  templatesTruncated: boolean;
  clients: readonly DocumentClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  jobs: readonly DocumentPrintJobItem[];
  jobTotal: number;
  jobsTruncated: boolean;
  templateGovernanceStatus: "configured" | "not_configured";
  pdfRendererStatus: "available";
  fontAssetStatus: "configured" | "not_configured";
  shortLivedUrlStatus: "configured" | "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "pdf_only";
  offlineStatus: "disabled";
  demo: boolean;
};

export type DocumentPrintingFilters = {
  templateVersionId: string | null;
  clientId: string | null;
  documentDate: string | null;
  query: string;
};

export type CreateDocumentPrintJobInput = {
  action: "create_job";
  templateVersionId: string;
  clientId: string;
  documentDate: string;
  idempotencyKey: string;
};

export type DocumentPrintJobOperationResult = {
  action: "create_job";
  operationId: string;
  jobId: string;
  templateVersionId: string;
  clientId: string;
  documentDate: string;
  renderModelHash: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
