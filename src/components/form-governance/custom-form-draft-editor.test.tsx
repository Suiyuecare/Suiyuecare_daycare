// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CustomFormDraftEditor } from "./custom-form-draft-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{ configurable:true,value(){this.setAttribute("open","");} });
  Object.defineProperty(HTMLDialogElement.prototype,"close",{ configurable:true,value(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));} });
});
afterEach(() => { cleanup(); refresh.mockReset(); vi.unstubAllGlobals(); });
function fill() {
  fireEvent.change(screen.getByLabelText("表單名稱"),{target:{value:"合成自訂表單"}});
  fireEvent.change(screen.getByLabelText("表單代碼"),{target:{value:"tenant.custom.daily_check"}});
  fireEvent.change(screen.getByLabelText("題目"),{target:{value:"合成題目"}});
}
const requestId="aa100000-0000-4000-8000-000000000001";
const versionId="aa200000-0000-4000-8000-000000000001";
const definitionId="aa300000-0000-4000-8000-000000000001";
function receipt(replayed=false,revision=1) { return new Response(JSON.stringify({requestId,status:"ok",errors:[],data:{receipt:{formVersionId:versionId,definitionId,revision,status:"draft",replayed},persisted:true,demo:false}}),{status:replayed?200:201}); }
function rejected(code:string,status=409) { return new Response(JSON.stringify({requestId,status:"error",data:null,errors:[{code,message:"合成資料衝突，請核對"}]}),{status}); }
function draftRead(revision:number,label="伺服器原題") {
  const payload={formKey:"tenant.custom.daily_check",name:"既存合成表單",category:"行政表單",effectiveFrom:null,effectiveTo:null,
    schema:{builder:"tenant-custom.v1",fields:[{key:"note",label,required:true,type:"text",maxLength:500}]}};
  return new Response(JSON.stringify({requestId,status:"ok",errors:[],data:{draft:{formVersionId:versionId,definitionId,revision,version:1,status:"draft",payload},demo:false}}),{status:200});
}

