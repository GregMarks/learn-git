import type { FieldRoutesClient } from "../fieldroutes/client.js";
import {
  fr,
  toNumber,
  type DateRange,
  type FrAppointment,
  type FrTicket,
} from "../fieldroutes/entities.js";

export type RevenueDimension = "service-type" | "route" | "tech";

export interface RevenueRow {
  key: string;
  label: string;
  tickets: number;
  total: number;
}

export interface RevenueReport {
  range: DateRange;
  by: RevenueDimension;
  rows: RevenueRow[];
  grandTotal: number;
}

interface Lookups {
  serviceTypes: Map<string, string>;
  employees: Map<string, string>;
  routes: Map<string, string>;
  appointments: Map<string, FrAppointment>;
}

export function rollupRevenue(
  tickets: FrTicket[],
  by: RevenueDimension,
  lookups: Lookups,
  range: DateRange,
): RevenueReport {
  const rows = new Map<string, RevenueRow>();

  for (const ticket of tickets) {
    if (ticket.active !== undefined && String(ticket.active) === "0") continue;
    const appt = ticket.appointmentID
      ? lookups.appointments.get(String(ticket.appointmentID))
      : undefined;

    let key: string;
    let label: string;
    switch (by) {
      case "service-type": {
        key = String(ticket.serviceID ?? "unknown");
        label = lookups.serviceTypes.get(key) ?? `service #${key}`;
        break;
      }
      case "route": {
        key = String(appt?.routeID ?? "unknown");
        label = lookups.routes.get(key) ?? (key === "unknown" ? "(no appointment/route)" : `route #${key}`);
        break;
      }
      case "tech": {
        key = String(appt?.employeeID ?? "unknown");
        label = lookups.employees.get(key) ?? (key === "unknown" ? "(no appointment/tech)" : `employee #${key}`);
        break;
      }
    }

    const row = rows.get(key) ?? { key, label, tickets: 0, total: 0 };
    row.tickets += 1;
    row.total = Math.round((row.total + toNumber(ticket.total)) * 100) / 100;
    rows.set(key, row);
  }

  const sorted = [...rows.values()].sort((a, b) => b.total - a.total);
  const grandTotal = Math.round(sorted.reduce((s, r) => s + r.total, 0) * 100) / 100;
  return { range, by, rows: sorted, grandTotal };
}

export async function revenueReport(
  client: FieldRoutesClient,
  by: RevenueDimension,
  range: DateRange,
): Promise<RevenueReport> {
  const tickets = await fr.tickets(client, range);

  const lookups: Lookups = {
    serviceTypes: new Map(),
    employees: new Map(),
    routes: new Map(),
    appointments: new Map(),
  };

  if (by === "service-type") {
    for (const st of await fr.serviceTypes(client)) {
      lookups.serviceTypes.set(String(st.typeID), st.description ?? `service #${st.typeID}`);
    }
  } else {
    // route/tech live on the appointment the ticket came from
    for (const appt of await fr.appointments(client, range)) {
      lookups.appointments.set(String(appt.appointmentID), appt);
    }
    if (by === "tech") {
      for (const emp of await fr.employees(client)) {
        lookups.employees.set(
          String(emp.employeeID),
          [emp.fname, emp.lname].filter(Boolean).join(" ") || `employee #${emp.employeeID}`,
        );
      }
    } else {
      for (const route of await fr.routes(client, range)) {
        lookups.routes.set(String(route.routeID), route.title ?? `route #${route.routeID}`);
      }
    }
  }

  return rollupRevenue(tickets, by, lookups, range);
}

export function formatRevenue(report: RevenueReport): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const lines = [
    `FieldRoutes revenue by ${report.by}, ${report.range.from} → ${report.range.to}`,
    "",
  ];
  const width = Math.max(12, ...report.rows.map((r) => r.label.length));
  for (const row of report.rows) {
    lines.push(
      `  ${row.label.padEnd(width)}  ${money(row.total).padStart(12)}  (${row.tickets} tickets)`,
    );
  }
  lines.push("");
  lines.push(`  ${"TOTAL".padEnd(width)}  ${money(report.grandTotal).padStart(12)}`);
  return lines.join("\n");
}
