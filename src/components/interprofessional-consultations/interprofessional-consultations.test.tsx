// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoInterprofessionalConsultationSnapshot } from "@/lib/interprofessional-consultations/demo";
import type { InterprofessionalConsultationFilters } from "@/lib/interprofessional-consultations/types";

import {
  ConsultationCorrectionForm,
  ConsultationCreateForm,
  ConsultationResponseForm,
} from "./interprofessional-consultation-actions";
import { InterprofessionalConsultationsWorkspace } from "./interprofessional-consultations-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const organizationId = "37000000-0000-4000-8000-000000000040";
const branchId = "37000000-0000-4000-8000-000000000041";
const filters: InterprofessionalConsultationFilters = {
  clientId: null, requesterUserId: null, assigneeMode: "all", assigneeUserId: null,
  disciplineCode: null, urgency: "all", status: "all", deadlineFilter: "all",
  dueFrom: null, dueTo: null, query: "",
};
const snapshot = buildDemoInterprofessionalConsultationSnapshot({ organizationId, branchId, filters });
const page = staffPages.find((entry) => entry.number === 37)!;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Page 37 consultation workspace and actions", () => {
  it("renders the same consultation identities in desktop rows and mobile cards", () => {
    const { container } = render(<InterprofessionalConsultationsWorkspace
      filters={filters} loadError={false} page={page} snapshot={snapshot} />);
    const rows = new Set([...container.querySelectorAll("[data-consultation-row]")]
      .map((node) => node.getAttribute("data-consultation-row")));
    const cards = new Set([...container.querySelectorAll("[data-consultation-card]")]
      .map((node) => node.getAttribute("data-consultation-card")));
    expect(rows).toEqual(cards);
    expect(rows.size).toBe(snapshot.items.length);
    expect(screen.getByText(/全部為合成資料/u)).toBeInTheDocument();
    expect(screen.getByText(/manual_unstandardized/u)).toBeInTheDocument();
    expect(screen.getAllByText(/not_configured/u).length).toBeGreaterThan(0);
  });

  it("fails closed without a complete server snapshot", () => {
    render(<InterprofessionalConsultationsWorkspace filters={filters}
      loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得跨專業照會快照" }))
      .toBeInTheDocument();
  });

  it("keeps every synthetic demo create disabled", () => {
    const { container } = render(<ConsultationCreateForm branchId={branchId}
      canCreate={false} clients={snapshot.clientOptions} organizationId={organizationId}
      referenceTime={snapshot.generatedAt} staff={snapshot.assigneeOptions} />);
    expect(container.querySelector("form > fieldset")).toHaveProperty("disabled", true);
    expect(screen.getByText(/最近 15 分鐘 AAL2/u)).toBeInTheDocument();
  });

  it("keeps correction disabled without fresh correction authority", () => {
    render(<ConsultationCorrectionForm branchId={branchId} canRespond={false}
      item={snapshot.items[1]!} organizationId={organizationId} />);
    expect(screen.getByRole("button", { name: "建立更正事件" }).closest("fieldset"))
      .toHaveProperty("disabled", true);
    expect(screen.getByText(/原事件與已完成內容不會被修改/u)).toBeInTheDocument();
  });

  it("reuses the actor operation key after an unknown reply result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ConsultationResponseForm branchId={branchId} canRespond
      item={snapshot.items[1]!} organizationId={organizationId} />);
    fireEvent.change(screen.getByRole("textbox", { name: "內容" }), {
      target: { value: "合成專業回覆內容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增不可變事件" }));
    await screen.findByText(/完成狀態未知/u);
    fireEvent.click(screen.getByRole("button", { name: "新增不可變事件" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(first["x-interprofessional-consultation-action"]).toBe("reply");
    expect(second["idempotency-key"]).toBe(first["idempotency-key"]);
  });
});