describe("custom draft editor",()=>{
  it("allows synthetic preview but never saves or sends preview answers in demo",()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled canSave={false}/>);
    fireEvent.click(screen.getByRole("button",{name:"建立自訂表單"}));fill();
    fireEvent.click(screen.getByRole("button",{name:"檢查試填"}));
    expect(screen.getByText("合成題目：尚未填寫")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("合成題目（必填）"),{target:{value:"僅合成答案"}});
    fireEvent.click(screen.getByRole("button",{name:"檢查試填"}));
    expect(screen.getByText("已檢查 1 題，試填符合設定。")).toBeTruthy();
    expect((screen.getByRole("button",{name:"儲存草稿"}) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("persists a schema once and leaves publication to the separate review action",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(receipt());vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled/>);
    fireEvent.click(screen.getByRole("button",{name:"建立自訂表單"}));fill();
    fireEvent.change(screen.getByLabelText("合成題目（必填）"),{target:{value:"不能送到伺服器的試填"}});
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(screen.getByText(/草稿已儲存，尚未發布/u)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(refresh).toHaveBeenCalledTimes(1);
    const args=fetchMock.mock.calls[0]!;
    expect(args[0]).toBe("/api/forms/drafts");expect(args[1].body).not.toContain("不能送到伺服器的試填");
    expect(JSON.parse(args[1].body)).toMatchObject({formVersionId:null,baseRevision:null,payload:{schema:{builder:"tenant-custom.v1"}}});
  });
  it("freezes uncertain content and replays exactly the same UUID/body without duplication",async()=>{
    const fetchMock=vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(receipt(true));vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled/>);
    fireEvent.click(screen.getByRole("button",{name:"建立自訂表單"}));fill();
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"重試原儲存"})).toBeTruthy());
    expect((screen.getByLabelText("題目").closest("fieldset")?.parentElement as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"重試原儲存"}));
    await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
    expect(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1]![1].headers["Idempotency-Key"]);
  });
  it("loads an audited revision before edit and keeps definition identity immutable",async()=>{
    const payload={formKey:"tenant.custom.daily_check",name:"既存合成表單",category:"行政表單",effectiveFrom:null,effectiveTo:null,schema:{builder:"tenant-custom.v1",fields:[{key:"note",label:"合成題",required:true,type:"text",maxLength:500}]}};
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({requestId,status:"ok",errors:[],data:{draft:{formVersionId:versionId,definitionId,revision:4,version:1,status:"draft",payload},demo:false}}),{status:200}));vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled versionId={versionId}/>);
    fireEvent.click(screen.getByRole("button",{name:"編輯自訂草稿"}));
    await waitFor(()=>expect((screen.getByLabelText("表單名稱") as HTMLInputElement).value).toBe("既存合成表單"));
    expect((screen.getByLabelText("表單名稱") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("表單代碼") as HTMLInputElement).disabled).toBe(true);
    expect(within(screen.getByRole("dialog")).getByRole("button",{name:"儲存草稿"})).toBeTruthy();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/forms/drafts/${versionId}`);
  });
  it("unlocks a definite duplicate-code conflict, retains input across close, and saves a corrected code with a new key",async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(rejected("CUSTOM_FORM_CONFLICT")).mockResolvedValueOnce(receipt());vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled/>);
    fireEvent.click(screen.getByRole("button",{name:"建立自訂表單"}));fill();
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(screen.getByText(/請修改已被使用的表單代碼/u)).toBeTruthy());
    expect(screen.queryByRole("button",{name:"重試原儲存"})).toBeNull();
    fireEvent.click(screen.getAllByRole("button",{name:"關閉"})[0]!);
    fireEvent.click(screen.getByRole("button",{name:"建立自訂表單"}));
    expect((screen.getByLabelText("題目") as HTMLInputElement).value).toBe("合成題目");
    fireEvent.change(screen.getByLabelText("表單代碼"),{target:{value:"tenant.custom.corrected"}});
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).payload.formKey).toBe("tenant.custom.corrected");
    expect(fetchMock.mock.calls[1]![1].headers["Idempotency-Key"]).not.toBe(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]);
  });
  it("compares fresh revision without replacing input or baseline until explicit acknowledgement",async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(draftRead(4)).mockResolvedValueOnce(rejected("CUSTOM_FORM_CONFLICT"))
      .mockResolvedValueOnce(draftRead(5,"他人已修改的題目")).mockResolvedValueOnce(receipt(false,6));vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled versionId={versionId}/>);
    fireEvent.click(screen.getByRole("button",{name:"編輯自訂草稿"}));
    await waitFor(()=>expect((screen.getByLabelText("題目") as HTMLInputElement).value).toBe("伺服器原題"));
    fireEvent.change(screen.getByLabelText("題目"),{target:{value:"我的保留修改"}});
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"載入最新草稿並核對"})).toBeTruthy());
    expect((screen.getByRole("button",{name:"儲存草稿"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"載入最新草稿並核對"}));
    await waitFor(()=>expect(screen.getByText("伺服器最新草稿（修訂 5）")).toBeTruthy());
    expect(screen.getByText(/他人已修改的題目（note）/u)).toBeTruthy();
    expect((screen.getByLabelText("題目") as HTMLInputElement).value).toBe("我的保留修改");
    expect((screen.getByRole("button",{name:"儲存草稿"}) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button",{name:"已核對，保留我的內容並繼續編輯"}));
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).baseRevision).toBe(4);
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toMatchObject({baseRevision:5,payload:{schema:{fields:[{label:"我的保留修改"}]}}});
    expect(fetchMock.mock.calls[1]![1].headers["Idempotency-Key"]).not.toBe(fetchMock.mock.calls[3]![1].headers["Idempotency-Key"]);
  });
  it("treats a validated locked version as final, keeps input, and does not offer futile replay",async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(draftRead(4)).mockResolvedValueOnce(rejected("CUSTOM_FORM_LOCKED"));vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled versionId={versionId}/>);
    fireEvent.click(screen.getByRole("button",{name:"編輯自訂草稿"}));
    await waitFor(()=>expect((screen.getByLabelText("題目") as HTMLInputElement).value).toBe("伺服器原題"));
    fireEvent.change(screen.getByLabelText("題目"),{target:{value:"保留不可覆寫的修改"}});
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(screen.getByText("此版本已鎖定，不能再儲存")).toBeTruthy());
    expect(screen.queryByRole("button",{name:"重試原儲存"})).toBeNull();
    expect((screen.getByRole("button",{name:"儲存草稿"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button",{name:"關閉"})[0]!);
    fireEvent.click(screen.getByRole("button",{name:"編輯自訂草稿"}));
    expect((screen.getByLabelText("題目") as HTMLInputElement).value).toBe("保留不可覆寫的修改");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not trust an unvalidated 409 and preserves exact retry key and content",async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({errors:[{code:"CUSTOM_FORM_CONFLICT"}]}),{status:409})).mockResolvedValueOnce(receipt(true));vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled/>);
    fireEvent.click(screen.getByRole("button",{name:"建立自訂表單"}));fill();
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"重試原儲存"})).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"重試原儲存"}));
    await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
    expect(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1]![1].headers["Idempotency-Key"]);
  });
  it.each([["AUTH_REQUIRED",401],["CUSTOM_FORM_NOT_AUTHORIZED",403],["CUSTOM_FORM_LOCKED",409],["CUSTOM_FORM_CONFLICT",409]] as const)("does not forget an ambiguous earlier commit when a later retry returns %s",async(code,status)=>{
    const fetchMock=vi.fn().mockRejectedValueOnce(new Error("response lost after possible commit"))
      .mockResolvedValueOnce(rejected(code,status)).mockResolvedValueOnce(receipt(true));vi.stubGlobal("fetch",fetchMock);
    render(<CustomFormDraftEditor enabled/>);
    fireEvent.click(screen.getByRole("button",{name:"建立自訂表單"}));fill();
    fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"重試原儲存"})).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"重試原儲存"}));
    await waitFor(()=>expect(screen.getByText(/先前儲存結果仍未確認/u)).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"重試原儲存"}));
    await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
    const requests=fetchMock.mock.calls.map((call)=>call[1]);
    expect(new Set(requests.map((request)=>request.headers["Idempotency-Key"])).size).toBe(1);
    expect(new Set(requests.map((request)=>request.body)).size).toBe(1);
  });
});
