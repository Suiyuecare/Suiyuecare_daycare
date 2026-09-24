import { z } from "zod";
import { TAIPEI_ABCD_TEMPLATE, TAIPEI_SECTIONS, type TaipeiForm } from "./catalog";
import { validateTaipeiSnapshot } from "./parser";
import { TAIPEI_WORKFLOW_LABELS, workflowSchema } from "./workflow";
import type { TaipeiDraft } from "./types";
import type { DocumentRenderModel, DocumentRenderSection } from "@/lib/document-printing/types";
export const exportInputSchema = z.object({ clientId: z.uuid(), draftId: z.uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), expectedSequence: z.number().int().min(0), idempotency_key: z.uuid() }).strict();
const identitySchema = z.object({ organizationId: z.uuid(), organizationName: z.string(), branchId: z.uuid(), branchName: z.string() });
export const exportSnapshotSchema = z.object({ draft: z.unknown(), workflow: workflowSchema, generatedAt: z.iso.datetime({ offset: true }),
  sourceRevision: z.literal("114.11"), sourceSha256: z.literal(TAIPEI_ABCD_TEMPLATE.sourceSha256), templateKey: z.literal(TAIPEI_ABCD_TEMPLATE.key),
  organization: identitySchema, client: z.object({ clientId: z.uuid(), displayName: z.string(), clientCode: z.string().nullable() }),
  isElectronicSignature: z.literal(false), isOfficialComplete: z.literal(false), rendererVersion: z.literal("taipei-crosswalk-v1"), fontAssetKey: z.literal("taipei-crosswalk-font-v1") });
export type TaipeiExportSnapshot = z.infer<typeof exportSnapshotSchema>;
export function taipeiExportModel(raw: unknown, snapshotId: string, snapshotHash: string): DocumentRenderModel {
  const source = exportSnapshotSchema.parse(raw); const draft = source.draft as TaipeiDraft;
  validateTaipeiSnapshot({ organizationId: source.organization.organizationId, branchId: source.organization.branchId, clientId: source.client.clientId,
    form: draft.form, usageYear: 115, month: draft.month, latest: draft, history: [], currentSources: null, canEdit: false },
  { organizationId: source.organization.organizationId, branchId: source.organization.branchId, clientId: source.client.clientId, form: draft.form, usageYear: 115, month: draft.month });
  if (!["A", "B", "C"].includes(draft.form)) throw new Error("INVALID_TAIPEI_FORM");
  const sections: DocumentRenderSection[] = [{ heading: "文件定位與凍結版本", rows: [
    { label: "文件性質", state: "recorded", value: "官方欄位對照副本，非官方原稿版面；未電子簽署，不能代替官方完整表。" },
    { label: "來源／版次", state: "recorded", value: `臺北市115年度；原稿114.11。表${draft.form}草稿第${draft.version}版；${TAIPEI_WORKFLOW_LABELS[source.workflow.state]}；審核第${source.workflow.sequence}版。` },
    { label: "草稿內容雜湊", state: "recorded", value: draft.contentHash },
    { label: "輸出快照雜湊", state: "recorded", value: snapshotHash },
    { label: "官方原稿 SHA-256", state: "recorded", value: source.sourceSha256 },
  ] }];
  for (const section of TAIPEI_SECTIONS[draft.form as TaipeiForm]) {
    const rows = section.fields.map(field => {
      const answer = draft.answers[field.key];
      const value = !answer || answer.state === "missing" ? `未填／待補${answer?.reason ? `；${answer.reason}` : ""}` : answer.state === "not_applicable" ? `不適用；原因：${answer.reason}` :
        `${answer.state === "unconfirmed" ? "來源待核對（不算完成）：" : "已核對："}${Array.isArray(answer.value) ? answer.value.join("、") : String(answer.value)}`;
      return { label: `${field.key} ${field.label}`, state: "recorded" as const, value };
    });
    for (let start = 0; start < rows.length; start += 75) sections.push({ heading: `${section.code} ${section.title}（原稿第${section.sourcePages.join("、")}頁）${start ? "續" : ""}`, rows: rows.slice(start, start + 75) });
  }
  const lastSubmission = source.workflow.events.filter(event => event.action === "submit").at(-1);
  if (lastSubmission) sections.push({ heading: "送審核對與待補（未填不等於不適用）", rows: Object.entries(lastSubmission.checklist).map(([code, entry]) => ({ label: code, state: "recorded", value: entry.pendingReason ? `已核對；仍有未填，待補：${entry.pendingReason}` : "已逐欄核對資料狀態；不代表正式簽署" })) });
  if (source.workflow.events.length) sections.push({ heading: "行政審核歷程（非電子簽署）", rows: source.workflow.events.slice(-50).map(event => ({ label: `第${event.sequence}版 ${event.actorName}`, state: "recorded", value: `${TAIPEI_WORKFLOW_LABELS[event.state]}；${event.createdAt}；${event.reason}` })) });
  if (source.workflow.events.length > 50) throw new Error("REVIEW_HISTORY_EXPORT_LIMIT");
  if (draft.form === "C") {
    if (!draft.sourceSnapshot?.healthAccess || !draft.sourceSnapshot.careAccess) throw new Error("C_SOURCE_REQUIRED");
    const rows = [
      ...draft.sourceSnapshot.measurements.map(m => ({ label: `${m.measuredAt} ${m.kind}`, state: "recorded" as const, value: `${m.numericValue ?? m.textValue ?? "缺值"} ${m.unit ?? ""}；来源ID：${m.id}；紀錄者：${m.recordedBy ?? "未提供"}` })),
      ...draft.sourceSnapshot.careRecords.map(r => ({ label: `${r.occurredAt} 照顧執行`, state: "recorded" as const, value: `來源ID：${r.id}；第${r.version}版；${Object.entries(r.data).map(([k, v]) => `${k}：${typeof v === "string" ? v : JSON.stringify(v)}`).join("；")}；內容雜湊：${r.contentHash}` })),
    ];
    if (!rows.length) rows.push({ label: "實際執行來源", state: "recorded", value: "本次快照沒有當月已符合條件的量測／照顧執行證據；不由排程或CMS核定補造。" });
    for (let start = 0; start < rows.length; start += 75) sections.push({ heading: `C 表保存當時的實際紀錄來源 ${start / 75 + 1}`, rows: rows.slice(start, start + 75) });
  }
  if (sections.length > 30) throw new Error("TAIPEI_PDF_SOURCE_LIMIT");
  return { schemaVersion: 1, locale: "zh-TW", timezone: "Asia/Taipei", template: { versionId: snapshotId, templateKey: "taipei_abcd_crosswalk", version: 1, title: "115年度臺北市ABCD欄位對照副本", contentHash: snapshotHash },
    organization: source.organization, client: source.client, documentDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(source.generatedAt)),
    generatedAt: source.generatedAt, title: `臺北市115年度 ${draft.form}表${draft.form === "C" ? ` ${draft.month}月` : ""} - 欄位對照副本`, watermark: "對照副本・未電子簽署", sections,
    footerNote: `非官方原稿版面；行政核准不代表臨床簽署或官方完整。快照 ${snapshotId}；資料依保存版本，D臨時住宿不適用純日照。` };
}
