import Link from "next/link";
import { INTAKE_PATH } from "@/lib/client-intake/model";

export function IntakeEntryLink({ allowed, clientId, clientName, label = "個案匯入與收案", variant = "primary" }: {
  allowed: boolean;
  clientId?: string;
  clientName?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  if (!allowed) return null;
  return <Link aria-label={clientName ? `開啟 ${clientName} 的收案資料` : undefined}
    className={`button button--${variant}`} data-case-client-id={clientId}
    href={clientId ? `${INTAKE_PATH}?client=${encodeURIComponent(clientId)}` : INTAKE_PATH}
    prefetch={false}>{label}</Link>;
}
