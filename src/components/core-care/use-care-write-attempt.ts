"use client";
import { useRef, useState } from "react";
import { CareWriteAttempt } from "@/lib/core-care/write-attempt";

export function useCareWriteAttempt<T extends Record<string, unknown>>() {
  const attempt = useRef(new CareWriteAttempt<T>());
  const [locked, setLocked] = useState(false);
  return {
    locked,
    current: () => attempt.current.current(),
    prepare(body: T, key: string) { const value = attempt.current.prepare(body, key); setLocked(true); return value; },
    failed(status?: number) { const value = attempt.current.failed(status); setLocked(value !== null); return value; },
    confirmed() { attempt.current.confirmed(); setLocked(false); },
  };
}
