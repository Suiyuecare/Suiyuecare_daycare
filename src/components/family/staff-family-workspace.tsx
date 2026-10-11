import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import type { TenantContext } from "@/lib/domain/types";
import { StaffFamilyCommunication } from "./staff-family-communication";

export async function StaffFamilyWorkspace({ context, selectedClientId }: { context: TenantContext; selectedClientId?: string }) {
  if (context.demo) return <section className="empty-card"><h2>家屬溝通</h2><p>試用模式不傳送訊息或公開正式資料。</p></section>;
  const db = await createServerSupabaseClient();
  if (!db) return <section className="empty-card"><h2>家屬溝通</h2><p>資料服務暫時無法使用，請重新載入。</p></section>;
  let clients;
  try { clients = await loadAllClientDirectoryRows(db, context, "case_center", 500); } catch { clients = null; }
  if (!clients) return <section className="empty-card"><h2>家屬溝通</h2><p>個案暫時無法載入，請核對權限後重試。</p></section>;
  return <StaffFamilyCommunication key={`${context.organizationId}:${context.branchId}`} clients={clients.map(client => ({ id: client.id, name: client.display_name, code: client.client_code }))} initialClientId={z.uuid().safeParse(selectedClientId).success ? selectedClientId : ""} />;
}
