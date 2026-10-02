"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { fetchJsonWithTimeout, fetchWithTimeout } from "@/lib/api/client-fetch";
import type { AbcdClientOption } from "@/lib/abcd-assessments/types";

import { useAbcdRecoveryGate } from "./abcd-recovery-gate";
import styles from "./abcd-operation-recovery.module.css";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const instant = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const operation = z.object({ reservationId: uuid, clientId: uuid,
  operation: z.enum(["create", "revise", "sign", "correct"]),
  assessmentType: z.enum(["A", "B", "C", "D"]), assessmentYear: z.number().int().min(2000).max(2200),
  baselineVersion: z.number().int().min(0), state: z.enum(["pending", "committed"]),
  createdAt: instant, committedAt: instant.nullable() }).strict();
const summary = z.object({ organizationId: uuid, branchId: uuid, clientId: uuid.nullable(),
  generatedAt: instant, absenceIsFinal: z.literal(false), truncated: z.boolean(),
  pendingTruncated: z.boolean(), operations: z.array(operation).max(20) }).strict();
const envelope = z.object({ status: z.literal("ok"), requestId: uuid,
  errors: z.array(z.unknown()).length(0), data: summary }).passthrough();
const continuation = z.object({ status: z.literal("ok"), requestId: uuid,
  errors: z.array(z.unknown()).length(0), data: z.object({ reservationId: uuid,
    organizationId: uuid, branchId: uuid, clientId: uuid, persisted: z.literal(true),
    demo: z.literal(false) }).passthrough() }).passthrough();
type RecoverySummary = z.output<typeof summary>;
type RecoveryOperation = z.output<typeof operation>;
type ReadState = { kind: "loading" | "error" | "ready"; snapshot: RecoverySummary | null };

const OPERATION_LABEL: Record<RecoveryOperation["operation"], string> = {
  create: "建立", revise: "修訂", sign: "簽署", correct: "更正",
};

function taipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

