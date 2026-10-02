import type { ClientMasterItem } from "@/lib/clients/master-types";

import type { QuestionnaireFormKey, QuestionnaireSnapshot } from "./types";

export function buildDemoQuestionnaireSnapshot(
  formKey: QuestionnaireFormKey,
  sourceClients: readonly Pick<ClientMasterItem, "id" | "displayName" | "status">[],
  selectedClientId: string | null,
  generatedAt: string,
): QuestionnaireSnapshot {
  const clients = sourceClients
    .filter((client) => client.status === "active" || client.status === "suspended")
    .filter((client) => !selectedClientId || client.id === selectedClientId)
    .map((client) => ({
      clientId: client.id,
      displayName: client.displayName,
      serviceStatus: client.status as "active" | "suspended",
      latest: null,
    }));

  return { formKey, generatedAt, matchingTotal: clients.length, demo: true, clients };
}
