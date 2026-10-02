"use client";

import { createContext } from "react";

import type { DailyWorkflowPage, DailyWorkflowShift } from "@/lib/core-care/workflow-links";

export type DailyNavigationScope = {
  organizationId: string;
  branchId: string;
  userId: string;
};

export type ValidatedDailySelection = {
  page: DailyWorkflowPage;
  serviceDate: string;
  clientId: string;
  shift?: DailyWorkflowShift;
  scope: DailyNavigationScope;
};

export const DailyNavigationRegistrationContext = createContext<
  ((selection: ValidatedDailySelection) => () => void) | null
>(null);
