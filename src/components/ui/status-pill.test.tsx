// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusPill } from "./status-pill";

afterEach(cleanup);

describe("StatusPill tone", () => {
  it("keeps unfinished work out of the success tone", () => {
    render(<><StatusPill status="1 筆待完成" /><StatusPill status="未完成" /></>);
    expect(screen.getByText("1 筆待完成")).toHaveClass("status-pill--warning");
    expect(screen.getByText("未完成")).toHaveClass("status-pill--warning");
  });

  it("preserves success for completed work and accepts an explicit domain tone", () => {
    render(<><StatusPill status="已完成" /><StatusPill status="已完成待覆核" tone="warning" /></>);
    expect(screen.getByText("已完成")).toHaveClass("status-pill--success");
    expect(screen.getByText("已完成待覆核")).toHaveClass("status-pill--warning");
  });
});
