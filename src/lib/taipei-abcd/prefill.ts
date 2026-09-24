import type { IntakeProfile } from "@/lib/client-intake/model";
import { parseTaipeiAnswers } from "./parser";
import type { TaipeiAbcdPrefill } from "./types";
/** Suggested values from the saved profile, not a claim that CMS was the
 * source of every field. Does not include a full ID number or medical inference. */
export function profileToTaipeiPrefill(profile: Pick<IntakeProfile, "displayName" | "clientCode" | "dateOfBirth" | "sex" | "phone" | "registeredAddress" | "residentialAddress" | "cmsLevel" | "contacts">): TaipeiAbcdPrefill[] {
  const values: [string, string | number | null | undefined][] = [
    ["A0.case_number", profile.clientCode], ["A1.name", profile.displayName], ["A6.birth_date", profile.dateOfBirth],
    ["A4.sex", profile.sex === "male" ? "男" : profile.sex === "female" ? "女" : null],
    ["A7.home", profile.phone], ["A11.address", profile.registeredAddress], ["A12.address", profile.residentialAddress], ["A10.cms_level", profile.cmsLevel],
  ];
  profile.contacts.slice(0, 3).forEach((contact, i) => {
    for (const key of ["name", "relationship", "address", "phone"] as const) values.push([`A21.${i + 1}.${key}`, contact[key]]);
  });
  return values.flatMap(([fieldKey, raw]) => {
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === null || value === undefined || value === "") return [];
    try { parseTaipeiAnswers("A", { [fieldKey]: { state: "unconfirmed", value, reason: null } }); }
    catch { return []; }
    return [{ fieldKey, value, sourceLabel: "已存個案基本資料，須逐欄核對" }];
  });
}
