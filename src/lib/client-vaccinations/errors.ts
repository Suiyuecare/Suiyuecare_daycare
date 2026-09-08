import { databaseFailure } from "@/lib/integrations/http";

export function clientVaccinationSaveFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "CLIENT_VACCINATION_NOT_AUTHORIZED",
    "目前角色、分支、個案指派或登入保證等級不允許保存疫苗資料。", 403,
  );
  if (code === "23505") return databaseFailure(
    "CLIENT_VACCINATION_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或疫苗紀錄識別已存在。", 409,
  );
  if (["23514", "40001", "55000"].includes(code ?? "")) return databaseFailure(
    "CLIENT_VACCINATION_VERSION_CONFLICT",
    "疫苗紀錄版本、終端狀態或個案狀態已變更；請重新載入。", 409,
  );
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) {
    return databaseFailure("INVALID_CLIENT_VACCINATION_RECORD",
      "個案、疫苗、劑次、日期、批號、院所、證明或更正資料未通過驗證。", 400);
  }
  return databaseFailure("CLIENT_VACCINATION_SAVE_UNCERTAIN",
    "個案疫苗紀錄未確認完成；請保留相同操作鍵重試。", 409);
}
