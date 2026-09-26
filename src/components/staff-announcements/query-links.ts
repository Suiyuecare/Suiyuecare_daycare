import type { StaffAnnouncementFilters } from "@/lib/staff-announcements/types";
export const STAFF_ANNOUNCEMENT_PATH = "/app/staff/operations/announcements";
export function staffAnnouncementHref(filters: StaffAnnouncementFilters, release: string | null = null) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.status !== "all") params.set("status", filters.status);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (release) params.set("release", release);
  return `${STAFF_ANNOUNCEMENT_PATH}?${params}`;
}
