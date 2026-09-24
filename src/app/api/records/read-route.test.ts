import { beforeEach, describe, expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorize, readJsonObject: (request: Request) => request.json(),
  databaseFailure: (code: string, message: string, httpStatus: number) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (run: (id: string) => Promise<Response>) => {
    try { return await run("synthetic-request"); } catch (error) { const value=error as {code:string;httpStatus:number}; return Response.json({error:value.code},{status:value.httpStatus ?? 500}); }
  },
}));
vi.mock("@/lib/supabase/server", () => ({createServerSupabaseClient:stubs.client}));
import { GET } from "./route";
const id="b0100000-0000-4000-8000-000000000001";
const other="b0100000-0000-4000-8000-000000000002";
const record={id,record_key:id,version:1,client_id:id,status:"draft",occurred_at:"2026-09-12T01:00:00Z",fields:{shift:"morning",care_item:"synthetic care",note:"synthetic observation",abnormal:false},previous_version_id:null,correction_reason:null,signed_at:null,signed_by:null,content_hash:null,created_by:id,created_at:"2026-09-12T01:00:00Z",correction_source_id:null};
const request=()=>new Request(`https://example.invalid/api/records?client=${id}`);
describe("care diary read projection",()=>{
  beforeEach(()=>{vi.resetAllMocks();stubs.authorize.mockResolvedValue({organizationId:id,branchId:id,userId:id,demo:false,assuranceLevel:"aal1",recentAal2At:null,scopes:["care_records.read"]});stubs.client.mockResolvedValue({rpc:stubs.rpc});});
  it("accepts only records for the requested client",async()=>{
    stubs.rpc.mockResolvedValue({data:{records:[record],history:[]},error:null});
    expect((await GET(request())).status).toBe(200);
    expect(stubs.authorize).toHaveBeenCalledExactlyOnceWith({routinePermission:"care_records.read"});
    stubs.rpc.mockResolvedValue({data:{records:[{...record,client_id:other}],history:[]},error:null});
    const response=await GET(request());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain("synthetic observation");
  });
  it("rejects unrelated history even when all current rows belong to the correct client",async()=>{
    stubs.rpc.mockResolvedValue({data:{records:[record],history:[{id:other,record_key:other,version:1,status:"draft",previous_version_id:null,correction_reason:null,created_at:"2026-09-12T01:00:00Z",signed_at:null,signed_by:null,content_hash:null}]},error:null});
    expect((await GET(request())).status).toBe(503);
  });
});
