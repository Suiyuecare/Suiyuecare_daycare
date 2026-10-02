import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";
import { swFixture } from "@/lib/social-work-records/pending-fixtures.test-helper";
import { serializeSocialWorkReadFilters, readSocialWorkSnapshot } from "@/lib/social-work-records/snapshot-client";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),recent:vi.fn(),load:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/social-work-records/reauth",()=>({getSocialWorkRecentAal2At:mocks.recent}));
vi.mock("@/lib/social-work-records/snapshot",()=>({loadSocialWorkRecordSnapshot:mocks.load}));
vi.mock("@/lib/integrations/http",()=>({authorizeStaffRequest:mocks.authorize,
 handleIntegrationRoute:async(fn:(id:string)=>Promise<Response>)=>{
  const id="29000000-0000-4000-8000-000000000045";
  try{return await fn(id);}catch(error){const e=error as IntegrationError;
   return Response.json({requestId:id,status:"error",data:null,errors:[{code:e.code??"UNKNOWN",message:e.message}]},
    {status:e.httpStatus??500,headers:{"Cache-Control":"private, no-store, max-age=0"}});}
 }}));
import { GET } from "./route";
const filters={ dateFrom: null, dateTo: null, clientId: null, serviceType: null, authorUserId: null };
const nonce="29000000-0000-4000-8000-000000000042";
function request(headers:Record<string,string|undefined>={},query=""){
 const {scope}=swFixture();
 return new Request("https://example.invalid/api/social-work-records/snapshot"+query,{headers:{
 "x-organization-id":scope.organizationId,"x-branch-id":scope.branchId,"x-social-work-read-nonce":nonce,
 "x-social-work-read-filters":serializeSocialWorkReadFilters(filters),...Object.fromEntries(Object.entries(headers).filter((entry): entry is [string,string] => entry[1] !== undefined))}});
}
beforeEach(()=>{vi.resetAllMocks();const {context,snapshot}=swFixture();mocks.authorize.mockResolvedValue(context);mocks.load.mockResolvedValue(snapshot);mocks.recent.mockResolvedValue(null);});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("SocialWork exact authorized recovery GET",()=>{
 it("rejects unauthenticated before any read/evidence query",async()=>{
  mocks.authorize.mockRejectedValue(new IntegrationError("AUTH_REQUIRED","請先登入",401));
  expect((await GET(request())).status).toBe(401);expect(mocks.load).not.toHaveBeenCalled();expect(mocks.recent).not.toHaveBeenCalled();
 });
 it.each([{demo:true},{assuranceLevel:"aal1"},{scopes:[]},{scopes:["clients.read"]},{scopes:["social_work_records.read"]}])("rejects denied read authority before parsing %#",async change=>{
  mocks.authorize.mockResolvedValue({...swFixture().context,...change});
  const response=await GET(request({"x-social-work-read-filters":"bad"}));expect(response.status).toBe(403);
  expect(mocks.load).not.toHaveBeenCalled();expect(mocks.recent).not.toHaveBeenCalled();
 });
 it.each([{"x-social-work-read-nonce":"bad"},{"x-social-work-read-nonce":""},{"x-social-work-read-nonce":nonce+","+nonce},
 {"x-social-work-read-filters":"%zz"},{"x-social-work-read-filters":"x".repeat(4097)},
 {"x-social-work-read-filters":encodeURIComponent(JSON.stringify({...filters,actorUserId:nonce}))}])("rejects malformed headers before data query %#",async headers=>{
  expect((await GET(request(headers))).status).toBe(400);expect(mocks.load).not.toHaveBeenCalled();expect(mocks.recent).not.toHaveBeenCalled();
 });
 it.each(["?actor=other","?status=all&status=draft","?q=secret"])("never accepts URL identity/filter %#",async query=>{
  expect((await GET(request({},query))).status).toBe(400);expect(mocks.load).not.toHaveBeenCalled();
 });
 it.each(["x-organization-id","x-branch-id"])("rejects mismatched authorized scope %#",async header=>{
  expect((await GET(request({[header]:nonce}))).status).toBe(403);expect(mocks.load).not.toHaveBeenCalled();
 });
 it("reads without manage/sign permission and skips unused sign evidence",async()=>{
  const context={...swFixture().context,scopes:["clients.read","social_work_records.read"]};mocks.authorize.mockResolvedValue(context);
  const response=await GET(request());expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith(context,filters);expect(mocks.recent).not.toHaveBeenCalled();
  const body=await response.json();expect(body.data.capabilities).toEqual({canManage:false,canSign:false,hasRecentAal2:false});
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
 });
 it("derives current scopes and actual scoped recent evidence without forging context time",async()=>{
  mocks.recent.mockResolvedValue("2026-09-26T11:59:00.000Z");
  const response=await GET(request());expect(response.status).toBe(200);const data=(await response.json()).data;
  expect(data).toMatchObject({schemaVersion:1,actorUserId:swFixture().context.userId,nonce,filters,demo:false,
   capabilities:{canManage:true,canSign:true,hasRecentAal2:true}});
  expect(mocks.recent).toHaveBeenCalledExactlyOnceWith(swFixture().context);
  expect(swFixture().context.recentAal2At).toBeNull();
 });
 it.each([{branchId:nonce},{demo:true},{private_note:"CLINICAL_SECRET"},{staleAfter:"2099-01-01T00:00:00Z"}])("rejects malformed projections privacy-safely %#",async change=>{
  mocks.load.mockResolvedValue({...swFixture().snapshot,...change});const response=await GET(request());
  expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain("CLINICAL_SECRET");
 });
 it("does not return stale data as fresh",async()=>{
  const snapshot=swFixture().snapshot;const generatedAt=new Date(Date.now()-61000).toISOString();
  mocks.load.mockResolvedValue({...snapshot,generatedAt,staleAfter:new Date(Date.parse(generatedAt)+60000).toISOString()});
  expect((await GET(request())).status).toBe(503);
 });
 it("redacts unavailable backend errors rather than returning fake empty/demo data",async()=>{
  mocks.load.mockRejectedValue(new Error("CLINICAL_SECRET"));const response=await GET(request());
  expect(response.status).toBe(503);const body=await response.json();expect(body.data).toBeNull();expect(JSON.stringify(body)).not.toContain("CLINICAL_SECRET");
 });
 it("actual GET route and browser transport correlate same actor/nonce, no mutation transport",async()=>{
  const fetch=vi.fn(async(url:unknown,init:RequestInit)=>GET(new Request("https://example.invalid"+url,{...init,signal:undefined})));vi.stubGlobal("fetch",fetch);
  const {scope}= swFixture();const result=await readSocialWorkSnapshot(scope,filters);
  expect(result.snapshot.demo).toBe(false);expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0]![1].method).toBe("GET");
  expect(fetch.mock.calls[0]![1].body).toBeUndefined();expect(mocks.load).toHaveBeenCalledOnce();
 });
});
