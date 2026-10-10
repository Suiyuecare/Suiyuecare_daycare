// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiaryObservationsFields } from "./diary-observations";
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
  it("puts water, toileting and activity first only for a pure caregiver without changing unknown states", () => {
    render(<DiaryObservationsFields caregiverMode />);
    expect(screen.getByRole("group", { name: "本次觀察（選填）" })).toHaveTextContent("未觀察不算正常，也不沿用上次。");
    expect(screen.getAllByRole("combobox").map((control) => control.getAttribute("name"))).toEqual([
      "water_state", "toileting_state", "activity_state", "meal_state",
    ]);
    for (const control of screen.getAllByRole("combobox")) expect(control).toHaveValue("unknown");
  });
  it("keeps the existing field order and guidance for other roles", () => {
    render(<DiaryObservationsFields />);
    expect(screen.getAllByRole("combobox").map((control) => control.getAttribute("name"))).toEqual([
      "meal_state", "water_state", "toileting_state", "activity_state",
    ]);
    expect(screen.getByText(/尚未觀察不等於正常，也不會自動沿用上次數值/u)).toBeVisible();
  });
});
