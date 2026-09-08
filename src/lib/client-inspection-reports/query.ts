import { z } from "zod";

import {
  CLIENT_REPORT_ATTACHMENT_FILTERS,
  CLIENT_REPORT_DUPLICATE_FILTERS,
  CLIENT_REPORT_RECORD_FILTERS,
  CLIENT_REPORT_VALUE_FILTERS,
  type ClientInspectionReportFilters,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value && Number(value.slice(0, 4)) >= 1900 &&
    Number(value.slice(0, 4)) <= 2200;
});
const text = (maximum: number) => z.string().trim().max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const allowed = new Set([
  "client", "type", "from", "to", "status", "result", "source",
  "attachment", "duplicate", "q",
]);

function one(params: URLSearchParams, key: string) {
  const values = params.getAll(key);
  if (values.length > 1) throw new Error("INVALID_CLIENT_INSPECTION_REPORT_QUERY");
  return values[0] ?? null;
}

export function parseClientInspectionReportFilters(
  params: URLSearchParams,
): ClientInspectionReportFilters {
  for (const key of params.keys()) if (!allowed.has(key)) {
    throw new Error("INVALID_CLIENT_INSPECTION_REPORT_QUERY");
  }
  const rawClient = one(params, "client") ?? "all";
  const rawType = one(params, "type") ?? "all";
  const from = one(params, "from") || null;
  const to = one(params, "to") || null;
  const status = z.enum(CLIENT_REPORT_RECORD_FILTERS)
    .safeParse(one(params, "status") ?? "all");
  const result = z.enum(CLIENT_REPORT_VALUE_FILTERS)
    .safeParse(one(params, "result") ?? "all");
  const source = z.enum(CLIENT_REPORT_VALUE_FILTERS)
    .safeParse(one(params, "source") ?? "all");
  const attachment = z.enum(CLIENT_REPORT_ATTACHMENT_FILTERS)
    .safeParse(one(params, "attachment") ?? "all");
  const duplicate = z.enum(CLIENT_REPORT_DUPLICATE_FILTERS)
    .safeParse(one(params, "duplicate") ?? "all");
  const query = text(120).safeParse(one(params, "q") ?? "");
  const reportType = rawType === "all" ? null : text(160).safeParse(rawType);
  const clientId = rawClient === "all" ? null : uuid.safeParse(rawClient);
  if ((clientId !== null && !clientId.success) ||
    (reportType !== null && (!reportType.success || reportType.data.length === 0)) ||
    (from !== null && !date.safeParse(from).success) ||
    (to !== null && !date.safeParse(to).success) ||
    (from !== null && to !== null && from > to) || !status.success ||
    !result.success || !source.success || !attachment.success ||
    !duplicate.success || !query.success) {
    throw new Error("INVALID_CLIENT_INSPECTION_REPORT_QUERY");
  }
  return {
    clientId: clientId === null ? null : clientId.data,
    reportType: reportType === null ? null : reportType.data,
    examinedFrom: from, examinedTo: to, recordStatus: status.data,
    resultStatus: result.data, sourceStatus: source.data,
    attachmentStatus: attachment.data, duplicateStatus: duplicate.data,
    query: query.data,
  };
}

export function clientInspectionReportTaipeiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}
