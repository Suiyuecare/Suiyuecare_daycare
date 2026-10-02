// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModuleLoading } from "./module-loading";

afterEach(cleanup);

describe("ModuleLoading accessible indeterminate state", () => {
  it("announces loading politely without adding a nested main landmark", () => {
    const { container } = render(<ModuleLoading />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("正在載入日照管理");
    expect(status.textContent).toMatch(/正在讀取.*系統功能/u);
    expect(container.querySelector("main")).toBeNull();
  });

  it("uses a named indeterminate progressbar without invented completion numbers", () => {
    render(<ModuleLoading />);
    const progress = screen.getByRole("progressbar", { name: "系統功能載入中" });
    for (const attribute of ["aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-valuetext"]) {
      expect(progress.hasAttribute(attribute)).toBe(false);
    }
    expect(screen.getByRole("status").textContent).not.toMatch(/\d+(?:\.\d+)?\s*[%％]|百分之/u);
  });

  it("renders the caller title as text, not executable markup", () => {
    const title = '正在載入<script data-test="inert">not executable</script>';
    const { container } = render(<ModuleLoading title={title} />);
    expect(screen.getByText(title).tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
  });

  it("applies transition positioning only when explicitly requested", () => {
    const { rerender } = render(<ModuleLoading />);
    expect(screen.getByRole("status").classList.contains("module-loading--transition")).toBe(false);
    rerender(<ModuleLoading transition />);
    expect(screen.getByRole("status").classList.contains("module-loading--transition")).toBe(true);
    rerender(<ModuleLoading transition={false} />);
    expect(screen.getByRole("status").classList.contains("module-loading--transition")).toBe(false);
  });

  it("keeps route-change feedback compact without changing the initial loader", () => {
    const { container, rerender } = render(<ModuleLoading title="正在載入個案中心" transition />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("正在載入個案中心");
    expect(container.querySelector(".module-loading__logo, .module-loading__card > span")).toBeNull();
    const progress = screen.getByRole("progressbar", { name: "頁面載入中" });
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress.hasAttribute("aria-valuetext")).toBe(false);

    rerender(<ModuleLoading />);
    expect(container.querySelector(".module-loading__logo")).not.toBeNull();
    expect(container.querySelector(".module-loading__card > span")).not.toBeNull();
    expect(screen.getByRole("progressbar", { name: "系統功能載入中" })).toBeTruthy();
  });

  it("uses a decorative local logo rather than remote or identity-bearing content", () => {
    const { container } = render(<ModuleLoading />);
    const logo = container.querySelector("img");
    expect(logo?.getAttribute("src")).toBe("/suiyue-logo-transparent.png");
    expect(logo?.getAttribute("alt")).toBe("");
    expect(logo?.getAttribute("width")).toBe("54");
    expect(logo?.getAttribute("height")).toBe("54");
    expect(container.querySelectorAll("button, a, input, select, textarea, iframe")).toHaveLength(0);
  });
});
