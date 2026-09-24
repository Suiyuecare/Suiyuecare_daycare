// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CHECK_KEYS, type IntakeCompletenessSnapshot } from "@/lib/intake-completeness/model";
import { IntakeCompletenessWorkspace } from "./intake-completeness-workspace";
const scope = { organizationId: "a1000000-0000-4000-8000-000000000001", branchId: "b1000000-0000-4000-8000-000000000001" };
const snapshot: IntakeCompletenessSnapshot = { ...scope, asOf: "2026-09-14", generatedAt: new Date().toISOString(), rows: [1, 2].map((index) => ({ clientId: `c1000000-0000-4000-8000-00000000000${index}`, clientCode: `SYN-${index}`, displayName: `合成個案${index}`, clientStatus: "active", profileVersion: 1, checks: CHECK_KEYS.map((key) => ({ key, state: index === 1 ? key === "health_exam" ? "denied" : key === "contact" ? "missing" : "complete" : key === "consent" ? "pending" : "complete" })) })) };
const props = { initialSnapshot: snapshot, scope, branchName: "合成分支", demo: false };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows actionable case links without guessing denied medical document status", () => {
  render(<IntakeCompletenessWorkspace {...props} />);
  expect(screen.getByRole("heading", { name: "收案與補件表" })).toBeVisible();
  const card = screen.getByRole("heading", { name: "合成個案1" }).closest("article")!;
  expect(within(card).getByRole("link", { name: "處理合成個案1的可聯繫的關係人" })).toHaveAttribute("href", `/app/client-intake?client=${snapshot.rows[0].clientId}&step=profile`);
  expect(within(card).queryByRole("link", { name: /體檢/ })).not.toBeInTheDocument();
  expect(within(card).getAllByText("此帳號無查閱權限").length).toBeGreaterThan(0);
});
it("filters genuine missing items and keeps card/list count and query consistent", () => {
  render(<IntakeCompletenessWorkspace {...props} />);
  fireEvent.change(screen.getByLabelText("尚待處理的項目"), { target: { value: "contact" } });
  expect(screen.getByRole("heading", { name: "合成個案1" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "合成個案2" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜尋姓名或案號"), { target: { value: "no-match" } });
  expect(screen.getByRole("heading", { name: "目前篩選沒有符合個案" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /全部授權個案\s*0/ }));
  expect(screen.getByLabelText("搜尋姓名或案號")).toHaveValue("no-match");
  expect(screen.getByLabelText("尚待處理的項目")).toHaveValue("contact");
  fireEvent.click(screen.getByRole("button", { name: "查看全部授權個案" }));
  expect(screen.getByLabelText("搜尋姓名或案號")).toHaveValue("");
  expect(screen.getByLabelText("尚待處理的項目")).toHaveValue("all");
  expect(screen.getByRole("heading", { name: "合成個案2" })).toBeVisible();
});
it("discards the old report on failed or newly forbidden refresh", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "error", data: null }, { status: 403 })));
  render(<IntakeCompletenessWorkspace {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "重新核對" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("無法核對資料或查閱權限");
  expect(screen.queryByRole("heading", { name: "合成個案1" })).not.toBeInTheDocument();
});
it("rejects a different branch response even when the initial load had failed", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "ok", data: { ...snapshot, branchId: "b1000000-0000-4000-8000-000000000002" } })));
  render(<IntakeCompletenessWorkspace {...props} initialSnapshot={null} initialError="暫時無法核對" />);
  fireEvent.click(screen.getByRole("button", { name: "重新核對" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("無法核對資料或查閱權限"));
  expect(screen.queryByRole("heading", { name: "合成個案1" })).not.toBeInTheDocument();
});
it("refreshes current scope with no-store, never localStorage or exported attachments", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: snapshot })); vi.stubGlobal("fetch", fetcher);
  render(<IntakeCompletenessWorkspace {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "重新核對" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "重新核對" })).toBeEnabled());
  expect(fetcher).toHaveBeenCalledWith("/api/intake-completeness", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  expect(screen.queryByRole("button", { name: /匯出/ })).not.toBeInTheDocument();
});
it("labels empty authorized scope without claiming institution has no clients", () => {
  render(<IntakeCompletenessWorkspace {...props} initialSnapshot={{ ...snapshot, rows: [] }} />);
  expect(screen.getByRole("heading", { name: "目前沒有可查閱個案" })).toBeVisible();
  expect(screen.getByText(/不代表全機構沒有個案/)).toBeVisible();
});
