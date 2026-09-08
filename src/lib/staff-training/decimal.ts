const SCALE = BigInt(10_000);

export function staffTrainingDecimalToScaledInteger(value: string) {
  const match = /^(-?)(0|[1-9]\d{0,13})(?:\.(\d{1,4}))?$/u.exec(value);
  if (!match) throw new Error("INVALID_STAFF_TRAINING_DECIMAL");
  const fraction = (match[3] ?? "").padEnd(4, "0");
  const magnitude = BigInt(match[2]) * SCALE + BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

export function staffTrainingScaledIntegerToDecimal(value: bigint) {
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  return `${negative ? "-" : ""}${magnitude / SCALE}.${String(magnitude % SCALE).padStart(4, "0")}`;
}

export function canonicalStaffTrainingDecimal(value: string) {
  return staffTrainingScaledIntegerToDecimal(staffTrainingDecimalToScaledInteger(value));
}

export function staffTrainingDecimalEqual(left: string, right: string) {
  try {
    return staffTrainingDecimalToScaledInteger(left) ===
      staffTrainingDecimalToScaledInteger(right);
  } catch {
    return false;
  }
}
