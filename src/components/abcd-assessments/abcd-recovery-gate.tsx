"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

type RecoveryStatus = { kind: "loading" | "error" | "ready";
  pendingClientIds: readonly string[]; pendingTruncated: boolean };
type RecoveryGate = { report: (status: RecoveryStatus) => void;
  canStart: (clientId: string) => boolean; reasonFor: (clientId: string) => string | null };

const RecoveryGateContext = createContext<RecoveryGate | null>(null);
const OUTSIDE_GATE: RecoveryGate = { report: () => {}, canStart: () => true, reasonFor: () => null };

/** A read failure or unresolved original pauses new writes, never an exact retry. */
export function AbcdRecoveryGateProvider({ children, scope }: { children: ReactNode; scope: string }) {
  const [status, setStatus] = useState<RecoveryStatus & { scope: string }>({
    scope, kind: "loading", pendingClientIds: [], pendingTruncated: false,
  });
  const report = useCallback((next: RecoveryStatus) => setStatus({ ...next, scope }), [scope]);
  const value = useMemo<RecoveryGate>(() => {
    const active = status.scope === scope ? status : { kind: "loading", pendingClientIds: [],
      pendingTruncated: false } as const;
    return { report,
      canStart: (clientId) => active.kind === "ready" && !active.pendingTruncated &&
        !active.pendingClientIds.includes(clientId),
      reasonFor: (clientId) => active.kind === "loading" ? "正在查證最近操作，請稍候。" :
        active.kind === "error" ? "原筆結果無法查證，暫停新操作。" :
          active.pendingTruncated ? "待確認筆數過多，請先縮小個案範圍。" :
            active.pendingClientIds.includes(clientId) ? "此個案有原筆待確認；請先查證。" : null,
    };
  }, [report, scope, status]);
  return <RecoveryGateContext.Provider value={value}>{children}</RecoveryGateContext.Provider>;
}

export function useAbcdRecoveryGate(): RecoveryGate {
  return useContext(RecoveryGateContext) ?? OUTSIDE_GATE;
}
