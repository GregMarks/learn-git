import { describe, expect, it } from "vitest";
import { buildReport, type QboTxn } from "../src/bridge/auditSync.js";
import type { FrPayment } from "../src/fieldroutes/entities.js";

const range = { from: "2026-06-01", to: "2026-06-30" };

const pmt = (date: string, amount: number, status: string | number = 1): FrPayment => ({
  paymentID: Math.random(),
  customerID: 1,
  date,
  amount,
  status,
});

const txn = (type: QboTxn["type"], date: string, amount: number, id = "1"): QboTxn => ({
  type,
  id,
  date,
  amount,
});

describe("buildReport", () => {
  it("matches a day-total against a QBO deposit within the date window", () => {
    const report = buildReport(
      range,
      [pmt("2026-06-02", 100), pmt("2026-06-02", 50.5)],
      [txn("Deposit", "2026-06-04", 150.5)], // 2 days later — inside ±3 tolerance
    );
    expect(report.days).toHaveLength(1);
    expect(report.days[0]!.frTotal).toBe(150.5);
    expect(report.days[0]!.qboMatches).toHaveLength(1);
    expect(report.matchedDays).toBe(1);
    expect(report.verdict).toMatch(/sync looks healthy/);
  });

  it("declares the sync dead when QBO is empty", () => {
    const report = buildReport(range, [pmt("2026-06-02", 100)], []);
    expect(report.unmatchedDays).toBe(1);
    expect(report.verdict).toMatch(/does not appear to have ever posted/);
  });

  it("flags mixed-source QBO activity that matches nothing", () => {
    const report = buildReport(
      range,
      [pmt("2026-06-02", 100)],
      [txn("Payment", "2026-06-20", 999)],
    );
    expect(report.matchedDays).toBe(0);
    expect(report.verdict).toMatch(/does not appear to be posting/);
  });

  it("reports partial matches day by day", () => {
    const report = buildReport(
      range,
      [pmt("2026-06-02", 100), pmt("2026-06-10", 200)],
      [txn("JournalEntry", "2026-06-02", 100)],
    );
    expect(report.matchedDays).toBe(1);
    expect(report.unmatchedDays).toBe(1);
    expect(report.verdict).toMatch(/1\/2/);
  });

  it("excludes failed payments and does not double-claim one QBO txn", () => {
    const report = buildReport(
      range,
      [pmt("2026-06-02", 100), pmt("2026-06-02", 400, 0), pmt("2026-06-05", 100)],
      [txn("Deposit", "2026-06-03", 100, "d1")],
    );
    // failed $400 payment ignored → day total 100, matched by d1;
    // 06-05's identical $100 must NOT reuse the same deposit
    expect(report.frPaymentCount).toBe(2);
    expect(report.days[0]!.frTotal).toBe(100);
    expect(report.matchedDays).toBe(1);
    expect(report.unmatchedDays).toBe(1);
  });

  it("respects the ±3 day tolerance boundary", () => {
    const report = buildReport(
      range,
      [pmt("2026-06-10", 75)],
      [txn("Deposit", "2026-06-14", 75)], // 4 days — outside tolerance
    );
    expect(report.matchedDays).toBe(0);
  });
});
