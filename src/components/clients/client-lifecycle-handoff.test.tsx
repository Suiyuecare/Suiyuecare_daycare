// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageCatalogEntry } from "@/lib/catalog";
import { buildDemoClientLifecycle } from "@/lib/clients/demo";
import { ClientLifecycleWorkspace } from "./client-lifecycle-workspace";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
const props = { page: { title: "收案／異動／結案", number: 61 } as PageCatalogEntry, query: "", status: "all" as const, eventKind: "all" as const, effectiveOn: null, canManage: true, hasRecentAal2: true };
const id = "a1111111-1111-4111-8111-111111111111";
describe("lifecycle handoff page boundaries", () => {
  it("retains the exact client when retrying a failed snapshot", () => {
    render(<ClientLifecycleWorkspace {...props} snapshot={null} loadError selectedClientId={id} />);
    expect(screen.getByRole("link", { name: "重新載入" }).getAttribute("href")).toBe(`?client=${id}`);
  });
  it("does not offer a different case when the selected case is unavailable", () => {
    render(<ClientLifecycleWorkspace {...props} snapshot={{ ...buildDemoClientLifecycle(), demo: false }} selectedClientId="invalid" />);
    expect(screen.getByRole("alert").textContent).toContain("不會改選其他個案");
    expect(screen.getByRole("button", { name: "建立個案異動" })).toHaveProperty("disabled", true);
  });
  it("keeps the selected ID in filter forms, clearing and continuation", () => {
    const { container } = render(<ClientLifecycleWorkspace {...props} snapshot={buildDemoClientLifecycle()} selectedClientId={id} canOpenIntake />);
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="client"]')?.value).toBe(id);
    expect(screen.getAllByRole("link", { name: "清除篩選" }).every((link) => link.getAttribute("href") === `?client=${id}`)).toBe(true);
    expect(screen.getByRole("link", { name: "回此個案的每週安排與文件" }).getAttribute("href")).toBe(`/app/client-intake?client=${id}&step=weekly`);
  });
});
