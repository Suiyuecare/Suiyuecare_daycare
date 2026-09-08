import { isDemoMode } from "@/lib/env";

import { ImportError } from "./errors";
import { DemoMemoryImportRepository } from "./memory-repository";
import type {
  ImportBatchRepository,
  ProductionImportStorage,
} from "./types";

let productionStorage: ProductionImportStorage | null = null;

export function registerProductionImportStorage(
  storage: ProductionImportStorage,
) {
  productionStorage = storage;
}

const globalForImports = globalThis as typeof globalThis & {
  __daycareDemoImportRepository?: DemoMemoryImportRepository;
};

export function getImportRepository(): ImportBatchRepository {
  if (isDemoMode()) {
    globalForImports.__daycareDemoImportRepository ??=
      new DemoMemoryImportRepository();
    return globalForImports.__daycareDemoImportRepository;
  }

  if (productionStorage) return productionStorage;
  throw new ImportError(
    "IMPORT_STORAGE_NOT_CONFIGURED",
    "正式匯入儲存尚未設定，系統已停止操作以避免資料遺失。",
    503,
  );
}
