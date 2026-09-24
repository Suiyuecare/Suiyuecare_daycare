import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),reauth:vi.fn(),db:vi.fn(),rpc:vi.fn()}));vi.mock("server-only",()=>({}));
vi.mock("@/lib/integrations/http",async original=>({...await original<typeof import("@/lib/integrations/http")>(),authorizeStaffRequest:mocks.authorize}));
vi.mock("@/lib/form-governance/lifecycle-auth",()=>({requireCustomFormAal2:mocks.reauth}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:mocks.db}));
import { GET,POST } from "./route";
const id="ac000000-0000-4000-8000-000000000001",next="ac000000-0000-4000-8000-000000000002";
const actor={organizationId:id,branchId:next,userId:id,scopes:["forms.manage"],demo:false};
const input={action:"clone",formVersionId:id,requestId:null,reason:"合成改版原因"};
const event={branchId:next,branchName:"合成分支",...input,id:next,newVersionId:next,actorId:id,effectiveThrough:null,createdAt:"2026-09-22T08:00:00+00:00",byCurrentUser:true};
function request(body:unknown=input){return new Request("https://example.invalid/api/forms/lifecycle",{method:"POST",headers:{"Idempotency-Key":next},body:JSON.stringify(body)});}
describe("lifecycle API",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.authorize.mockResolvedValue(actor);mocks.reauth.mockResolvedValue(undefined);mocks.db.mockResolvedValue({rpc:(...args:unknown[])=>({abortSignal:()=>mocks.rpc(...args)})});mocks.rpc.mockResolvedValue({data:{event,replayed:false},error:null});});
 it("writes only context-derived tenant and binds receipt",async()=>{const result=await POST(request());expect(result.status).toBe(201);expect(mocks.rpc).toHaveBeenCalledWith("write_custom_form_lifecycle",{p_org:id,p_branch:next,p_key:next,p_input:input});expect(result.headers.get("cache-control")).toContain("no-store");expect(mocks.reauth).toHaveBeenCalledWith(actor);});
 it.each([{...actor,demo:true},{...actor,scopes:[]}])("rejects unprivileged before data calls",async value=>{mocks.authorize.mockResolvedValue(value);expect((await POST(request())).status).toBe(403);expect(mocks.db).not.toHaveBeenCalled();});
 it.each([{...input,organizationId:id},{...input,action:"delete"},{...input,reason:"短"},{...input,requestId:next}])("strict input %#",async body=>{expect((await POST(request(body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each([["42501",403],["23514",409],["23505",409],["22023",400],["XX000",503]])("safe SQL mapping %s",async(code,status)=>{mocks.rpc.mockResolvedValue({data:null,error:{code,message:"SECRET_BODY"}});const result=await POST(request());expect(result.status).toBe(status);expect(await result.text()).not.toContain("SECRET_BODY");});
 it("invalid or mismatched receipt never becomes success",async()=>{mocks.rpc.mockResolvedValue({data:{event:{...event,actorId:next},replayed:false},error:null});expect((await POST(request())).status).toBe(409);});
 it("strict read params and history scope",async()=>{expect((await GET(new Request(`https://example.invalid?version=${id}&version=${next}`))).status).toBe(400);mocks.rpc.mockResolvedValue({data:{formVersionId:id,events:[],total:0,truncated:false},error:null});expect((await GET(new Request(`https://example.invalid?version=${id}`))).status).toBe(200);expect(mocks.reauth).not.toHaveBeenCalled();});
});
