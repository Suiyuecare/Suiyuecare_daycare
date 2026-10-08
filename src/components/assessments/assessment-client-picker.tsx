"use client";

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
  const operationPending = usePendingOperations();
  const scopePending = useScopeChangePendingReason();
  const locked = operationPending || scopePending !== null;
  return <form action="/app/staff/assessments/external-results" className={styles.picker} method="get"
    onSubmit={(event) => {
      if (hasPendingOperations() || hasScopeChangePending()) event.preventDefault();
    }}>
    {initialExternalInstrument ? <input name="externalInstrument" type="hidden" value={initialExternalInstrument} /> : null}
    <label htmlFor="assessment-client">個案</label>
    <select defaultValue={selectedClientId ?? ""} disabled={locked} id="assessment-client" name="client" required>
      <option disabled value="">選擇個案</option>
      {clients.map((client) => <option key={client.id} value={client.id}>
        {client.displayName} · {client.clientCode}
      </option>)}
    </select>
    <button className="button button--primary" disabled={locked} type="submit">開始<ArrowRight aria-hidden="true" /></button>
    {locked ? <p role="status">請先確認上一筆儲存結果，再更換個案。</p> : null}
  </form>;
}
