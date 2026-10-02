"use client";

import { Search, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

import { CASE_CENTER_PATH } from "@/lib/case-center/query";

function subscribeToHydration() {
  return () => {};
}

export function CaseCenterSearchField({
  query,
  clearHref,
}: {
  query: string;
  clearHref: string;
}) {
  const [value, setValue] = useState(query);
  const enhanced = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const inputRef = useRef<HTMLInputElement>(null);
  const clearSubmitRef = useRef<HTMLButtonElement>(null);
  const composingRef = useRef(false);

  function clearSearch() {
    const input = inputRef.current;
    const submitter = clearSubmitRef.current;
    if (!input || !submitter) return;
    input.value = "";
    setValue("");
    input.focus();
    input.form?.requestSubmit(submitter);
  }

  return (
    <div className="filter-search case-center-search" data-enhanced={enhanced}>
      <Search aria-hidden="true" />
      <label className="sr-only" htmlFor="case-center-search">搜尋個案代碼或姓名</label>
      <input
        autoComplete="off"
        id="case-center-search"
        maxLength={120}
        name="q"
        onChange={(event) => setValue(event.target.value)}
        onCompositionEnd={() => { composingRef.current = false; }}
        onCompositionStart={() => { composingRef.current = true; }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing)) {
            event.preventDefault();
          }
        }}
        placeholder="搜尋個案代碼或姓名…"
        ref={inputRef}
        type="search"
        value={value}
      />
      {enhanced && value && (
        <button
          aria-label="清除搜尋"
          className="case-center-search__clear"
          onClick={clearSearch}
          type="button"
        >
          <X aria-hidden="true" />
        </button>
      )}
      <button
        formAction={`${CASE_CENTER_PATH}#case-center-search`}
        hidden
        ref={clearSubmitRef}
        tabIndex={-1}
        type="submit"
      >
        清除搜尋並更新清單
      </button>
      {query && <noscript><a href={clearHref}>清除搜尋</a></noscript>}
    </div>
  );
}

export function CaseCenterSubmitButton({ label, recovery = false }: { label: string; recovery?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button aria-busy={pending} className="button button--primary case-center-submit" disabled={pending} type="submit">
        <span>{label}</span>
        <span aria-hidden="true" className="case-center-submit__spinner" data-pending={pending} />
        <span className="sr-only" role="status">{pending ? "正在更新個案清單" : ""}</span>
      </button>
      {recovery && pending && (
        <button
          aria-label="重新載入個案結果"
          className="button button--secondary case-center-retry"
          formAction={`${CASE_CENTER_PATH}#case-center-list`}
          formMethod="get"
          type="submit"
        >
          重試
        </button>
      )}
    </>
  );
}
