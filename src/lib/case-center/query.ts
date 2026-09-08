import { parseServiceDate } from "@/lib/core-care/date";

import {
  CASE_CENTER_LIFECYCLE_FILTERS,
  CASE_CENTER_SERVICE_FILTERS,
  type CaseCenterFilters,
  type CaseCenterLifecycleFilter,
  type CaseCenterResponsibleFilter,
  type CaseCenterServiceFilter,
} from "./types";

export const CASE_CENTER_PAGE_SIZE = 24;
export const CASE_CENTER_PATH = "/app/staff/workspace/case-center";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type SearchValues = Record<string, string | string[] | undefined>;

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function normalizedQuery(value: string | undefined) {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
}

function positivePage(value: string | undefined) {
  if (!value || !/^\d{1,7}$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function lifecycleFilter(value: string | undefined): CaseCenterLifecycleFilter {
  return CASE_CENTER_LIFECYCLE_FILTERS.includes(
    value as CaseCenterLifecycleFilter,
  )
    ? (value as CaseCenterLifecycleFilter)
    : "all";
}

function serviceFilter(value: string | undefined): CaseCenterServiceFilter {
  return CASE_CENTER_SERVICE_FILTERS.includes(value as CaseCenterServiceFilter)
    ? (value as CaseCenterServiceFilter)
    : "all";
}

function responsibleFilter(
  value: string | undefined,
): CaseCenterResponsibleFilter {
  if (value === "me" || value === "all") return value;
  return value && uuidPattern.test(value) ? value.toLowerCase() : "all";
}

export function parseCaseCenterFilters(
  values: SearchValues,
  now = new Date(),
): CaseCenterFilters {
  return {
    date: parseServiceDate(scalar(values.date), now),
    query: normalizedQuery(scalar(values.q)),
    lifecycle: lifecycleFilter(scalar(values.lifecycle)),
    service: serviceFilter(scalar(values.service)),
    responsible: responsibleFilter(scalar(values.responsible)),
    page: positivePage(scalar(values.page)),
  };
}

export function caseCenterHref(filters: CaseCenterFilters) {
  const params = new URLSearchParams({ date: filters.date });
  if (filters.query) params.set("q", filters.query);
  if (filters.lifecycle !== "all") {
    params.set("lifecycle", filters.lifecycle);
  }
  if (filters.service !== "all") params.set("service", filters.service);
  if (filters.responsible !== "all") {
    params.set("responsible", filters.responsible);
  }
  if (filters.page > 1) params.set("page", String(filters.page));
  return `${CASE_CENTER_PATH}?${params.toString()}`;
}

export function clampCaseCenterPage(
  requestedPage: number,
  total: number,
  pageSize = CASE_CENTER_PAGE_SIZE,
) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return { page, pageCount, offset: (page - 1) * pageSize };
}
