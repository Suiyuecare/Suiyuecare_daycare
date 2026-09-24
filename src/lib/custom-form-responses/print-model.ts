import { roleDisplayName } from "@/lib/domain/roles";
import { parseDocumentRenderModel } from "@/lib/document-printing/parser";
import type { DocumentRenderModel, DocumentRenderRow } from "@/lib/document-printing/types";

import { validateFormAnswers, type FormAnswer } from "./contract";
import { printJobSchema, type CustomResponsePrintJob } from "./print-contract";

function recorded(label: string, value: string): DocumentRenderRow {
  return { label, value, state: "recorded" };
}

function answerValue(answer: FormAnswer | undefined): string {
  if (!answer || answer.state === "missing") return "未填／待補";
  if (answer.state === "not_applicable") return `不適用；原因：${answer.reason}`;
  if (typeof answer.value === "boolean") return answer.value ? "是" : "否";
  return String(answer.value);
}

function taipeiTimestamp(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}（臺北時間）`;
}

/**
 * Shared by the frozen HTML preview and PDF. This projection has no clock,
 * network, score calculation, or access to current form/answer definitions.
 * Authorization and the database snapshot hash are verified before calling it.
 */
export function customResponsePrintModel(input: CustomResponsePrintJob): DocumentRenderModel {
  const parsed = printJobSchema.safeParse(input);
  if (!parsed.success) throw new Error("CUSTOM_RESPONSE_PRINT_MODEL_INVALID");
  const job = parsed.data;
  const snapshot = job.snapshot;
  const response = snapshot.response;
  if (response.id !== job.responseId || response.clientId !== job.clientId
    || validateFormAnswers(response.schema, response.answers, response.status === "signed").length > 0) {
    throw new Error("CUSTOM_RESPONSE_PRINT_MODEL_INVALID");
  }
  const isCorrection = response.correctionSourceId !== null;
  const state = response.status === "signed" ? "已簽署紀錄" : "草稿／尚未簽署";
  const signature = response.signatureEvidence;
  const responseRows = response.schema.fields.map((field, index) => recorded(
    `${index + 1}. ${field.label}${field.required ? "（必填）" : ""}`,
    answerValue(response.answers[field.key]),
  ));
  const provenance = [
    recorded("文件性質", "機構自訂表單填答副本；不是官方量表，未重新計分，亦非 PDF 數位簽章。"),
    recorded("表單名稱", snapshot.formName),
    recorded("表單代碼", snapshot.formKey),
    recorded("表單版本", `第 ${snapshot.formVersion} 版；版本 ID：${response.formVersionId}`),
    recorded("服務日期", response.serviceDate),
    recorded("紀錄版本與狀態", `第 ${response.revision} 版；${state}${isCorrection ? "；更正版" : ""}`),
    recorded("紀錄版本 ID", response.id),
    recorded("紀錄主 ID", response.recordKey),
    recorded("保存時間", taipeiTimestamp(response.createdAt)),
    recorded("本版儲存者 ID", response.actorId),
  ];
  if (response.previousId) provenance.push(recorded("上一版 ID", response.previousId));
  if (response.correctionSourceId) provenance.push(recorded("更正原紀錄 ID", response.correctionSourceId));
  if (response.reason) provenance.push(recorded("更正原因", response.reason));
  const signatureRows = signature ? [
    recorded("簽署人 ID", signature.signerId),
    recorded("簽署時角色", signature.roles.length
      ? signature.roles.map((role) => roleDisplayName(role, role)).join("、")
      : "來源未提供角色名稱"),
    recorded("簽署時間", taipeiTimestamp(signature.signedAt)),
    recorded("簽署目的", signature.purpose),
    recorded("身分再驗證證據", `AAL2；驗證事件 ID：${signature.challengeId}`),
    recorded("證據用途", "以上為系統保存的紀錄簽署證據；本 PDF 是該版本的副本，並非憑證式 PDF 數位簽章。"),
  ] : [recorded("簽署狀態", "尚未簽署；此草稿不得標示為已完成的正式簽署紀錄。")];

  return parseDocumentRenderModel({
    schemaVersion: 1, locale: "zh-TW", timezone: "Asia/Taipei",
    template: {
      versionId: response.formVersionId,
      // The renderer's technical template namespace excludes dots. Preserve the
      // actual governed tenant.custom.* key in the provenance section above.
      templateKey: "custom_form_response", version: snapshot.formVersion,
      title: snapshot.formName, contentHash: job.snapshotHash,
    },
    organization: {
      organizationId: job.organizationId, organizationName: snapshot.organizationName,
      branchId: job.branchId, branchName: snapshot.branchName,
    },
    client: { clientId: job.clientId, displayName: snapshot.clientName, clientCode: snapshot.clientCode },
    documentDate: response.serviceDate, generatedAt: job.createdAt,
    title: `${snapshot.formName} - 填答副本`,
    watermark: response.status === "signed" ? "已簽署紀錄副本" : isCorrection ? "更正草稿・未簽署" : "草稿・未簽署",
    sections: [
      { heading: "文件與保存版本", rows: provenance },
      { heading: "保存時的逐題填答（未填不等於不適用）", rows: responseRows },
      { heading: "紀錄簽署證據（非 PDF 數位簽章）", rows: signatureRows },
      { heading: "列印快照與追溯資訊", rows: [
        recorded("列印快照 ID", job.jobId),
        recorded("快照建立時間", taipeiTimestamp(job.createdAt)),
        recorded("製表人", `${snapshot.preparedByName}；帳號 ID：${job.actorId}`),
        recorded("紀錄內容 SHA-256", response.contentHash),
        recorded("列印快照 SHA-256", job.snapshotHash),
      ] },
    ],
    footerNote: `機構自訂表單副本；${state}${isCorrection ? "；更正版" : ""}。服務日期 ${response.serviceDate}，表單第 ${snapshot.formVersion} 版／紀錄第 ${response.revision} 版。快照 ${job.jobId}；此檔不會反映後續變更，請妥善保管。`,
  });
}
