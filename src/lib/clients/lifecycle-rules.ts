import type {
  ClientLifecycleClient,
  ClientLifecycleStatus,
  ClientServiceState,
  ClientTransitionKind,
} from "./types";

export const TERMINAL_CLIENT_TRANSITION_KINDS = Object.freeze([
  "transfer",
  "close",
  "death",
] as const satisfies readonly ClientTransitionKind[]);

const terminalKinds = new Set<ClientTransitionKind>(
  TERMINAL_CLIENT_TRANSITION_KINDS,
);

export function isTerminalClientTransition(
  eventKind: ClientTransitionKind,
) {
  return terminalKinds.has(eventKind);
}

export function taipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function clientServiceState(client: {
  status: ClientLifecycleStatus;
  admittedOn: string | null;
}): ClientServiceState {
  return client.status === "active" && client.admittedOn === null
    ? "pending_admission"
    : client.status;
}

/**
 * This is a usability projection only. The database trigger is authoritative
 * and repeats every state, date, permission, version, and AAL2 check.
 */
export function allowedClientTransitionKinds(
  client: Pick<
    ClientLifecycleClient,
    "status" | "admittedOn" | "endedOn"
  >,
): readonly ClientTransitionKind[] {
  if (client.endedOn || ["transferred", "closed", "deceased"].includes(client.status)) {
    return [];
  }
  if (client.status === "active" && !client.admittedOn) return ["admit"];
  if (client.status === "active") {
    return ["suspend", "transfer", "close", "death"];
  }
  if (client.status === "suspended" && client.admittedOn) {
    return ["resume", "transfer", "close", "death"];
  }
  return [];
}
