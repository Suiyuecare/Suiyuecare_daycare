import { describe, expect, it } from "vitest";

import { CLIENT_SERVICE_STATUSES as chewing } from "@/lib/chewing-assessments/types";
import { CLIENT_SERVICE_STATUSES as fallRisk } from "@/lib/fall-risk-assessments/types";
import { CLIENT_SERVICE_STATUSES as gds } from "@/lib/gds-assessments/types";
import { CLIENT_SERVICE_STATUSES as nsi } from "@/lib/nsi-nutrition-screenings/types";
import { CLIENT_SERVICE_STATUSES as spmsq } from "@/lib/spmsq-assessments/types";

import { CLIENT_LIFECYCLE_STATUSES } from "./types";

describe("pending-admission candidate assessment status", () => {
  it.each([
    ["SPMSQ", spmsq],
    ["GDS", gds],
    ["fall risk", fallRisk],
    ["NSI", nsi],
    ["chewing", chewing],
  ])("uses the canonical lifecycle vocabulary for %s", (_, statuses) => {
    expect(statuses).toBe(CLIENT_LIFECYCLE_STATUSES);
    expect(statuses).toContain("pending");
  });
});
