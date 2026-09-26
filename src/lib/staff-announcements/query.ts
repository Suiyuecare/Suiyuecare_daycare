import { z } from "zod";

import { STAFF_ANNOUNCEMENT_LIFECYCLES, type StaffAnnouncementFilters } from "./types";

export const DEFAULT_STAFF_ANNOUNCEMENT_FILTERS: StaffAnnouncementFilters = {
  query: "", status: "all", page: 1, pageSize: 20,
};

export class StaffAnnouncementFilterError extends Error {
  constructor() {
    super("INVALID_STAFF_ANNOUNCEMENT_FILTERS");
    this.name = "StaffAnnouncementFilterError";
  }
}

export function validateStaffAnnouncementFilters(value: StaffAnnouncementFilters): StaffAnnouncementFilters {
  if (typeof value.query !== "string" || [...value.query].length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(value.query) ||
    !["all", ...STAFF_ANNOUNCEMENT_LIFECYCLES].includes(value.status) ||
    !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 10_000 ||
    ![20, 50, 100].includes(value.pageSize)) throw new StaffAnnouncementFilterError();
  return { query: value.query, status: value.status, page: value.page, pageSize: value.pageSize };
}

export function parseStaffAnnouncementPageQuery(
  params: Record<string, string | string[] | undefined>,
): { filters: StaffAnnouncementFilters; selectedReleaseId: string | null } {
  const scalar = (key: string, fallback: string) => {
    const value = params[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") throw new StaffAnnouncementFilterError();
    return value;
  };
  const page = scalar("page", "1");
  const size = scalar("pageSize", "20");
  const status = scalar("status", "all");
  const release = scalar("release", "");
  if (!/^[1-9]\d{0,4}$/u.test(page) || !/^(20|50|100)$/u.test(size) ||
    (params.release !== undefined && !z.uuid().safeParse(release).success)) {
    throw new StaffAnnouncementFilterError();
  }
  const filters = validateStaffAnnouncementFilters({
    query: scalar("q", ""), status: status as StaffAnnouncementFilters["status"],
    page: Number(page), pageSize: Number(size) as StaffAnnouncementFilters["pageSize"],
  });
  return { filters, selectedReleaseId: release ? release.toLowerCase() : null };
}
