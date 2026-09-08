const DECIMAL_PATTERN = /^(-?)(0|[1-9]\d{0,13})(?:\.(\d{1,4}))?$/u;

export function inventoryDecimalToScaledInteger(value: string) {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error("INVALID_INVENTORY_DECIMAL");
  const magnitude = BigInt(match[2]!) * BigInt(10_000) +
    BigInt((match[3] ?? "").padEnd(4, "0") || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

export function inventoryDecimalEqual(left: string, right: string) {
  return inventoryDecimalToScaledInteger(left) === inventoryDecimalToScaledInteger(right);
}

export function inventoryScaledIntegerToDecimal(value: bigint) {
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  return `${negative ? "-" : ""}${magnitude / BigInt(10_000)}.${String(magnitude % BigInt(10_000)).padStart(4, "0")}`;
}
