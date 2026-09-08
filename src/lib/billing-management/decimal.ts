const MONEY = /^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;
const QUANTITY = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/u;

function scaled(value: string, scale: number, expression: RegExp) {
  if (!expression.test(value)) throw new Error("INVALID_BILLING_DECIMAL");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const result = BigInt(whole!) * BigInt(10 ** scale)
    + BigInt(fraction.padEnd(scale, "0"));
  return negative ? -result : result;
}

export const billingMoneyToCents = (value: string) => scaled(value, 2, MONEY);
export const billingQuantityToUnits = (value: string) => scaled(value, 4, QUANTITY);

export function billingCentsToMoney(value: bigint) {
  const negative = value < BigInt(0); const absolute = negative ? -value : value;
  const rendered = `${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
  return negative ? `-${rendered}` : rendered;
}

export function billingLineAmountIsExact(quantity: string, unitPrice: string, amount: string) {
  const product = billingQuantityToUnits(quantity) * billingMoneyToCents(unitPrice);
  return product % BigInt(10_000) === BigInt(0)
    && product / BigInt(10_000) === billingMoneyToCents(amount);
}
