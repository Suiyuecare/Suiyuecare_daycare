"use client";

import { useSyncExternalStore } from "react";
import type { TenantContext } from "@/lib/domain/types";
import type { QuestionnaireFormKey } from "./types";

// Tab-local visibility watermarks only. Never retain answers, notes, operation
// bodies, credentials or reports here; this is not a write-recovery journal.
interface Watermark { admitted: number; floor: number }
interface ViewState { signature: string | null; epoch: number; exhausted: boolean }
const watermarks = new Map<string, Watermark>();
const empty: ViewState = { signature: null, epoch: 0, exhausted: false };
let state = empty;
let subject: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => { for (const listener of [...listeners]) listener(); };

export function questionnaireViewAuthority(context: TenantContext): string {
  return JSON.stringify([context.organizationId, context.branchId, context.userId,
    [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel,
    context.recentAal2At, context.demo]);
}

export function questionnaireReadPermission(form: QuestionnaireFormKey): string {
  const prefix = form === "spmsq" ? "questionnaire_cognition"
    : form === "barthel_adl" || form === "lawton_iadl" ? "questionnaire_adl"
      : form === "eat10_swallowing" ? "questionnaire_swallowing"
        : form === "bsrs5" || form === "gds_15" ? "questionnaire_emotion"
          : form === "fall_risk_taipei_115" ? "questionnaire_fall" : "questionnaire_nutrition";
  return `${prefix}.read`;
}

export function canReadQuestionnaireView(context: TenantContext, form: QuestionnaireFormKey): boolean {
  return !context.demo && context.scopes.includes("clients.read") && context.scopes.includes(questionnaireReadPermission(form));
}

function raiseFloor() {
  const watermark = subject ? watermarks.get(subject) : null;
  if (watermark) watermark.floor = Math.max(watermark.floor, watermark.admitted);
}

/** AppShell observes even outside this route; returning to A after A→B→A
 * requires a newer authorized SSR source, not A's retained props. */
export function observeQuestionnaireViewAuthority(signature: string) {
  if (state.signature === signature) return;
  raiseFloor();
  const tuple = JSON.parse(signature) as unknown[];
  subject = JSON.stringify(tuple.slice(0, 3));
  if (!watermarks.has(subject) && watermarks.size < 128) watermarks.set(subject, { admitted: -Infinity, floor: -Infinity });
  state = { signature, epoch: state.epoch + 1, exhausted: state.exhausted || !watermarks.has(subject) };
  notify();
}

export const getQuestionnaireViewState = () => state;
export function useQuestionnaireViewState() { return useSyncExternalStore(subscribe, getQuestionnaireViewState, () => empty); }

export function canAdmitQuestionnaireViewSource(signature: string, generatedAt: string, now = Date.now()): boolean {
  const at = Date.parse(generatedAt), watermark = subject ? watermarks.get(subject) : null;
  if (state.signature !== signature || state.exhausted || !watermark || !Number.isFinite(at) || !Number.isFinite(now) ||
      Math.abs(at - now) > 60_000 || at <= watermark.floor || at < watermark.admitted) return false;
  return true;
}

export function admitQuestionnaireViewSource(signature: string, generatedAt: string, now = Date.now()): boolean {
  if (!canAdmitQuestionnaireViewSource(signature, generatedAt, now)) return false;
  const watermark = watermarks.get(subject!)!;
  watermark.admitted = Math.max(watermark.admitted, Date.parse(generatedAt));
  return true;
}

/** Denial or untrusted evidence hides the entire clinical questionnaire view.
 * A readiness response is not enough to re-admit an authorization snapshot. */
export function quarantineQuestionnaireView(signature: string) {
  if (state.signature !== signature) return;
  raiseFloor();
  state = { ...state, epoch: state.epoch + 1 };
  notify();
}

export function clearQuestionnaireViewOnLogout() {
  raiseFloor();
  subject = null;
  state = { signature: null, epoch: state.epoch + 1, exhausted: state.exhausted };
  notify();
}
