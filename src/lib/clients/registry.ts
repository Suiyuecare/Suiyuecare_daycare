import "server-only";

import type { TenantContext } from "@/lib/domain/types";

import { buildDemoClientRegistry } from "./demo";
import { loadClientMasterSnapshot } from "./master-snapshot";
import type {
  ClientRegistryItem,
  ClientRegistrySnapshot,
} from "./types";

export class ClientRegistryError extends Error {
  constructor() {
    super("CLIENT_REGISTRY_UNAVAILABLE");
    this.name = "ClientRegistryError";
  }
}

function projectClient(row: Awaited<ReturnType<typeof loadClientMasterSnapshot>>["clients"][number]): ClientRegistryItem {
  return {
    id: row.id,
    clientCode: row.clientCode,
    displayName: row.displayName,
    dateOfBirth: row.dateOfBirth,
    status: row.status,
    serviceState: row.serviceState,
    admittedOn: row.admittedOn,
    endedOn: row.endedOn,
    sourceSystem: row.sourceSystem,
    sourceUpdatedAt: row.sourceUpdatedAt,
    rowVersion: row.rowVersion,
    updatedAt: row.updatedAt,
  };
}

export async function loadClientRegistry(
  context: TenantContext,
): Promise<ClientRegistrySnapshot> {
  if (context.demo) return buildDemoClientRegistry();
  if (!context.scopes.includes("clients.read")) throw new ClientRegistryError();

  const snapshot = await loadClientMasterSnapshot(context).catch(() => {
    throw new ClientRegistryError();
  });
  return {
    generatedAt: snapshot.generatedAt,
    clients: snapshot.clients.map(projectClient),
    demo: false,
  };
}
