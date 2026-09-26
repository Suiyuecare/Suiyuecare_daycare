"use client";
import { useRef } from "react";
import type { StaffAnnouncementFilters } from "@/lib/staff-announcements/types";
import { SearchField } from "@/components/ui/search-field";
import { NavigationLink } from "@/components/app/navigation-link";
import { STAFF_ANNOUNCEMENT_PATH } from "./query-links";

export function StaffAnnouncementFilterForm({ filters }: { filters: StaffAnnouncementFilters }) {
  const composing = useRef(false);
  return <form className="filter-bar" method="get" action={STAFF_ANNOUNCEMENT_PATH} noValidate
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onSubmit={(event) => { if (composing.current) event.preventDefault(); }}>
    <SearchField defaultValue={filters.query} label="搜尋公告" placeholder="搜尋全部授權公告的標題或內容…" />
    <label className="field field--compact"><span>發布狀態</span><select defaultValue={filters.status} name="status">
      <option value="all">全部狀態</option><option value="draft">尚未發布</option><option value="scheduled">已排程</option>
      <option value="published">已發布</option><option value="expired">已到期</option><option value="withdrawn">已撤回</option>
    </select></label>
    <label className="field field--compact"><span>每頁筆數</span><select defaultValue={filters.pageSize} name="pageSize">
      <option value="20">20 則</option><option value="50">50 則</option><option value="100">100 則</option>
    </select></label>
    <input name="page" type="hidden" value="1" />
    <button className="button button--secondary" type="submit">套用</button>
    {filters.query || filters.status !== "all" ? <NavigationLink className="button button--quiet" loadingLabel="全部授權公告" href={STAFF_ANNOUNCEMENT_PATH} prefetch={false}>清除篩選</NavigationLink> : null}
  </form>;
}