/** Server-owned operation lookup: never saves the original key or clinical body in browser storage. */
export function AbcdOperationRecovery({ organizationId, branchId, clients, selectedClientId, enabled, hasRecentAal2 }: {
  organizationId: string; branchId: string; clients: readonly AbcdClientOption[];
  selectedClientId: string | null; enabled: boolean; hasRecentAal2: boolean;
}) {
  const router = useRouter();
  const { report } = useAbcdRecoveryGate();
  const owner = `${organizationId}:${branchId}:${selectedClientId ?? "all"}:${enabled}`;
  const ownerRef = useRef(owner);
  const [read, setRead] = useState<ReadState>({ kind: "loading", snapshot: null });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    ownerRef.current = owner;
    return () => { ownerRef.current = ""; };
  }, [owner]);

  const load = useCallback(async (signal?: AbortSignal): Promise<RecoverySummary | null> => {
    const expectedOwner = `${organizationId}:${branchId}:${selectedClientId ?? "all"}:${enabled}`;
    setRead({ kind: "loading", snapshot: null });
    report({ kind: "loading", pendingClientIds: [], pendingTruncated: false });
    try {
      const path = selectedClientId ?
        `/api/abcd-assessments/recovery?client_id=${encodeURIComponent(selectedClientId)}` :
        "/api/abcd-assessments/recovery";
      const { payload } = await fetchJsonWithTimeout(path, { signal });
      const parsed = envelope.safeParse(payload);
      if (!parsed.success || parsed.data.data.organizationId !== organizationId ||
        parsed.data.data.branchId !== branchId || parsed.data.data.clientId !== selectedClientId ||
        parsed.data.data.operations.some((item) =>
          (item.state === "committed") !== (item.committedAt !== null))) throw new Error("invalid recovery summary");
      if (ownerRef.current !== expectedOwner || signal?.aborted) return null;
      setRead({ kind: "ready", snapshot: parsed.data.data });
      report({ kind: "ready", pendingClientIds: parsed.data.data.operations
        .filter((item) => item.state === "pending").map((item) => item.clientId),
      pendingTruncated: parsed.data.data.pendingTruncated });
      return parsed.data.data;
    } catch {
      if (ownerRef.current === expectedOwner && !signal?.aborted) {
        setRead({ kind: "error", snapshot: null });
        report({ kind: "error", pendingClientIds: [], pendingTruncated: false });
      }
      return null;
    }
  }, [branchId, enabled, organizationId, report, selectedClientId]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    return () => controller.abort();
  }, [enabled, load]);

  async function resume(item: RecoveryOperation) {
    if (busyId || (item.operation === "sign" || item.operation === "correct") && !hasRecentAal2) return;
    const expectedOwner = owner;
    setBusyId(item.reservationId);
    setNotice("");
    try {
      const response = await fetchWithTimeout("/api/abcd-assessments/recovery", { method: "POST",
        cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ reservation_id: item.reservationId }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || response.redirected) throw new Error("continuation unavailable");
      const parsed = continuation.safeParse(payload);
      if (!parsed.success || parsed.data.data.reservationId !== item.reservationId ||
        parsed.data.data.organizationId !== organizationId || parsed.data.data.branchId !== branchId ||
        parsed.data.data.clientId !== item.clientId) throw new Error("invalid continuation receipt");
    } catch {
      // A lost response does not prove failure. The following GET checks the immutable operation ledger.
    }
    if (ownerRef.current !== expectedOwner) return;
    const fresh = await load();
    if (ownerRef.current !== expectedOwner) return;
    if (fresh?.operations.some((candidate) => candidate.reservationId === item.reservationId &&
      candidate.clientId === item.clientId && candidate.state === "committed")) {
      setNotice("原筆已保存。畫面正在更新。");
      router.refresh();
    } else setNotice("原筆仍未確認；請勿另建新筆，稍後重查或請系統維護人員人工核對。");
    setBusyId(null);
  }

  if (!enabled) return null;
  const pending = read.snapshot?.operations.filter((item) => item.state === "pending") ?? [];
  const committed = read.snapshot?.operations.filter((item) => item.state === "committed") ?? [];
  const clientName = (clientId: string) => clients.find((item) => item.clientId === clientId)?.displayName ?? "授權個案";
  return <section aria-label="ABCD 原操作查證" className={styles.panel}>
    <div className={styles.heading}><div><h2>{pending.length ? `待確認 ${pending.length} 筆` : "最近操作"}</h2>
      <p>{read.kind === "loading" ? "正在查證最近操作…" : read.kind === "error" ?
        "暫時無法查證，請勿把結果不明的評估當成未送出。" :
        pending.length ? "先核對原筆，再建立其他紀錄。" : "可查看最近保存的評估。"}</p></div>
      <button className="button button--secondary" disabled={read.kind === "loading" || busyId !== null}
        onClick={() => { setNotice(""); void load(); }} type="button">重新查證</button></div>
    {read.kind === "error" ? <p className={styles.warning} role="alert">查證失敗；原操作仍可能已保存。請稍後再試或聯絡系統維護人員。</p> : null}
    {read.kind === "ready" && pending.length ? <ul className={styles.operations}>{pending.map((item) => <li key={item.reservationId}>
      <div><strong>{clientName(item.clientId)}・{item.assessmentYear} 年 {item.assessmentType} 類</strong>
        <small>{OPERATION_LABEL[item.operation]}・{taipei(item.createdAt)}・原版 v{item.baselineVersion}</small></div>
      {item.operation === "sign" || item.operation === "correct" ? !hasRecentAal2 ?
        <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">重新驗證</Link> :
        <button className="button button--secondary" disabled={busyId !== null} onClick={() => void resume(item)}
          type="button">{busyId === item.reservationId ? "正在核對…" : "續做原筆"}</button> :
        <button className="button button--secondary" disabled={busyId !== null} onClick={() => void resume(item)}
          type="button">{busyId === item.reservationId ? "正在核對…" : "續做原筆"}</button>}
    </li>)}</ul> : null}
    {read.kind === "ready" && !pending.length && committed.length ? <details className={styles.history}>
      <summary>最近已保存 {committed.length} 筆</summary><ul>{committed.map((item) => <li key={item.reservationId}>
        {clientName(item.clientId)}・{item.assessmentYear} 年 {item.assessmentType} 類・
        {OPERATION_LABEL[item.operation]}・{taipei(item.committedAt!)}
      </li>)}</ul></details> : null}
    {read.kind === "ready" && !read.snapshot?.operations.length ? <details className={styles.history}>
      <summary>最近 24 小時查無可見操作</summary><p>查無紀錄不能證明剛才的送出未發生。若曾遇到結果不明，請勿另建新筆，稍後重查。</p>
    </details> : null}
    {read.snapshot?.pendingTruncated ? <p className={styles.warning} role="alert">待確認超過 20 筆；{selectedClientId ?
      "本頁無法顯示全部；請勿重送，交由系統維護人員人工核對。" : "請先選個案查證。"}</p> : null}
    {read.snapshot?.truncated && !read.snapshot.pendingTruncated ? <p className={styles.warning}>
      只顯示最近 20 筆；{selectedClientId ? "較早操作須人工核對，請勿重送。" : "可先選個案縮小範圍。"}</p> : null}
    {notice ? <p className={styles.warning} role="status">{notice}</p> : null}
  </section>;
}
