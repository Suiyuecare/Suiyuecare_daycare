import { isDemoMode } from "@/lib/env";

import { ImportError } from "./errors";
import { DemoMemoryImportRepository } from "./memory-repository";
import type {
  ImportActor,
  ImportBatchRepository,
  ProductionImportStorage,
} from "./types";
import type { ImportPermission } from "./http";
import { createProductionImportRepository } from "./production-repository";

let productionStorage: ProductionImportStorage | null = null;

export function registerProductionImportStorage(
  storage: ProductionImportStorage,
) {
  productionStorage = storage;
}

const globalForImports = globalThis as typeof globalThis & {
  __daycareDemoImportRepository?: DemoMemoryImportRepository;
};

export async function getImportRepository(actor?: ImportActor, permission: ImportPermission = "preview"): Promise<ImportBatchRepository> {
  if (isDemoMode()) {
    globalForImports.__daycareDemoImportRepository ??=
      new DemoMemoryImportRepository();
    return globalForImports.__daycareDemoImportRepository;
  }

  if (productionStorage) return productionStorage;
  if (actor) return createProductionImportRepository(actor, permission);
  throw new ImportError(
    "IMPORT_STORAGE_NOT_CONFIGURED",
    "正式匯入儲存尚未設定，系統已停止操作以避免資料遺失。",
    503,
  );
}
