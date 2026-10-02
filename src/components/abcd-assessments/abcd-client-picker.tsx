"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { SearchField } from "@/components/ui/search-field";
import type { AbcdClientSearchResult } from "@/lib/abcd-assessments/client-search";
import type { AbcdAssessmentFilters, AbcdClientOption } from "@/lib/abcd-assessments/types";

import styles from "./abcd-client-picker.module.css";

const uuid = z.uuid();
const result = z.object({
  organizationId: uuid,
  branchId: uuid,
  clients: z.array(z.object({ clientId: uuid, displayName: z.string().min(1).max(120),
    clientCode: z.string().max(64), clientCodeTruncated: z.boolean() }).strict()).max(20),
  hasMore: z.boolean(),
}).strict();
const envelope = z.object({ requestId: uuid, status: z.literal("ok"), data: result,
  errors: z.array(z.unknown()).length(0) }).strict();

type SearchState = { query: string; organizationId: string; branchId: string;
  kind: "loading" | "results" | "error" | "rate_limited" | "denied";
  data?: AbcdClientSearchResult };

export function AbcdClientPicker({ basePath, filters, organizationId, branchId, demo, demoClients,
  selectedClientName }: {
    basePath: string; filters: AbcdAssessmentFilters; organizationId: string; branchId: string;
    demo: boolean; demoClients: readonly AbcdClientOption[]; selectedClientName: string | null;
  }) {
  const [query, setQuery] = useState("");
  const [compositionRevision, setCompositionRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const [search, setSearch] = useState<SearchState | null>(null);
  const composing = useRef(false);
  const firstResult = useRef<HTMLAnchorElement>(null);
  const activeRequest = useRef(0);
  const normalizedQuery = query.trim();
  const queryLength = [...normalizedQuery].length;
  const queryValid = queryLength >= 2 && queryLength <= 64 && !/\p{Cc}/u.test(normalizedQuery);
  const demoMatches = demo && queryValid ? demoClients.filter((client) =>
    client.displayName.includes(normalizedQuery)) : [];
  const demoSearch: SearchState | null = demo && queryValid ? { query: normalizedQuery,
    organizationId, branchId, kind: "results", data: { organizationId, branchId,
      clients: demoMatches.slice(0, 20).map((client) => ({ ...client, clientCode: "",
        clientCodeTruncated: false })), hasMore: demoMatches.length > 20 } } : null;
  const visibleSearch = demo ? demoSearch : search?.query === normalizedQuery &&
    search.organizationId === organizationId && search.branchId === branchId ? search : null;

  useEffect(() => {
    if (!queryValid || composing.current || demo) return;
    const controller = new AbortController();
    const revision = ++activeRequest.current;
    const timer = setTimeout(() => {
      setSearch({ query: normalizedQuery, organizationId, branchId, kind: "loading" });
      const timeout = setTimeout(() => controller.abort(), 12_000);
      void (async () => {
        try {
          const response = await fetch("/api/abcd-assessments/client-search", {
            method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: normalizedQuery }), signal: controller.signal,
          });
          if (response.status === 429) throw new Error("rate_limited");
          if (response.status === 401 || response.status === 403) throw new Error("denied");
          if (response.status !== 200 || response.redirected) throw new Error("unavailable");
          const parsed = envelope.safeParse(await response.json());
          if (!parsed.success || parsed.data.data.organizationId !== organizationId ||
            parsed.data.data.branchId !== branchId ||
            new Set(parsed.data.data.clients.map((client) => client.clientId)).size !==
              parsed.data.data.clients.length) throw new Error("invalid response");
          if (controller.signal.aborted || activeRequest.current !== revision) return;
          setSearch({ query: normalizedQuery, organizationId, branchId,
            kind: "results", data: parsed.data.data });
        } catch (error) {
          if (controller.signal.aborted || activeRequest.current !== revision) return;
          setSearch({ query: normalizedQuery, organizationId, branchId,
            kind: error instanceof Error && error.message === "rate_limited" ? "rate_limited" :
              error instanceof Error && error.message === "denied" ? "denied" : "error" });
        } finally { clearTimeout(timeout); }
      })();
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [branchId, compositionRevision, demo, normalizedQuery, organizationId, queryValid, retryRevision]);

  function clientHref(clientId: string) {
    const params = new URLSearchParams();
    params.set("client", clientId);
    if (filters.assessmentYear !== null) params.set("year", String(filters.assessmentYear));
    if (filters.assessmentType !== "all") params.set("type", filters.assessmentType);
    if (filters.reassessmentState !== "all") params.set("reassessment", filters.reassessmentState);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.query) params.set("q", filters.query);
    return `${basePath}?${params.toString()}`;
  }

  return <section aria-label="搜尋評估個案" className={styles.picker}
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; setCompositionRevision((value) => value + 1); }}
    onKeyDownCapture={(event) => {
      if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
      if (composing.current || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (visibleSearch?.kind === "results") firstResult.current?.focus();
    }}>
    <div className={styles.heading}><strong>個案</strong>
      {filters.clientId && selectedClientName ? <span>目前：{selectedClientName}</span> : null}</div>
    <SearchField label="評估個案" mode="local" onValueChange={(value) => {
      setQuery(value); setSearch(null);
    }} placeholder={demo ? "搜尋展示個案姓名" : "搜尋姓名或個案代碼"} maxLength={128} value={query} />
    <div aria-live="polite" className={styles.feedback}>
      {queryLength === 0 ? <span>輸入姓名或個案代碼，即可選擇。</span> : null}
      {queryLength === 1 ? <span>再輸入 1 字即可搜尋。</span> : null}
      {queryLength > 64 || /\p{Cc}/u.test(normalizedQuery) ? <span role="alert">請輸入 2 至 64 字。</span> : null}
      {queryValid && !visibleSearch ? <span>準備搜尋…</span> : null}
      {visibleSearch?.kind === "loading" ? <span>搜尋中…</span> : null}
      {visibleSearch?.kind === "results" && visibleSearch.data ? <span>
        {visibleSearch.data.clients.length ? `找到 ${visibleSearch.data.clients.length} 位` : "沒有符合的個案"}
        {visibleSearch.data.hasMore ? "；請輸入更完整的名稱或代碼" : ""}
      </span> : null}
      {visibleSearch?.kind === "error" ? <span role="alert">暫時無法搜尋最新名單。
        <button className={styles.retry} onClick={() => setRetryRevision((value) => value + 1)} type="button">重試</button>
      </span> : null}
      {visibleSearch?.kind === "rate_limited" ? <span role="alert">搜尋過於頻繁，請稍後再試。</span> : null}
      {visibleSearch?.kind === "denied" ? <span role="alert">目前權限無法搜尋，請重新登入。</span> : null}
    </div>
    {visibleSearch?.kind === "results" && visibleSearch.data?.clients.length ?
      <ul aria-label="符合條件的個案" className={styles.results}>{visibleSearch.data.clients.map((client, index) =>
        <li key={client.clientId}><Link aria-current={client.clientId === filters.clientId ? "page" : undefined}
          aria-label={`${client.displayName}${client.clientCode ? `，個案代碼 ${client.clientCode}${client.clientCodeTruncated ? "（已截短）" : ""}` : ""}`}
          href={clientHref(client.clientId)} prefetch={false} ref={index === 0 ? firstResult : undefined}>
          <span>{client.displayName}</span>{client.clientCode ? <small>
            {client.clientCode}{client.clientCodeTruncated ? "…" : ""}</small> : null}</Link></li>)}</ul> : null}
  </section>;
}
