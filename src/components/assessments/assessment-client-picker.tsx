"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClientSelectionCard } from "@/components/clients/client-selection-card";
import { SearchField } from "@/components/ui/search-field";

import styles from "./assessment-entry-workspace.module.css";

type ClientOption = { id: string; displayName: string; clientCode: string };

export function AssessmentClientPicker({ clients, selectedClientId, children }: {
  clients: readonly ClientOption[];
  selectedClientId: string | null;
  children: ReactNode;
}) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const selected = clients.some((client) => client.id === selectedClientId) ? selectedClientId! : "";
  const [draftClientId, setDraftClientId] = useState(selected);
  const draftClient = clients.find((client) => client.id === draftClientId);
  const validDraftId = draftClient?.id ?? "";
  const changingClient = Boolean(selected && validDraftId !== selected);
  // When the authorized roster becomes short, the search field disappears and
  // its old query must not keep filtering the invisible select.
  const normalizedQuery = (clients.length > 12 ? query : "").trim().toLocaleLowerCase("zh-TW");
  const matchingClients = normalizedQuery
    ? clients.filter((client) => `${client.displayName} ${client.clientCode}`.toLocaleLowerCase("zh-TW").includes(normalizedQuery))
    : clients;
  // Keep the currently selected option mounted while narrowing the list. A
  // native select can otherwise silently choose a different person.
  const visibleClients = draftClient && !matchingClients.some((client) => client.id === draftClient.id)
    ? [draftClient, ...matchingClients]
    : matchingClients;
  const selectedOutsideSearch = Boolean(normalizedQuery && draftClient &&
    !matchingClients.some((client) => client.id === draftClient.id));

  useEffect(() => {
    if (!selected || window.location.hash !== "#assessment-forms" || document.activeElement !== document.body) return;
    const target = document.getElementById("assessment-forms");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [selected]);

  function submit(event: FormEvent<HTMLFormElement>) {
    const value = selectRef.current?.value ?? "";
    if (value && value === validDraftId && clients.some((client) => client.id === value) && !selectedOutsideSearch) return;
    event.preventDefault();
    setError(draftClientId && !draftClient ? "這位個案目前無法選取，請重新選擇。" :
      selectedOutsideSearch ? "請選取符合搜尋的個案，或清除搜尋。" : "請先選擇個案。");
    selectRef.current?.focus();
  }

  return <>{clients.length > 12 ? <div className={styles.clientSearch}>
    <SearchField mode="local" value={query} onValueChange={setQuery}
      label="搜尋個案" placeholder="搜尋姓名或個案編號" />
    {normalizedQuery ? <p className={styles.searchStatus} role="status">
      {matchingClients.length ? `找到 ${matchingClients.length} 位個案` : "找不到符合的個案，請調整搜尋。"}
    </p> : null}
  </div> : null}
  <form action="/app/assessments#assessment-forms" className="client-selection-form" method="get" noValidate onSubmit={submit}>
    <ClientSelectionCard id="assessment-client" label="個案" options={visibleClients.map((client) => ({
      value: client.id, label: `${selectedOutsideSearch && client.id === draftClient?.id ? "原選取（不符搜尋）・" : ""}${client.displayName} · ${client.clientCode}`,
    }))} placeholder="選擇個案" placeholderDisabled value={validDraftId}
      disabled={!clients.length}
      onValueChange={(value) => { setDraftClientId(value); setError(null); }}
      actionLabel="查看表單" actionDisabled={!clients.length || selectedOutsideSearch || Boolean(draftClientId && !draftClient)} error={error} selectRef={selectRef} />
  </form>
    {changingClient || selectedOutsideSearch ? <p className={styles.prompt} role="status">
      {changingClient ? "請按「查看表單」切換個案；原個案表單已暫時隱藏。" : "請選取搜尋結果，或清除搜尋返回原個案。"}
    </p> : children}
  </>;
}
