// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CareReminderPanel } from "./care-reminder-panel";
import type { ReminderSnapshot } from "@/lib/care-reminders/contracts";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
const id="fa000000-0000-4000-8000-000000000001";
const initial:ReminderSnapshot={client_id:id,client_version:1,reviewer:true,generated_at:"2026-09-12T00:00:00Z",formally_imported:false,sources:[],reminders:[{
  id,batch_id:id,client_id:id,rule_id:"cms.explicit_transfer_assistance",rule_version:"cms-explicit-attention@1",title:"移位協助需確認",text:"請依現行照顧計畫確認協助方式。",
  status:"pending_review",source_changed:false,source_kind:"trusted_staging",imported_at:"2026-09-12T00:00:00Z",reviewed_at:null,reviewed_by:null,
  source:{fieldId:"field_synthetic",sectionCode:"ASSESSMENT_E",label:"移位",parentPath:"ASSESSMENT_E/table",targetPath:"central.assessment_e.synthetic",mappingKey:"synthetic",sourceValue:"需要協助"},
}]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("care reminder review interface",()=>{
  it("clearly distinguishes unreviewed source and blocks review without reason",()=>{
    render(<CareReminderPanel initial={initial}/>);
    expect(screen.getByText("待人工核對，尚非照顧指示")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"核對並發布這筆提醒"})).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/核對理由/u),{target:{value:"已核對原始來源與照顧計畫"}});
    expect(screen.getByRole("button",{name:"核對並發布這筆提醒"})).toBeEnabled();
  });
  it("does not replace pending status on malformed success, retries exact original operation",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:"ok",data:{}}),{status:201}));
    vi.stubGlobal("fetch",fetchMock);render(<CareReminderPanel initial={initial}/>);
    fireEvent.change(screen.getByLabelText(/核對理由/u),{target:{value:"已核對原始來源與照顧計畫"}});
    fireEvent.click(screen.getByRole("button",{name:"核對並發布這筆提醒"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("儲存回執無法確認");
    expect(screen.getByText("待人工核對，尚非照顧指示")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"以相同操作重試"}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
  });
  it("does not offer worker source linkage or approval actions",()=>{
    render(<CareReminderPanel initial={{...initial,reviewer:false,reminders:[{...initial.reminders[0]!,status:"confirmed",reviewed_by:id,reviewed_at:"2026-09-12T01:00:00Z"}]}}/>);
    expect(screen.getByText("已人工核對")).toBeInTheDocument();
    expect(screen.queryByLabelText(/核對理由/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"核對並發布這筆提醒"})).not.toBeInTheDocument();
    expect(screen.queryByText("來源與版本核對")).not.toBeInTheDocument();
  });
});
