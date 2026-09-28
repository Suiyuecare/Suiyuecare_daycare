// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { filterTodayWorkRows, type TodayWorkRow } from "@/lib/core-care/today-work";
import { TodayWorkList } from "./today-work-list";

vi.mock("@/components/app/navigation-link", () => ({
  NavigationLink: ({ loadingLabel, ...props }: ComponentProps<"a"> & { loadingLabel: string }) => <a {...props} data-loading-label={loadingLabel} />,
}));
vi.mock("@/lib/core-care/today-work", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/core-care/today-work")>();
  return { ...original, filterTodayWorkRows: vi.fn(original.filterTodayWorkRows) };
});
afterEach(cleanup);

const date = "2026-09-10";
const access = buildDemoDailySnapshot(date).sourceAccess;
const seed: TodayWorkRow = {
  id: "a1111111-1111-4111-8111-111111111111", code: "SYN-000", name: "合成個案",
  attendance: "尚無出勤", measurements: "尚無量測", diary: "尚無日誌",
  tasks: ["attendance", "measurements"], nextPage: 46, nextLabel: "確認出勤",
};

describe("TodayWorkList local search scan", () => {
  it("searches the authorized 100-row scope once per search render while keeping all four counters and the page aligned", () => {
    const workRows = Array.from({ length: 100 }, (_, index): TodayWorkRow => ({
      ...seed, id: `a1111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      code: `SYN-${String(index).padStart(3, "0")}`,
      name: index < 12 ? `合成${index}` : `其他${index}`,
      tasks: index === 0 ? ["attendance", "attendance", "attention"]
        : index % 2 === 0 ? ["attendance", "diary"] : ["measurements"],
    }));
    render(<TodayWorkList rows={workRows} serviceDate={date} access={access} />);
    vi.mocked(filterTodayWorkRows).mockClear();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "合成" } });

    const searchCalls = vi.mocked(filterTodayWorkRows).mock.calls.filter((call) => call[2] === "合成");
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]?.[0]).toHaveLength(100);
    expect(screen.getByRole("status")).toHaveTextContent("待處理：12 位（搜尋結果）");
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(within(screen.getByRole("button", { name: /尚無出勤/ })).getByText("6")).toBeVisible();
    expect(within(screen.getByRole("button", { name: /尚無量測/ })).getByText("6")).toBeVisible();
    expect(within(screen.getByRole("button", { name: /日誌待完成/ })).getByText("5")).toBeVisible();
    expect(within(screen.getByRole("button", { name: /需留意/ })).getByText("1")).toBeVisible();
  });
});
