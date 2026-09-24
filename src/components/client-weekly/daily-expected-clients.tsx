import type { TenantContext } from "@/lib/domain/types";
import { loadDailyExpectedClients } from "@/lib/client-weekly/daily-projection-loader";
import { DailyExpectedPanel } from "./daily-expected-panel";
import styles from "./daily-expected.module.css";

export function DailyExpectedClientsLoading() {
  return <section className={styles.panel} aria-label="預計到站與接送需求"><p role="status">正在讀取每週安排與當日異動…</p></section>;
}

export async function DailyExpectedClients({ context, serviceDate, mode = "all" }: {
  context: TenantContext; serviceDate: string; mode?: "all" | "transport";
}) {
  const state = await loadDailyExpectedClients(context, serviceDate);
  return <DailyExpectedPanel key={state.status === "ready" ? state.generatedAt : state.status} state={state} mode={mode}
    canOpenIntake={context.scopes.includes("clients.demographics.read")}
    canOpenTransport={context.scopes.includes("transport_plans.read")} />;
}
