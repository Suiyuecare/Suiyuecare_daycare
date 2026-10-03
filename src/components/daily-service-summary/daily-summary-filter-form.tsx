"use client";

import { useRef, useState } from "react";

import { dailyServiceSummaryHref, validDailyServiceDate } from "@/lib/daily-service-summary/query";
import type { DailyServiceSummaryFilters, DailySummaryClientOption } from "@/lib/daily-service-summary/types";

import styles from "./daily-service-summary.module.css";

const path = "/app/staff/service-management/daily-summary";

function SubmitButton() {
  return <button className={`button button--secondary ${styles.submit}`} type="submit">
    套用篩選
  </button>;
}

export function DailySummaryFilterForm({ filters, clientOptions }: {
  filters: DailyServiceSummaryFilters;
  clientOptions: readonly DailySummaryClientOption[];
}) {
  const dateInput = useRef<HTMLInputElement>(null);
  const [dateError, setDateError] = useState("");

  // A native GET reloads the authorization and care snapshot on Back/Forward.
  return <form action={`${path}#daily-summary-results`} className={`filter-bar ${styles.filters}`}
    method="get" noValidate
    onSubmit={(event) => {
      const date = dateInput.current?.value ?? "";
      if (validDailyServiceDate(date)) return;
      event.preventDefault();
      setDateError("請選擇 2000 至 2200 年間的有效日期。");
      dateInput.current?.focus();
    }}>
    <label className="field field--compact"><span>日期</span>
      <input aria-describedby={dateError ? "daily-summary-date-error" : undefined}
        aria-invalid={dateError ? "true" : undefined} defaultValue={filters.serviceDate}
        max="2200-12-31" min="2000-01-01" name="date" onChange={() => setDateError("")}
        ref={dateInput} required type="date" />
      {dateError ? <small className={styles.fieldError} id="daily-summary-date-error" role="alert">{dateError}</small> : null}
    </label>
    <label className="field field--compact"><span>個案</span>
      <select defaultValue={filters.clientId ?? ""} name="client">
        <option value="">全部已授權個案</option>
        {clientOptions.map((client) => <option key={client.clientId}
          value={client.clientId}>{client.displayName}</option>)}
      </select></label>
    <label className="field field--compact"><span>資料完整度</span>
      <select defaultValue={filters.completeness} name="completeness">
        <option value="all">全部</option><option value="complete">可讀來源皆有紀錄</option>
        <option value="incomplete">可讀來源有缺紀錄</option>
        <option value="limited_access">含未授權來源</option>
      </select></label>
    <SubmitButton />
    <a className="button button--quiet" href={`${path}${dailyServiceSummaryHref({ ...filters, clientId: null, completeness: "all" })}#daily-summary-results`}>
      清除其他條件
    </a>
  </form>;
}
