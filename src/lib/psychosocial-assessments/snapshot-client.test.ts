import { afterEach, describe, expect, it, vi } from "vitest";
import { psychosocialFixture } from "./pending.test-fixtures";
import { psychosocialAssessmentAuthoritySignature } from "./pending";
import type { PsychosocialAssessmentFilters } from "./types";
import { socialWorkReadAuthoritySignature } from "@/lib/social-work-records/read-authority";
import { parsePsychosocialReadFilters, serializePsychosocialReadFilters, parsePsychosocialSnapshotEnvelope, readPsychosocialSnapshot, SnapshotReadError } from "./snapshot-client";
const filters: PsychosocialAssessmentFilters = { clientId: null, responsibleUserId: null, serviceStatus: null, dueStatus: "all" };
const nonce = "29000000-0000-4000-8000-000000000042";
const requestId = "29000000-0000-4000-8000-000000000043";
function fixture() {
 const { snapshot, context, scope } = psychosocialFixture();
 const value = { requestId, status: "ok", errors: [], data: { schemaVersion: 1, organizationId: scope.organizationId,
 branchId: scope.branchId, actorUserId: scope.userId, nonce, filters: {...filters}, snapshot, demo: false,
 capabilities: { canManage: true, canSign: true, hasRecentAal2: true }, authoritySignature: psychosocialAssessmentAuthoritySignature(context) } };
 return {value,scope,context};
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Psychosocial explicit GET recovery", () => {
 it("uses exactly the live journal authority tuple without client/server import coupling",()=>{
  const {context}=fixture();expect(socialWorkReadAuthoritySignature(context)).toBe(psychosocialAssessmentAuthoritySignature(context));
 });
 it("rejects duplicate/noncanonical grants and non-AAL2 authority",()=>{
  const {value,scope,context}=fixture();
  const tuple=JSON.parse(value.data.authoritySignature);tuple[2].push(tuple[2][0]);value.data.authoritySignature=JSON.stringify(tuple);
  expect(()=>parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now())).toThrow();
  value.data.authoritySignature=psychosocialAssessmentAuthoritySignature({...context,assuranceLevel:"aal1"});
  expect(()=>parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now())).toThrow();
 });
 it.each([{serviceStatus:"bad"},{dueStatus:"bad"},{responsibleUserId:"bad"},{dueStatus:null}])("rejects invalid status/assignee filter %#", change => {
  expect(() => serializePsychosocialReadFilters({...filters,...change} as typeof filters)).toThrow();
 });
 it("rejects backend rows outside exact bound filter rather than silently filtering", () => {
  const {value,scope}=fixture();const expected={...filters,clientId:nonce};value.data.filters=expected;
  expect(() => parsePsychosocialSnapshotEnvelope(value,scope,expected,nonce,Date.now())).toThrow("FILTER_EVIDENCE");
 });
 it("rejects a changed filter echo", () => {
  const {value,scope}=fixture();Object.assign(value.data.filters,{clientId:nonce});
  expect(() => parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now())).toThrow();
 });
 it("preserves exact filters in bounded headers", () => {
  expect(parsePsychosocialReadFilters(serializePsychosocialReadFilters(filters))).toEqual(filters);
 });
 it.each([null,"","%zz","null","[]","{}","x".repeat(4097)])("rejects malformed filter header %#", header => {
  expect(() => parsePsychosocialReadFilters(header)).toThrow();
 });
 it.each([{clientId:"bad"},{clientId:[]},{extra:true},{clientId:undefined}])("rejects nonexact filters %#", change => {
  expect(() => serializePsychosocialReadFilters({...filters,...change} as typeof filters)).toThrow();
 });
 it("correlates actor/scope/nonce/exact filters and retains original generation", () => {
  const {value,scope}=fixture();
  const result=parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.parse(value.data.snapshot.generatedAt));
  expect(result.snapshot.generatedAt).toBe(value.data.snapshot.generatedAt);
  expect(result.authoritySignature).toBe(value.data.authoritySignature);
  expect(result.capabilities).toEqual(value.data.capabilities);
 });
 it.each([{nonce:requestId},{actorUserId:nonce},{organizationId:nonce},{branchId:nonce},{demo:true},{schemaVersion:2},{secret:"private"}])("rejects incorrect envelope binding %#", change => {
  const {value,scope}=fixture(); Object.assign(value.data,change);
  expect(() => parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now())).toThrow();
 });
 it.each([{branchId:nonce},{demo:true},{staleAfter:"2099-01-01T00:00:00Z"},{secret:"private"}])("rejects invalid backend snapshot %#", change => {
  const {value,scope}=fixture(); Object.assign(value.data.snapshot,change);
  expect(() => parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now())).toThrow();
 });
 it.each([-1,60000,NaN,Infinity])("rejects future/expired/nonfinite observed generation %#", offset => {
  const {value,scope}=fixture(); expect(() => parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.parse(value.data.snapshot.generatedAt)+offset)).toThrow();
 });
 it.each(["not-json",JSON.stringify([[nonce,nonce,nonce,false],[],["clients.read","social_work_records.read"],"aal2"]),
 JSON.stringify([[nonce,nonce,nonce,false],[],[],"aal1"])])("rejects malformed/cross-actor authority %#", authoritySignature => {
  const {value,scope}=fixture(); value.data.authoritySignature=authoritySignature;
  expect(() => parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now())).toThrow();
 });
 it("rejects capability escalation without current actual scopes", () => {
  const {value,scope,context}=fixture(); value.data.authoritySignature=psychosocialAssessmentAuthoritySignature({...context,scopes:["clients.read","social_work_records.read"]});
  expect(() => parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now())).toThrow();
  value.data.capabilities={canManage:false,canSign:false,hasRecentAal2:false};
  expect(parsePsychosocialSnapshotEnvelope(value,scope,filters,nonce,Date.now()).capabilities.canManage).toBe(false);
 });
 it("makes one no-store GET, no clinical body/key/write/retry", async () => {
  const {scope}=fixture(); const fetch=vi.fn(async (_url:unknown,init:RequestInit) => {
   const {value}=fixture(); value.data.nonce=new Headers(init.headers).get("x-psychosocial-read-nonce")!; return Response.json(value);
  }); vi.stubGlobal("fetch",fetch);
  await readPsychosocialSnapshot(scope,filters,new AbortController().signal);
  expect(fetch).toHaveBeenCalledOnce(); const [url,init]=fetch.mock.calls[0]!;
  expect(url).toBe("/api/psychosocial-assessments/snapshot"); expect(init).toMatchObject({method:"GET",cache:"no-store",credentials:"same-origin",redirect:"error"});
  expect(init.body).toBeUndefined(); expect(new Headers(init.headers).get("idempotency-key")).toBeNull();
  expect(init.signal).toBeInstanceOf(AbortSignal);
 });
 it.each([401,403,500,201,302])("does not parse or retry unavailable response %#", async status => {
  const {scope}=fixture(); const json=vi.fn(); const fetch=vi.fn().mockResolvedValue({status,json}); vi.stubGlobal("fetch",fetch);
  await expect(readPsychosocialSnapshot(scope,filters)).rejects.toThrow("UNAVAILABLE"); expect(json).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  await expect(readPsychosocialSnapshot(scope,filters)).rejects.toMatchObject({status,code:"UNAVAILABLE"});
 });
 it("exposes only safe malformed response metadata",async()=>{
  const {scope}=fixture();vi.stubGlobal("fetch",vi.fn().mockResolvedValue({status:200,json:async()=>{throw new Error("CLINICAL_SECRET");}}));
  const error=await readPsychosocialSnapshot(scope,filters).catch(error=>error);
  expect(error).toBeInstanceOf(SnapshotReadError);expect(error).toMatchObject({status:200,code:"INVALID_RESPONSE"});expect(String(error)).not.toContain("CLINICAL_SECRET");
 });
 it("does not accept a late response after abort",async()=>{
  const {scope}=fixture();const controller=new AbortController();
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{const {value}=fixture();value.data.nonce=new Headers(init.headers).get("x-psychosocial-read-nonce")!;controller.abort();return Response.json(value);}));
  await expect(readPsychosocialSnapshot(scope,filters,controller.signal)).rejects.toMatchObject({status:null,code:"ABORTED"});
 });
 it("redacts transport errors and never retries",async()=>{
  const {scope}=fixture();const fetch=vi.fn().mockRejectedValue(new Error("CLINICAL_SECRET"));vi.stubGlobal("fetch",fetch);
  const error=await readPsychosocialSnapshot(scope,filters).catch(error=>error);expect(error).toMatchObject({status:null,code:"UNAVAILABLE"});expect(String(error)).not.toContain("CLINICAL_SECRET");expect(fetch).toHaveBeenCalledOnce();
 });
 it("rejects malformed input before outgoing requests", async () => {
  const {scope}=fixture(); const fetch=vi.fn(); vi.stubGlobal("fetch",fetch);
  await expect(readPsychosocialSnapshot({...scope,userId:"bad"},filters)).rejects.toThrow();
  await expect(readPsychosocialSnapshot(scope,{...filters,clientId:"bad"})).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
 });
});
