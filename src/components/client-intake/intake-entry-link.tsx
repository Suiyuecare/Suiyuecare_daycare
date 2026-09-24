import Link from "next/link";
import { INTAKE_PATH } from "@/lib/client-intake/model";

export function IntakeEntryLink({ allowed, clientId }: { allowed: boolean; clientId?: string }) {
  if (!allowed) return null;
  return <Link className="button button--primary" href={clientId ? `${INTAKE_PATH}?client=${encodeURIComponent(clientId)}` : INTAKE_PATH}>個案匯入與收案</Link>;
}
