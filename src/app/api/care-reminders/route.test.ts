import { beforeEach, describe, expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ context: vi.fn(), recent: vi.fn(), rpc: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: stubs.context, hasRecentAal2: stubs.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { GET, POST } from "./route";

const id = "fa000000-0000-4000-8000-000000000001";
const key = "fa000000-0000-4000-8000-000000000002";
const actor = { organizationId:id, branchId:id, userId:id, assuranceLevel:"aal2", demo:false,
  scopes:["clients.read","health.read","care_records.read","care_records.sign","imports.manage","imports.approve"] };
const input = {action:"confirm",client_id:id,reminder_id:id,expected_status:"pending_review",reason:"已核對來源與現行照顧計畫",idempotency_key:key};
const request = (body: unknown = input) => new Request("https://example.invalid/api/care-reminders", {
  method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body),
});
const receipt = {client_id:id,action:"confirm",idempotency_key:key,replayed:false,formally_imported:false,affected:1};
describe("care reminder route boundaries",()=>{
  beforeEach(()=>{vi.clearAllMocks();stubs.context.mockResolvedValue(actor);stubs.recent.mockResolvedValue(true);stubs.client.mockResolvedValue({rpc:stubs.rpc});stubs.rpc.mockResolvedValue({data:receipt,error:null});});
  it("never forwards browser supplied clinical fields",async()=>{
    const response=await POST(request({...input,source:{label:"移位",value:"需要協助"}}));
    expect(response.status).toBe(400);expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["clients.read","health.read","care_records.read","care_records.sign","imports.manage","imports.approve"])("denies absent permission %s before touching data",async(scope)=>{
    stubs.context.mockResolvedValue({...actor,scopes:actor.scopes.filter(p=>p!==scope)});
    expect((await POST(request())).status).toBe(403);expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("does not treat demo or old verification as persistent authorized writes",async()=>{
    stubs.context.mockResolvedValue({...actor,demo:true});expect((await POST(request())).status).toBe(403);
    stubs.context.mockResolvedValue(actor);stubs.recent.mockResolvedValue(false);expect((await POST(request())).status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("uses authenticated tenant scope and requires an exact receipt",async()=>{
    const response=await POST(request());expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_care_reminders",{p_expected_organization_id:id,p_expected_branch_id:id,p_payload:input,p_idempotency_key:key});
    stubs.rpc.mockResolvedValue({data:{...receipt,client_id:key},error:null});expect((await POST(request())).status).toBe(502);
  });
  it("does not expose database messages or stacks",async()=>{
    stubs.rpc.mockResolvedValue({data:null,error:{code:"42501",message:"sensitive fixture should not leak"}});
    const response=await POST(request());expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive fixture");
  });
  it("requires authenticated case context on reads",async()=>{
    stubs.context.mockResolvedValue(null);expect((await GET(new Request(`https://example.invalid/api/care-reminders?client_id=${id}`))).status).toBe(401);
    stubs.context.mockResolvedValue(actor);expect((await GET(new Request("https://example.invalid/api/care-reminders?client_id=invalid"))).status).toBe(400);
  });
});
