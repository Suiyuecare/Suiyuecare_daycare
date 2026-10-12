// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationPreparationSnapshot } from "@/lib/evaluation-preparation/contract";
import { hasPendingOperations, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { EvaluationEvidenceControls } from "./evaluation-evidence-controls";
import { getHeldEvidenceOperation, settleEvidenceOperation } from "./evaluation-evidence-pending";

const stubs = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stubs.refresh }) }));
const org = "79100000-0000-4000-8000-000000000001", branch = "79200000-0000-4000-8000-000000000001";
const actor = "79000000-0000-4000-8000-000000000003", version = "79300000-0000-4000-8000-000000000001";
const author = "79000000-0000-4000-8000-000000000001";
function snapshot(): EvaluationPreparationSnapshot {
  return { organizationId:org,branchId:branch,generatedAt:new Date().toISOString(),staleAfter:new Date(Date.now()+300000).toISOString(),
    page:1,pageSize:25,total:1,items:[{versionId:version,itemCode:"INTERNAL_01",version:1,previousVersionId:null,
      ownerUserId:author,dueOn:"2026-10-12",evidenceReference:version,progress:"internal_review_requested",
      changeReason:"initial",recordedBy:author,recordedAt:new Date().toISOString(),contentHash:"a".repeat(64)}],
    owners:[],reviews:[],bundles:[],evidenceOptions:[],approvedTotal:0,sourceStatus:"applicability_unapproved",formalSubmissionEnabled:false,demo:false };
}
beforeEach(() => { window.sessionStorage.clear(); stubs.refresh.mockReset(); });
afterEach(() => { cleanup();const held=getHeldEvidenceOperation();if(held)settleEvidenceOperation(held.operation);sessionStorage.clear();vi.unstubAllGlobals(); });

describe("independent evidence review safe recovery",()=>{
  it("keeps original key through unmount, refuses another scope, and never clears unknown on later denial",async()=>{
    const fetchMock=vi.fn().mockRejectedValueOnce(new Error("network interrupted"));vi.stubGlobal("fetch",fetchMock);
    const first=render(<EvaluationEvidenceControls snapshot={snapshot()} actorUserId={actor}/>);
    fireEvent.click(screen.getByRole("button",{name:"確認證據並通過"}));
    await waitFor(()=>expect(getHeldEvidenceOperation()?.phase).toBe("unknown"));
    const original=getHeldEvidenceOperation()!.operation;
    expect(hasPendingOperations()).toBe(true);expect(tryAcquireViewTransition()).toBeNull();first.unmount();
    const other=render(<EvaluationEvidenceControls snapshot={{...snapshot(),branchId:version}} actorUserId={actor}/>);
    fireEvent.click(screen.getByRole("button",{name:"核對並重試原操作"}));
    expect(screen.getByRole("alert").textContent).toContain("原分支");expect(fetchMock).toHaveBeenCalledTimes(1);other.unmount();
    fetchMock.mockResolvedValueOnce(Response.json({status:"error",errors:[{code:"EVIDENCE_NOT_AUTHORIZED",message:"撤權"}]},{status:403}));
    render(<EvaluationEvidenceControls snapshot={snapshot()} actorUserId={actor}/>);
    fireEvent.click(screen.getByRole("button",{name:"核對並重試原操作"}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(getHeldEvidenceOperation()?.phase).toBe("unknown"));
    expect(getHeldEvidenceOperation()?.operation).toBe(original);expect(hasPendingOperations()).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(original.input);
    fetchMock.mockResolvedValueOnce(Response.json({status:"ok",data:{organizationId:org,branchId:branch,actorUserId:actor,
      idempotencyKey:original.input.idempotency_key,formalSubmissionEnabled:false,versionId:version,reviewId:branch,decision:"approved"}}));
    fireEvent.click(screen.getByRole("button",{name:"核對並重試原操作"}));
    await waitFor(()=>expect(getHeldEvidenceOperation()).toBeNull());
    expect(stubs.refresh).toHaveBeenCalledOnce();expect(hasPendingOperations()).toBe(false);
  },15000);
  it("cannot review own item and cannot create new writes after a lost reload marker",()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    const own=render(<EvaluationEvidenceControls snapshot={snapshot()} actorUserId={author}/>);
    expect(screen.queryByRole("button",{name:"確認證據並通過"})).toBeNull();own.unmount();
    sessionStorage.setItem("evaluation-evidence-unresolved-v1","1");
    render(<EvaluationEvidenceControls snapshot={snapshot()} actorUserId={actor}/>);
    expect(screen.getByRole("button",{name:"確認證據並通過"}).hasAttribute("disabled")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not settle a mismatched completion receipt",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({status:"ok",data:{organizationId:org,branchId:branch,actorUserId:author,
      idempotencyKey:crypto.randomUUID(),formalSubmissionEnabled:false,versionId:version,reviewId:branch,decision:"approved"}})));
    render(<EvaluationEvidenceControls snapshot={snapshot()} actorUserId={actor}/>);fireEvent.click(screen.getByRole("button",{name:"確認證據並通過"}));
    await waitFor(()=>expect(getHeldEvidenceOperation()?.phase).toBe("unknown"));
    expect(hasPendingOperations()).toBe(true);expect(stubs.refresh).not.toHaveBeenCalled();
  });
});
