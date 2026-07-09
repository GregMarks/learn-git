import { describe, expect, it } from "vitest";
import { rollupRevenue } from "../src/bridge/revenue.js";
import type { FrAppointment, FrTicket } from "../src/fieldroutes/entities.js";

const range = { from: "2026-06-01", to: "2026-06-30" };

const ticket = (overrides: Partial<FrTicket>): FrTicket => ({
  ticketID: Math.random(),
  customerID: 1,
  ...overrides,
});

function lookups(appointments: FrAppointment[] = []) {
  return {
    serviceTypes: new Map([
      ["10", "General Pest Control"],
      ["20", "Termite Treatment"],
    ]),
    employees: new Map([["5", "Sam Tech"]]),
    routes: new Map([["3", "North Route"]]),
    appointments: new Map(appointments.map((a) => [String(a.appointmentID), a])),
  };
}

describe("rollupRevenue", () => {
  it("groups by service type with labels, sorted by total desc", () => {
    const report = rollupRevenue(
      [
        ticket({ serviceID: 10, total: 120 }),
        ticket({ serviceID: 10, total: "80.25" }),
        ticket({ serviceID: 20, total: 900 }),
      ],
      "service-type",
      lookups(),
      range,
    );
    expect(report.rows[0]).toMatchObject({ label: "Termite Treatment", total: 900, tickets: 1 });
    expect(report.rows[1]).toMatchObject({ label: "General Pest Control", total: 200.25, tickets: 2 });
    expect(report.grandTotal).toBe(1100.25);
  });

  it("groups by tech via the linked appointment", () => {
    const appts: FrAppointment[] = [{ appointmentID: 900, customerID: 1, employeeID: 5 }];
    const report = rollupRevenue(
      [ticket({ appointmentID: 900, total: 150 }), ticket({ total: 60 })],
      "tech",
      lookups(appts),
      range,
    );
    const labels = report.rows.map((r) => r.label);
    expect(labels).toContain("Sam Tech");
    expect(labels).toContain("(no appointment/tech)");
  });

  it("skips inactive (voided) tickets", () => {
    const report = rollupRevenue(
      [ticket({ serviceID: 10, total: 100, active: 0 }), ticket({ serviceID: 10, total: 40 })],
      "service-type",
      lookups(),
      range,
    );
    expect(report.grandTotal).toBe(40);
  });
});
