import type { DocumentPrintingFilters } from "./types";

type Query = Record<string, string | string[] | undefined>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const date = /^\d{4}-\d{2}-\d{2}$/u;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function validTaipeiDate(value: string) {
  if (!date.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed) === value;
}

export function parseDocumentPrintingFilters(query: Query): {
  filters: DocumentPrintingFilters;
  invalid: boolean;
} {
  const rawTemplate = one(query.template);
  const rawClient = one(query.client);
  const rawDate = one(query.date);
  const rawQuery = one(query.q);
  const templateVersionId = !rawTemplate || rawTemplate === "all"
    ? null : uuid.test(rawTemplate) ? rawTemplate.toLowerCase() : null;
  const clientId = !rawClient || rawClient === "all"
    ? null : uuid.test(rawClient) ? rawClient.toLowerCase() : null;
  const documentDate = !rawDate ? null : validTaipeiDate(rawDate) ? rawDate : null;
  const search = rawQuery?.trim() ?? "";
  const invalid = Object.values(query).some(Array.isArray) ||
    Boolean(rawTemplate && rawTemplate !== "all" && !templateVersionId) ||
    Boolean(rawClient && rawClient !== "all" && !clientId) ||
    Boolean(rawDate && !documentDate) || rawQuery === null && query.q !== undefined ||
    search.length > 120 || /[\u0000-\u001f\u007f]/u.test(search);
  return {
    filters: {
      templateVersionId,
      clientId,
      documentDate,
      query: invalid ? "" : search,
    },
    invalid,
  };
}
