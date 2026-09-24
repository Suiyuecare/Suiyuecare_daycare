/** A response may be lost AFTER commit. Such an operation must never be edited
 * or assigned a fresh key; only the exact serialized attempt may be retried. */
export class CareWriteAttempt<T extends Record<string, unknown>> {
  private pending: { serialized: string; key: string; uncertain: boolean } | null = null;
  current() {
    return this.pending ? { body: JSON.parse(this.pending.serialized) as T, serialized: this.pending.serialized, key: this.pending.key } : null;
  }
  prepare(body: T, key: string) {
    if (!this.pending) this.pending = { serialized: JSON.stringify(body), key, uncertain: false };
    return this.current()!;
  }
  failed(status?: number) {
    if (!this.pending) return null;
    if ((status === 400 || status === 422) && !this.pending.uncertain) { this.pending = null; return null; }
    this.pending.uncertain = true;
    return this.current();
  }
  confirmed() { this.pending = null; }
}

/** An intermediary's bare 400 is not proof that our transaction was rejected. */
export async function isDefiniteCareRejection(response: Response) {
  if (response.status !== 400 && response.status !== 422) return false;
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== "object") return false;
    const value = body as Record<string, unknown>;
    return value.status === "error" && value.data === null && typeof value.requestId === "string" && value.requestId.length > 0 &&
      Array.isArray(value.errors) && value.errors.length > 0 && value.errors.every((error) => error && typeof error === "object" && typeof error.code === "string" && error.code.length > 0);
  } catch { return false; }
}
