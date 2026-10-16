// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiaryObservationsFields } from "./diary-observations";
import { observationsFromForm } from "@/lib/care-diary/schema";
afterEach(cleanup);
describe("quick observation controls", () => {
  it("starts with no claimed observations and no default quantities", () => {
    render(<DiaryObservationsFields />);
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    for (const control of screen.getAllByRole("combobox")) expect(control).toHaveValue("unknown");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
  it("shows quantity only after explicit observed choice and discards it on unknown", () => {
    render(<DiaryObservationsFields />);
    const state = screen.getByLabelText("本次飲水量（毫升）");
    fireEvent.change(state, { target: { value: "observed" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "100" } });
    fireEvent.change(state, { target: { value: "unknown" } });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.change(state, { target: { value: "observed" } });
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
  });
  it("restores unfinished local fields without inventing a completed observation", () => {
    render(<DiaryObservationsFields restored={{ water_state: "observed", water: "", meal_state: "not_applicable" }} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    expect(screen.getByLabelText("本次進食量")).toHaveValue("not_applicable");
  });
  it("shows direct caregiver choices, starts unknown, and keeps meal secondary", () => {
    const { container } = render(<form><DiaryObservationsFields caregiverMode /></form>);
    expect(screen.getByRole("group", { name: "本次觀察（選填）" })).toHaveTextContent("只記錄實際觀察；空白不代表 0。");
    const form = container.querySelector("form")!;
    expect(observationsFromForm(new FormData(form))).toEqual({
      water: { state: "unknown" }, toileting: { state: "unknown" }, activity: { state: "unknown" }, meal: { state: "unknown" },
    });
    expect(screen.getByRole("spinbutton", { name: "本次飲水量（毫升）" })).toHaveValue(null);
    expect(screen.getByRole("group", { name: "本次如廁" }).querySelectorAll("button")).toHaveLength(6);
    expect(screen.getByRole("group", { name: "本次活動參與" }).querySelectorAll("button")).toHaveLength(6);
    expect(screen.getByText("其他觀察：進食量").closest("details")).not.toHaveAttribute("open");
  });
  it("stores observed water 0 separately from blank, unknown and not applicable", () => {
    let currentForm: HTMLFormElement | null = null;
    const snapshots: unknown[] = [];
    const onUserChange = vi.fn(() => snapshots.push(observationsFromForm(new FormData(currentForm!)).water));
    const { container } = render(<form><DiaryObservationsFields caregiverMode onUserChange={onUserChange} /></form>);
    const form = container.querySelector("form")!;
    currentForm = form;
    const water = screen.getByRole("spinbutton", { name: "本次飲水量（毫升）" });
    fireEvent.change(water, { target: { value: "0" } });
    expect(observationsFromForm(new FormData(form)).water).toEqual({ state: "observed", value: 0 });
    expect(onUserChange).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("group", { name: "飲水量狀態" }).getElementsByTagName("button")[0]!);
    expect(observationsFromForm(new FormData(form)).water).toEqual({ state: "unknown" });
    expect(water).toHaveValue(null);
    fireEvent.click(screen.getByRole("group", { name: "飲水量狀態" }).getElementsByTagName("button")[1]!);
    expect(observationsFromForm(new FormData(form)).water).toEqual({ state: "not_applicable" });
    expect(water).toBeDisabled();
    expect(onUserChange).toHaveBeenCalledTimes(3);
    expect(snapshots).toEqual([{ state: "observed", value: 0 }, { state: "unknown" }, { state: "not_applicable" }]);
  });
  it("one-tap toileting and activity choices keep exact form values and native button semantics", () => {
    const { container } = render(<form><DiaryObservationsFields caregiverMode /></form>);
    const form = container.querySelector("form")!;
    const toilet = screen.getByRole("group", { name: "本次如廁" });
    const assisted = toilet.querySelector('button[aria-pressed="false"]') as HTMLButtonElement;
    expect(assisted).toHaveAttribute("type", "button");
    expect(assisted.tabIndex).toBe(0);
    assisted.focus(); expect(assisted).toHaveFocus();
    fireEvent.click(toilet.querySelectorAll("button")[1]!);
    fireEvent.click(screen.getByRole("group", { name: "本次活動參與" }).querySelectorAll("button")[2]!);
    expect(observationsFromForm(new FormData(form))).toMatchObject({ toileting: { state: "observed", value: "assisted" }, activity: { state: "observed", value: "declined" } });
    fireEvent.click(toilet.querySelectorAll("button")[5]!);
    expect(observationsFromForm(new FormData(form)).toileting).toEqual({ state: "not_applicable" });
    expect(toilet.querySelectorAll("button")[5]).toHaveAttribute("aria-pressed", "true");
  });
  it("restores caregiver choice state without treating blank observed water as zero", () => {
    const { container } = render(<form><DiaryObservationsFields caregiverMode restored={{ water_state: "observed", water: "", toileting_state: "observed", toileting: "assisted", activity_state: "not_applicable" }} /></form>);
    expect(screen.getByRole("spinbutton", { name: "本次飲水量（毫升）" })).toHaveValue(null);
    expect(() => observationsFromForm(new FormData(container.querySelector("form")!))).toThrow();
    expect(screen.getByRole("group", { name: "本次如廁" }).querySelectorAll("button")[1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("spinbutton", { name: "本次飲水量（毫升）" }), { target: { value: "120" } });
    expect(observationsFromForm(new FormData(container.querySelector("form")!))).toMatchObject({ water: { state: "observed", value: 120 }, toileting: { state: "observed", value: "assisted" }, activity: { state: "not_applicable" } });
  });
  it("keeps the existing field order and guidance for other roles", () => {
    render(<DiaryObservationsFields />);
    expect(screen.getAllByRole("combobox").map((control) => control.getAttribute("name"))).toEqual([
      "meal_state", "water_state", "toileting_state", "activity_state",
    ]);
    expect(screen.getByText(/尚未觀察不等於正常，也不會自動沿用上次數值/u)).toBeVisible();
  });
});
