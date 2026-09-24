import Link from "next/link";
import { z } from "zod";
import { requireTenantContext, hasRecentAal2 } from "@/lib/auth/context";
import { canUseRoutineCare } from "@/lib/auth/routine-care";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import { FormResponsesWorkspace } from "@/components/form-responses/form-responses-workspace";
import { buildDemoFormResponses, demoFormClient } from "@/lib/custom-form-responses/demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "機構自訂表單填答" };
export default async function ClientFormsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireTenantContext("staff");
  const query = await searchParams;
  const selection = z.object({ client: z.uuid().optional() }).strict().safeParse(query);
  if (!selection.success) return <section className="panel" role="alert"><h1>個案選擇無法辨識</h1><p>未讀取任何個案，請重新選擇。</p><Link href="/app/client-forms">重新選擇</Link></section>;
  const readable = await canUseRoutineCare(actor, "care_records.read");
  if (!readable) return <section className="panel" role="alert"><h1>尚無表單填答查閱權限</h1><p>此頁沿用個案照顧紀錄與指派範圍，請主管確認授權。</p></section>;
  let clients: { id: string; label: string }[] = actor.demo ? [demoFormClient] : [];
  if (!actor.demo) {
    const db = await createServerSupabaseClient();
    if (!db) return <section className="panel" role="alert"><h1>個案資料暫時無法取得</h1><p>請稍後重新載入，沒有讀寫任何填答。</p></section>;
    try { clients = (await loadAllClientDirectoryRows(db, actor, "core_daily")).map((c) => ({ id: c.id, label: `${c.client_code}・${c.display_name}` })); }
    catch { return <section className="panel" role="alert"><h1>個案清單尚未完整載入</h1><p>為避免選錯個案，暫不開放操作。請重新載入。</p></section>; }
  }
  if (selection.data.client && !clients.some((c) => c.id === selection.data.client)) return <section className="panel" role="alert"><h1>此個案不在可查閱範圍</h1><p>未切換成其他個案，請重新選擇。</p><Link href="/app/client-forms">重新選擇</Link></section>;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const canWrite = await canUseRoutineCare(actor, "care_records.write");
  const recent = !actor.demo && await hasRecentAal2();
  const canSign = actor.scopes.includes("care_records.sign") && recent;
  const canPrint = recent && ["care_records.read", "document_printing.read", "document_printing.manage", "document_printing.access"].every((permission) => actor.scopes.includes(permission));
  const workspaceKey = [actor.organizationId, actor.branchId, actor.userId, selection.data.client ?? "", [...actor.roles].sort().join(","), [...actor.scopes].sort().join(","), canWrite, canSign, canPrint].join(":");
  return <FormResponsesWorkspace key={workspaceKey} clients={clients} initialClient={selection.data.client ?? (actor.demo ? demoFormClient.id : "")} today={today} canWrite={canWrite} canSign={canSign} canPrint={canPrint} printActor={actor.branchId ? { actorId: actor.userId, organizationId: actor.organizationId, branchId: actor.branchId } : undefined} demo={actor.demo} demoSnapshot={actor.demo ? buildDemoFormResponses(today) : undefined} />;
}
