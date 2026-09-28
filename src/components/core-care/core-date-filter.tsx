"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CalendarDays } from "lucide-react";

import { parseServiceDate } from "@/lib/core-care/date";
import type { DailyWorkflowShift } from "@/lib/core-care/workflow-links";

/** Keep the existing GET navigation, but reject a missing or malformed day in place. */
export function CoreDateFilter({
  serviceDate,
  selectedClientId,
  selectedShift,
}: {
  serviceDate: string;
  selectedClientId?: string;
  selectedShift?: DailyWorkflowShift;
}) {
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [error, setError] = useState("");

  function validDate() {
    const value = inputRef.current?.value ?? "";
    if (value && parseServiceDate(value, new Date("2000-01-01T00:00:00Z")) === value) return true;
    setError(value ? "請選擇有效的服務日期。" : "請選擇服務日期。");
    inputRef.current?.focus();
    return false;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (!validDate()) event.preventDefault();
  }

  function guardComposition(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
      event.preventDefault();
    } else if (event.key === "Enter" && !validDate()) {
      // The shared unsaved-work guard observes submit in document capture.
      // Stop an invalid keyboard submit before that navigation check runs.
      event.preventDefault();
    }
  }

  return (
    <form className="core-date-filter" method="get" noValidate onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }} onKeyDown={guardComposition} onSubmit={submit}>
      {selectedClientId ? <input name="client" type="hidden" value={selectedClientId} /> : null}
      {selectedShift ? <input name="shift" type="hidden" value={selectedShift} /> : null}
      <label className="field"><span>服務日期</span><input aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined} defaultValue={serviceDate} name="date" onChange={() => setError("")}
        ref={inputRef} required type="date" />
        {error ? <small className="form-error" id={errorId}>{error}</small> : null}
      </label>
      <button className="button button--secondary" onClick={(event) => { if (!validDate()) event.preventDefault(); }}
        type="submit"><CalendarDays aria-hidden="true" />套用日期</button>
    </form>
  );
}
