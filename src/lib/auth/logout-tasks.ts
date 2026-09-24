export type LogoutResult = { cacheCleared: boolean; branchCleared: boolean; signedOut: boolean };
type LogoutTasks = { clearCache: () => Promise<boolean>; clearBranch: () => Promise<boolean>; signOut: () => Promise<boolean> };

function confirmedWithin(task: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Promise.resolve().then(task).then((result) => resolve(result === true), () => resolve(false))
      .finally(() => clearTimeout(timer));
  });
}

/** Cache trouble must never delay the independent session-revocation attempt. */
export async function runLogoutTasks(tasks: LogoutTasks, timeoutMs = 10_000): Promise<LogoutResult> {
  const [cacheCleared, branchCleared, signedOut] = await Promise.all([
    confirmedWithin(tasks.clearCache, timeoutMs),
    confirmedWithin(tasks.clearBranch, timeoutMs),
    confirmedWithin(tasks.signOut, timeoutMs),
  ]);
  return { cacheCleared, branchCleared, signedOut };
}
