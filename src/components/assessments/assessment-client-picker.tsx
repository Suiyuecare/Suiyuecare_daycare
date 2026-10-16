"use client";

import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

import type { ClientMasterItem } from "@/lib/clients/master-types";
import type { ExternalAssessmentInstrument } from "@/lib/external-assessment-results/contract";
import { hasPendingOperations, usePendingOperations } from "@/lib/navigation/pending-operation-lock";
import { hasScopeChangePending, useScopeChangePendingReason } from "@/lib/navigation/scope-change-pending";

import styles from "./assessment-entry-workspace.module.css";

export function AssessmentClientPicker({
  clients,
  selectedClientId,
  initialExternalInstrument,
}: {
  clients: readonly ClientMasterItem[];
  selectedClientId: string | null;
  initialExternalInstrument: ExternalAssessmentInstrument | null;
}) {
  const [selectionError, setSelectionError] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const operationPending = usePendingOperations();
  const scopePending = useScopeChangePendingReason();
  const locked = operationPending || scopePending !== null;
  return <form action="/app/staff/assessments/external-results" className={styles.picker} method="get" noValidate
    onSubmit={(event) => {
      if (hasPendingOperations() || hasScopeChangePending()) {
        event.preventDefault();
        return;
      }
      if (!selectRef.current?.value) {
        event.preventDefault();
        setSelectionError("請先選擇個案。這頁不會讀取未選個案的評估資料。");
        selectRef.current?.focus();
      }
    }}>
    {initialExternalInstrument ? <input name="externalInstrument" type="hidden" value={initialExternalInstrument} /> : null}
    <label htmlFor="assessment-client">個案</label>
    <select aria-describedby={selectionError ? "assessment-client-error" : undefined}
      aria-invalid={selectionError ? true : undefined} defaultValue={selectedClientId ?? ""}
      disabled={locked} id="assessment-client" name="client"
      onChange={() => setSelectionError("")} ref={selectRef} required>
      <option disabled value="">選擇個案</option>
      {clients.map((client) => <option key={client.id} value={client.id}>
        {client.displayName} · {client.clientCode}
      </option>)}
    </select>
    <button className="button button--primary" disabled={locked} type="submit">開始<ArrowRight aria-hidden="true" /></button>
    {selectionError ? <p className={styles.pickerError} id="assessment-client-error" role="alert">{selectionError}</p> : null}
    {locked ? <p role="status">請先確認上一筆儲存結果，再更換個案。</p> : null}
  </form>;
}
