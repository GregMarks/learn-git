import { Command } from "commander";
import { qboConfig } from "../config.js";
import { connect } from "../auth/oauth.js";
import { makeFieldRoutesClient, makeQboClient } from "../clients.js";
import { companyInfo, queryAll } from "../qbo/query.js";
import { fr, toNumber } from "../fieldroutes/entities.js";
import { auditSync, formatReport } from "../bridge/auditSync.js";
import { formatRevenue, revenueReport, type RevenueDimension } from "../bridge/revenue.js";

const program = new Command();
program.name("qbc").description("QuickBooks Online + FieldRoutes companion");

function requireRange(opts: { from?: string; to?: string }): { from: string; to: string } {
  if (!opts.from || !opts.to || !/^\d{4}-\d{2}-\d{2}$/.test(opts.from + "")) {
    program.error("--from and --to are required, format YYYY-MM-DD");
  }
  return { from: opts.from!, to: opts.to! };
}

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

program
  .command("connect")
  .description("Run the QuickBooks OAuth flow and save tokens")
  .action(async () => {
    await connect(qboConfig()).catch(fail);
  });

const qbo = program.command("qbo").description("QuickBooks Online commands");

qbo
  .command("company")
  .description("Show connected company info (proves auth works)")
  .action(async () => {
    try {
      const info = await companyInfo(makeQboClient());
      console.log(`Company: ${info.CompanyName}`);
      if (info.LegalName && info.LegalName !== info.CompanyName)
        console.log(`Legal name: ${info.LegalName}`);
      const addr = info.CompanyAddr;
      if (addr?.City) console.log(`Location: ${addr.City}, ${addr.CountrySubDivisionCode ?? ""}`);
      console.log(`Environment: ${qboConfig().environment}`);
    } catch (err) {
      fail(err);
    }
  });

qbo
  .command("query <q>")
  .description('Run a QBO query, e.g. "SELECT * FROM Deposit WHERE TxnDate > \'2026-06-01\'"')
  .action(async (q: string) => {
    try {
      const rows = await queryAll(makeQboClient(), q);
      console.log(JSON.stringify(rows, null, 2));
      console.error(`${rows.length} rows`);
    } catch (err) {
      fail(err);
    }
  });

const frCmd = program.command("fr").description("FieldRoutes commands (read-only)");

frCmd
  .command("tickets")
  .description("List tickets (FieldRoutes invoices) in a date range")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .action(async (opts) => {
    try {
      const tickets = await fr.tickets(makeFieldRoutesClient(), requireRange(opts));
      console.log(JSON.stringify(tickets, null, 2));
      const total = tickets.reduce((s, t) => s + toNumber(t.total), 0);
      console.error(`${tickets.length} tickets, total $${total.toFixed(2)}`);
    } catch (err) {
      fail(err);
    }
  });

frCmd
  .command("payments")
  .description("List payments in a date range")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .action(async (opts) => {
    try {
      const payments = await fr.payments(makeFieldRoutesClient(), requireRange(opts));
      console.log(JSON.stringify(payments, null, 2));
      const total = payments.reduce((s, p) => s + toNumber(p.amount), 0);
      console.error(`${payments.length} payments, total $${total.toFixed(2)}`);
    } catch (err) {
      fail(err);
    }
  });

frCmd
  .command("customers")
  .description("List active customers")
  .option("--all", "include inactive customers")
  .action(async (opts) => {
    try {
      const customers = await fr.customers(makeFieldRoutesClient(), !opts.all);
      console.log(JSON.stringify(customers, null, 2));
      console.error(`${customers.length} customers`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("revenue")
  .description("FieldRoutes revenue rollup")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .option("--by <dimension>", "service-type | route | tech", "service-type")
  .action(async (opts) => {
    const by = opts.by as RevenueDimension;
    if (!["service-type", "route", "tech"].includes(by)) {
      program.error("--by must be service-type, route, or tech");
    }
    try {
      const report = await revenueReport(makeFieldRoutesClient(), by, requireRange(opts));
      console.log(formatRevenue(report));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("audit-sync")
  .description("Compare FieldRoutes payments against QBO transactions: did the native sync post?")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .option("--json", "output raw JSON instead of the formatted report")
  .action(async (opts) => {
    try {
      const report = await auditSync(makeFieldRoutesClient(), makeQboClient(), requireRange(opts));
      console.log(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv);
