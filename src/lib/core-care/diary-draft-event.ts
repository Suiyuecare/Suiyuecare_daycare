const CONFIRMED_DRAFT_EVENT = "suiyue:care-diary-draft-confirmed";

/** In-page notification only. The lifecycle must still read the saved row back from the server. */
export type ConfirmedDiaryDraft = { clientId: string; recordId: string; version: number };

export function notifyConfirmedDiaryDraft(draft: ConfirmedDiaryDraft) {
  window.dispatchEvent(new CustomEvent(CONFIRMED_DRAFT_EVENT, { detail: draft }));
}

export function onConfirmedDiaryDraft(listener: (draft: ConfirmedDiaryDraft) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<ConfirmedDiaryDraft>).detail);
  window.addEventListener(CONFIRMED_DRAFT_EVENT, handle);
  return () => window.removeEventListener(CONFIRMED_DRAFT_EVENT, handle);
}
