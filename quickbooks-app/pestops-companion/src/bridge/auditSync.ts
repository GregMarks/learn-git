import type { FieldRoutesClient } from "../fieldroutes/client.js";
import { fr, toNumber, type DateRange, type FrPayment } from "../fieldroutes/entities.js";
import type { QboClient } from "../qbo/client.js";
import { queryAll } from "../qbo/query.js";

/**
 * Sync audit: did FieldRoutes' native QBO sync actually post anything?
 *
 * Approach: take every successful FieldRoutes payment in the range, bucket by
 * day, then look for QBO transactions (deposits, journal entries, sales
 * receipts, received payments) whose amount matches a day's FieldRoutes total
 * (or an individual payment) within a small date window. FieldRoutes' native
 * sync posts aggregated day-level entries, so day-bucket matches are the
 * strongest signal.
 */

export interface QboTxn {
  type: "Deposit" | "JournalEntry" | "SalesReceipt" | "Payment";
  id: string;
  date: string; // TxnDate
  amount: number;
}

export interface DayBucket {
  date: string;
  frTotal: number;
  frCount: number;
  qboMatches: QboTxn[];
}

export interface AuditReport {
  range: DateRange;
  frPaymentTotal: number;
  frPaymentCount: number;
  qboTxnTotal: number;
  qboTxnCount: number;
  days: DayBucket[];
  matchedDays: number;
  unmatchedDays: number;
  verdict: string;
}

interface RawQboRow {
  Id: string;
  TxnDate?: string;
  TotalAmt?: number;
  Line?: Array<{ Amount?: number }>;
}

const DATE_TOLERANCE_DAYS = 3;
const AMOUNT_TOLERANCE = 0.01;

function journalAmount(row: RawQboRow): number {
  // Journal entries have no TotalAmt; sum one side (half the line total).
  const lineSum = (row.Line ?? []).reduce((sum, l) => sum + (l.Amount ?? 0), 0);
  return lineSum / 2;
}

export async function fetchQboTxns(qbo: QboClient, range: DateRange): Promise<QboTxn[]> {
  const where = `WHERE TxnDate >= '${range.from}' AND TxnDate <= '${range.to}'`;
  const txns: QboTxn[] = [];
  const sources: Array<{ type: QboTxn["type"]; query: string; amount: (r: RawQboRow) => number }> =
    [
      { type: "Deposit", query: `SELECT * FROM Deposit ${where}`, amount: (r) => r.TotalAmt ?? 0 },
      {
        type: "JournalEntry",
        query: `SELECT * FROM JournalEntry ${where}`,
        amount: journalAmount,
      },
      {
        type: "SalesReceipt",
        query: `SELECT * FROM SalesReceipt ${where}`,
        amount: (r) => r.TotalAmt ?? 0,
      },
      { type: "Payment", query: `SELECT * FROM Payment ${where}`, amount: (r) => r.TotalAmt ?? 0 },
    ];
  for (const source of sources) {
    const rows = await queryAll<RawQboRow>(qbo, source.query);
    for (const row of rows) {
      txns.push({
        type: source.type,
        id: row.Id,
        date: row.TxnDate ?? "",
        amount: Math.round(source.amount(row) * 100) / 100,
      });
    }
  }
  return txns;
}

function daysApart(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export function isSuccessfulPayment(p: FrPayment): boolean {
  // status 1 = successful in the documented FieldRoutes shape; treat missing
  // status as countable so we don't silently drop revenue.
  return p.status === undefined || String(p.status) === "1";
}

export function buildReport(
  range: DateRange,
  frPayments: FrPayment[],
  qboTxns: QboTxn[],
): AuditReport {
  const successful = frPayments.filter(isSuccessfulPayment);

  const byDay = new Map<string, { total: number; count: number }>();
  for (const p of successful) {
    const day = (p.date ?? "").slice(0, 10);
    if (!day) continue;
    const bucket = byDay.get(day) ?? { total: 0, count: 0 };
    bucket.total = Math.round((bucket.total + toNumber(p.amount)) * 100) / 100;
    bucket.count += 1;
    byDay.set(day, bucket);
  }

  const unclaimed = new Set(qboTxns);
  const days: DayBucket[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, count }]) => {
      const matches: QboTxn[] = [];
      for (const txn of unclaimed) {
        if (
          Math.abs(txn.amount - total) <= AMOUNT_TOLERANCE &&
          daysApart(txn.date, date) <= DATE_TOLERANCE_DAYS
        ) {
          matches.push(txn);
          unclaimed.delete(txn);
          break; // one day-total match is enough
        }
      }
      return { date, frTotal: total, frCount: count, qboMatches: matches };
    });

  const frPaymentTotal = Math.round(days.reduce((s, d) => s + d.frTotal, 0) * 100) / 100;
  const qboTxnTotal = Math.round(qboTxns.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const matchedDays = days.filter((d) => d.qboMatches.length > 0).length;
  const unmatchedDays = days.length - matchedDays;

  let verdict: string;
  if (days.length === 0) {
    verdict = "No successful FieldRoutes payments in this range — nothing to audit.";
  } else if (qboTxns.length === 0) {
    verdict =
      "QuickBooks has NO deposits, journal entries, sales receipts, or payments in this range. " +
      "The native FieldRoutes→QBO sync does not appear to have ever posted here.";
  } else if (matchedDays === days.length) {
    verdict = "Every FieldRoutes day-total has a matching QBO transaction — sync looks healthy.";
  } else if (matchedDays === 0) {
    verdict =
      "QBO has activity in this range, but none of it matches FieldRoutes day-totals. " +
      "The QBO activity likely comes from somewhere else (manual entry, bank feed) — " +
      "the native sync does not appear to be posting.";
  } else {
    verdict = `${matchedDays}/${days.length} FieldRoutes days matched in QBO — sync is partial or QBO has mixed sources. Review the unmatched days below.`;
  }

  return {
    range,
    frPaymentTotal,
    frPaymentCount: successful.length,
    qboTxnTotal,
    qboTxnCount: qboTxns.length,
    days,
    matchedDays,
    unmatchedDays,
    verdict,
  };
}

export async function auditSync(
  frClient: FieldRoutesClient,
  qbo: QboClient,
  range: DateRange,
): Promise<AuditReport> {
  const [frPayments, qboTxns] = await Promise.all([
    fr.payments(frClient, range),
    fetchQboTxns(qbo, range),
  ]);
  return buildReport(range, frPayments, qboTxns);
}

export function formatReport(report: AuditReport): string {
  const lines: string[] = [];
  const money = (n: number) => `$${n.toFixed(2)}`;
  lines.push(`Sync audit ${report.range.from} → ${report.range.to}`);
  lines.push("");
  lines.push(`FieldRoutes: ${report.frPaymentCount} successful payments, ${money(report.frPaymentTotal)}`);
  lines.push(`QuickBooks:  ${report.qboTxnCount} candidate transactions, ${money(report.qboTxnTotal)}`);
  lines.push("");
  lines.push(`Matched days: ${report.matchedDays}   Unmatched days: ${report.unmatchedDays}`);
  lines.push("");
  for (const day of report.days) {
    const status =
      day.qboMatches.length > 0
        ? `matched ${day.qboMatches.map((m) => `${m.type}#${m.id}`).join(", ")}`
        : "NO QBO MATCH";
    lines.push(`  ${day.date}  ${money(day.frTotal).padStart(12)}  (${day.frCount} pmts)  ${status}`);
  }
  lines.push("");
  lines.push(`Verdict: ${report.verdict}`);
  return lines.join("\n");
}
