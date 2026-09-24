import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks=vi.hoisted(()=>({db:vi.fn(),rpc:vi.fn()}));vi.mock("server-only",()=>({}));vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:mocks.db}));
import { hasCustomFormGovernanceAccess, requireCustomFormAal2 } from "./lifecycle-auth";
const actor={organizationId:"11111111-1111-4111-8111-111111111111",branchId:"22222222-2222-4222-8222-222222222222",scopes:["forms.manage"],assuranceLevel:"aal2",demo:false} as TenantContext;
describe("forms-only authority preflight",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.db.mockResolvedValue({rpc:(...args:unknown[])=>({abortSignal:()=>mocks.rpc(...args)})});mocks.rpc.mockResolvedValue({data:true,error:null});});
 it("uses actual server scope and bounded forms-only RPC",async()=>{expect(await hasCustomFormGovernanceAccess(actor,true)).toBe(true);expect(mocks.rpc).toHaveBeenCalledWith("has_custom_form_governance_access",{p_org:actor.organizationId,p_branch:actor.branchId,p_write:true});});
 it.each([{...actor,assuranceLevel:"aal1" as const},{...actor,scopes:[]},{...actor,demo:true},{...actor,branchId:""}])("denies invalid mutation authority before RPC %#",async value=>{expect(await hasCustomFormGovernanceAccess(value,true)).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each([{data:false,error:null},{data:"true",error:null},{data:true,error:{code:"42501"}},{data:null,error:null}])("never infers success %#",async result=>{mocks.rpc.mockResolvedValue(result);await expect(requireCustomFormAal2(actor)).rejects.toMatchObject({code:"AAL2_REQUIRED"});});
 it("fails closed on timeout",async()=>{mocks.rpc.mockRejectedValue(new Error("connection"));expect(await hasCustomFormGovernanceAccess(actor,true)).toBe(false);});
});
