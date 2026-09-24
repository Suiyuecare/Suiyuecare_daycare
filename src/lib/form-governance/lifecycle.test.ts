import { describe, expect, it } from "vitest";
import { lifecycleInputSchema, parseLifecycleHistory, parseLifecycleInput, parseLifecycleReceipt, pendingRetirement } from "./lifecycle";
const id="ac000000-0000-4000-8000-000000000001"; const next="ac000000-0000-4000-8000-000000000002";
const input={action:"clone" as const,formVersionId:id,requestId:null,reason:"合成改版原因"};
const event={branchId:id,branchName:"合成分支",...input,id:next,newVersionId:next,actorId:id,effectiveThrough:null,createdAt:"2026-09-22T08:00:00+00:00",byCurrentUser:true};
describe("form lifecycle contract",()=>{
  it("validates bounded inputs and UUID key",()=>{expect(parseLifecycleInput(input,id).input).toEqual(input);expect(()=>parseLifecycleInput(input,"bad")).toThrow();});
  it.each([{...input,reason:"少"},{...input,reason:"<script>"},{...input,official:true},{...input,requestId:next},{...input,action:"approve_retirement"}])("rejects malformed or unbound action %#",value=>expect(lifecycleInputSchema.safeParse(value).success).toBe(false));
  it("binds exact actor, source, action, request and reason",()=>{expect(parseLifecycleReceipt({event,replayed:false},input,id).event).toEqual(event); for(const mutation of [{actorId:next},{formVersionId:next},{reason:"不一致的原因"},{byCurrentUser:false},{newVersionId:null}])expect(()=>parseLifecycleReceipt({event:{...event,...mutation},replayed:false},input,id)).toThrow();});
  it("rejects partial or duplicate unmarked histories",()=>{expect(parseLifecycleHistory({formVersionId:id,events:[event],total:1,truncated:false},id).total).toBe(1);expect(()=>parseLifecycleHistory({formVersionId:id,events:[event,event],total:2,truncated:false},id)).toThrow();expect(()=>parseLifecycleHistory({formVersionId:id,events:[event],total:2,truncated:false},id)).toThrow();});
  it("a rejected request no longer blocks the next request",()=>{const request={...event,action:"request_retirement" as const,newVersionId:null};expect(pendingRetirement([request])).toBe(request);expect(pendingRetirement([request,{...request,id,action:"reject_retirement",requestId:next}])).toBeUndefined();});
});
