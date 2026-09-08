import { z } from "zod";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const name = z.string().trim().min(1).max(160).refine(
  (value) => !/[\u0000-\u001F\u007F]/u.test(value),
);
const branch = z.object({ id: uuid, name }).strict();
const base = {
  requestId: uuid,
  status: z.literal("ok"),
  errors: z.array(z.never()).length(0),
};
const listEnvelope = z.object({
  ...base,
  data: z.object({
    branches: z.array(branch).max(100),
    currentBranchId: uuid,
  }).strict(),
}).strict();
const switchEnvelope = z.object({
  ...base,
  data: z.object({ branch, demo: z.boolean() }).strict(),
}).strict();

export type BranchClientOption = z.infer<typeof branch>;

export class BranchClientContractError extends Error {
  constructor() {
    super("分支回覆不完整，請重新載入確認目前分支。");
    this.name = "BranchClientContractError";
  }
}

export function parseBranchListEnvelope(
  raw: unknown,
  httpStatus: number,
  expectedCurrentBranchId: string,
) {
  const parsed = listEnvelope.safeParse(raw);
  const expected = uuid.safeParse(expectedCurrentBranchId);
  if (!parsed.success || !expected.success || httpStatus !== 200) {
    throw new BranchClientContractError();
  }
  const data = parsed.data.data;
  const ids = data.branches.map((item) => item.id);
  if (
    data.currentBranchId !== expected.data ||
    new Set(ids).size !== ids.length ||
    !ids.includes(data.currentBranchId)
  ) {
    throw new BranchClientContractError();
  }
  return parsed.data;
}

export function parseBranchSwitchEnvelope(
  raw: unknown,
  httpStatus: number,
  expected: BranchClientOption,
) {
  const parsed = switchEnvelope.safeParse(raw);
  const expectedBranch = branch.safeParse(expected);
  if (
    !parsed.success ||
    !expectedBranch.success ||
    httpStatus !== 200 ||
    parsed.data.data.branch.id !== expectedBranch.data.id ||
    parsed.data.data.branch.name !== expectedBranch.data.name
  ) {
    throw new BranchClientContractError();
  }
  return parsed.data;
}
