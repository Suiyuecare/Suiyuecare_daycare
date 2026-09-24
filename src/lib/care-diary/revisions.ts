/** Count an observation event once regardless of draft/signature revisions. */
export function latestDiaryRevisions<T extends { id: string; record_key?: string; version?: number; occurred_at: string }>(rows: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = row.record_key ?? row.id;
    if (!latest.has(key) || (latest.get(key)!.version ?? 1) < (row.version ?? 1)) latest.set(key, row);
  }
  return [...latest.values()].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
}
