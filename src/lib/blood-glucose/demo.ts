import { projectBloodGlucoseSnapshot } from "./projection";

const demoClients = [
  { id: "a1111111-1111-4111-8111-111111111111", client_code: "HX-021", display_name: "陳O華" },
  { id: "a2222222-2222-4222-8222-222222222222", client_code: "HX-022", display_name: "林O英" },
  { id: "a3333333-3333-4333-8333-333333333333", client_code: "HX-023", display_name: "黃O生" },
  { id: "a4444444-4444-4444-8444-444444444444", client_code: "HX-024", display_name: "吳O美" },
] as const;

export function buildDemoBloodGlucoseSnapshot(serviceDate: string) {
  return projectBloodGlucoseSnapshot({
    serviceDate,
    generatedAt: `${serviceDate}T10:24:00+08:00`,
    clients: demoClients,
    measurements: [
      {
        id: "b1111111-1111-4111-8111-111111111111",
        client_id: demoClients[0].id,
        measured_at: `${serviceDate}T09:10:00+08:00`,
        numeric_value: 108,
        unit: "mg/dL",
        context: { meal_context: "fasting" },
        source: "staff",
      },
      {
        id: "b2222222-2222-4222-8222-222222222222",
        client_id: demoClients[0].id,
        measured_at: `${serviceDate}T11:35:00+08:00`,
        numeric_value: 142,
        unit: "mg/dL",
        context: { meal_context: "post_meal" },
        source: "staff",
      },
      {
        id: "b3333333-3333-4333-8333-333333333333",
        client_id: demoClients[1].id,
        measured_at: `${serviceDate}T09:18:00+08:00`,
        numeric_value: 6.4,
        unit: "mmol/L",
        context: { meal_context: "pre_meal" },
        source: "device_import",
      },
      {
        id: "b4444444-4444-4444-8444-444444444444",
        client_id: demoClients[3].id,
        measured_at: `${serviceDate}T10:02:00+08:00`,
        numeric_value: 119,
        unit: "mg/dL",
        context: { meal_context: "random" },
        source: "staff",
      },
    ],
    demo: true,
  });
}
