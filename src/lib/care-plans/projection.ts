import type {
  CarePlanSnapshot,
  CarePlanVersionStatus,
  EffectivePlan,
} from "./types";

export function isPlanEffective(plan: EffectivePlan, serviceDate: string) {
  return (
    plan.status === "signed" &&
    plan.effectiveFrom <= serviceDate &&
    plan.effectiveTo >= serviceDate
  );
}

export function filterCarePlanSnapshot(
  snapshot: CarePlanSnapshot,
  options: {
    kind: "authorized" | "service";
    query: string;
    status: "all" | CarePlanVersionStatus;
  },
) {
  const normalizedQuery = options.query.trim().toLocaleLowerCase("zh-TW");
  const plans =
    options.kind === "authorized"
      ? snapshot.authorizedPlans
      : snapshot.servicePlans;
  return plans.filter((plan) => {
    const matchesQuery =
      !normalizedQuery ||
      `${plan.clientName} ${plan.clientCode}`
        .toLocaleLowerCase("zh-TW")
        .includes(normalizedQuery);
    return matchesQuery && (options.status === "all" || plan.status === options.status);
  });
}

