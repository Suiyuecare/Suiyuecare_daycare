import {
  Accessibility, Activity, Apple, Archive, BadgeCheck, BellRing,
  BookOpenCheck, Brain, BriefcaseBusiness, Building2, CalendarCheck2,
  CalendarDays, CarFront, ChartNoAxesCombined, CircleAlert,
  ClipboardCheck, ClipboardList, CreditCard, FileCheck2, FileHeart,
  FilePlus2, FileText, GraduationCap, HandHeart, HeartHandshake,
  HeartPulse, IdCard, LayoutDashboard, ListChecks, Mail,
  MessageCircleMore, Pill, Scale, SearchCheck, Send, Settings2,
  ShieldCheck, Soup, Stethoscope, Syringe, UsersRound, Wallet,
  type LucideIcon,
} from "lucide-react";

import type { ModuleId, PageCatalogEntry } from "@/lib/catalog";

/** Navigation stays text-first. Distinct pictograms help staff scan the long
 * approved catalog without changing routes, permissions, or status meaning. */
const moduleIcons: Record<ModuleId, LucideIcon> = {
  workspace: LayoutDashboard,
  "daily-care": HeartHandshake,
  assessments: ClipboardCheck,
  quality: ShieldCheck,
  "social-work": UsersRound,
  "professional-care": Stethoscope,
  communication: MessageCircleMore,
  "service-management": BriefcaseBusiness,
  operations: Building2,
  governance: Settings2,
  "family-portal": BookOpenCheck,
};

const pageIcons: Readonly<Record<number, LucideIcon>> = {
  1: LayoutDashboard, 2: UsersRound,
  3: HeartPulse, 4: Activity, 5: Syringe, 6: BookOpenCheck,
  7: Pill, 8: ClipboardList, 9: ShieldCheck, 10: CalendarCheck2,
  11: Brain, 12: HeartPulse, 13: Accessibility, 14: Apple,
  15: Accessibility, 16: ListChecks, 17: Soup, 18: Brain,
  19: Stethoscope, 20: MessageCircleMore, 21: ClipboardCheck,
  22: FileText, 23: Syringe,
  24: CircleAlert, 25: ShieldCheck, 26: Scale, 27: CircleAlert,
  28: UsersRound, 29: HandHeart, 30: CalendarDays,
  31: BriefcaseBusiness, 32: ClipboardCheck,
  33: Activity, 34: Accessibility, 35: Soup, 36: Apple,
  37: MessageCircleMore, 38: UsersRound, 39: Send,
  40: Activity, 41: Accessibility, 42: ChartNoAxesCombined,
  43: MessageCircleMore, 44: CalendarDays, 45: BellRing,
  46: CalendarCheck2, 47: CarFront, 48: CarFront,
  49: FileCheck2, 50: FileHeart, 51: Stethoscope,
  52: ClipboardList, 53: ListChecks, 54: ChartNoAxesCombined,
  55: FileCheck2, 56: MessageCircleMore, 57: Soup,
  58: Building2, 59: UsersRound, 60: IdCard,
  61: FilePlus2, 62: FileText, 63: CalendarDays,
  64: Wallet, 65: Activity, 66: HandHeart,
  67: BellRing, 68: Mail, 69: HeartPulse,
  70: ChartNoAxesCombined, 71: GraduationCap, 72: BadgeCheck,
  73: Syringe, 74: ShieldCheck, 75: UsersRound,
  76: MessageCircleMore, 77: Archive, 78: FileHeart,
  79: ClipboardCheck,
  80: FilePlus2, 81: ShieldCheck, 82: Settings2, 83: SearchCheck,
  84: LayoutDashboard, 85: MessageCircleMore, 86: HeartPulse,
  87: CalendarDays, 88: CreditCard, 89: Settings2,
};

export function iconForPage(page: Pick<PageCatalogEntry, "number" | "moduleId">): LucideIcon {
  return pageIcons[page.number] ?? moduleIcons[page.moduleId];
}
