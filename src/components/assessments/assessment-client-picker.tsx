"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClientSelectionCard } from "@/components/clients/client-selection-card";

import styles from "./assessment-entry-workspace.module.css";

type ClientOption = { id: string; displayName: string; clientCode: string };

export function AssessmentClientPicker({ clients, selectedClientId, children }: {
  clients: readonly ClientOption[];
  selectedClientId: string | null;
  children: ReactNode;
}) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = clients.some((client) => client.id === selectedClientId) ? selectedClientId! : "";
  const [draftClientId, setDraftClientId] = useState(selected);
  const changingClient = Boolean(selected && draftClientId !== selected);

  function submit(event: FormEvent<HTMLFormElement>) {
    const value = selectRef.current?.value ?? "";
    if (clients.some((client) => client.id === value)) return;
    event.preventDefault();
    setError("請先選擇個案。");
    selectRef.current?.focus();
  }

  return <><form action="/app/assessments" className="client-selection-form" method="get" noValidate onSubmit={submit}>
    <ClientSelectionCard id="assessment-client" label="個案" options={clients.map((client) => ({
      value: client.id, label: `${client.displayName} · ${client.clientCode}`,
    }))} placeholder="選擇個案" placeholderDisabled defaultValue={selected}
      disabled={!clients.length}
      onValueChange={(value) => { setDraftClientId(value); setError(null); }}
      actionLabel="開始" actionDisabled={!clients.length} error={error} selectRef={selectRef} />
  </form>
    {changingClient ? <p className={styles.prompt} role="status">請按「開始」切換個案；原個案表單已暫時隱藏。</p> : children}
  </>;
}
