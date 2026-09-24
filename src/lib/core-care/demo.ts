import type {
  DailyCareSnapshot,
  DailyClientSummary,
} from "./types";

const demoPeople = [
  { id: "a1111111-1111-4111-8111-111111111111", code: "HX-021", name: "陳O華" },
  { id: "a2222222-2222-4222-8222-222222222222", code: "HX-022", name: "林O英" },
  { id: "a3333333-3333-4333-8333-333333333333", code: "HX-023", name: "黃O生" },
  { id: "a4444444-4444-4444-8444-444444444444", code: "HX-024", name: "吳O美" },
  { id: "a5555555-5555-4555-8555-555555555555", code: "HX-025", name: "張O德" },
  { id: "a6666666-6666-4666-8666-666666666666", code: "HX-026", name: "李O芳" },
] as const;

function demoClient(
  serviceDate: string,
  person: (typeof demoPeople)[number],
  index: number,
): DailyClientSummary {
  const hasAttendance = index !== 4;
  const hasVitals = index !== 2 && index !== 5;
  const hasDiary = index !== 1;
  const checkedInAt = `${serviceDate}T0${8 + (index % 2)}:${index % 2 ? "12" : "05"}:00+08:00`;

  return {
    clientId: person.id,
    clientCode: person.code,
    displayName: person.name,
    attendance: hasAttendance
      ? {
          id: `b${index + 1}111111-1111-4111-8111-111111111111`,
          status: index === 3 ? "leave" : "present",
          checkedInAt: index === 3 ? null : checkedInAt,
          checkedOutAt:
            index === 0 ? `${serviceDate}T16:03:00+08:00` : null,
          source: "staff",
        }
      : null,
    vitalSigns: hasVitals
      ? {
          measuredAt: `${serviceDate}T09:${String(10 + index * 4).padStart(2, "0")}:00+08:00`,
          systolic: 118 + index * 3,
          diastolic: 72 + index,
          pulse: 68 + index * 2,
          temperature: 36.3 + index * 0.1,
          oxygenSaturation: 97 - (index % 2),
          capturedKinds: [
            "blood_pressure_systolic",
            "blood_pressure_diastolic",
            "pulse",
            "temperature",
            "oxygen_saturation",
          ],
        }
      : null,
    careDiary: hasDiary
      ? {
          id: `c${index + 1}111111-1111-4111-8111-111111111111`,
          status: index === 4 ? "draft" : "signed",
          occurredAt: `${serviceDate}T1${index % 2}:25:00+08:00`,
          hasAbnormalFlag: index === 0,
        }
      : null,
    completedServiceCount: index % 3,
    sourceCoverage:
      Number(hasAttendance) + Number(hasVitals) + Number(hasDiary) + Number(index % 3 > 0),
    applicability: { attendance: "expected", care: index === 3 ? "not_expected" : "expected", reason: index === 3 ? "leave_or_absent" : hasAttendance ? "arrived" : "scheduled", eligible: true },
  };
}

export function buildDemoDailySnapshot(serviceDate: string): DailyCareSnapshot {
  const clients = demoPeople.map((person, index) =>
    demoClient(serviceDate, person, index),
  );
  const generatedAt = `${serviceDate}T10:24:00+08:00`;
  return {
    serviceDate,
    generatedAt,
    staleAfter: `${serviceDate}T10:25:00+08:00`,
    clients,
    sourceCounts: {
      activeClients: clients.length,
      attendanceRecords: clients.filter((client) => client.attendance).length,
      clientsWithMeasurements: clients.filter((client) => client.vitalSigns).length,
      careDiaryRecords: clients.filter((client) => client.careDiary).length,
      completedServiceEvents: clients.reduce(
        (total, client) => total + client.completedServiceCount,
        0,
      ),
    },
    sourceAccess: {
      clients: true,
      attendance: true,
      measurements: true,
      careDiaries: true,
      serviceEvents: true,
    },
    demo: true,
  };
}
