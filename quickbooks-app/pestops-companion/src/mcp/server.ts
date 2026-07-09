import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { makeFieldRoutesClient, makeQboClient } from "../clients.js";
import { companyInfo, queryAll } from "../qbo/query.js";
import { fr, type DateRange } from "../fieldroutes/entities.js";
import { auditSync, formatReport } from "../bridge/auditSync.js";
import { formatRevenue, revenueReport } from "../bridge/revenue.js";

const server = new McpServer({ name: "pestops-companion", version: "0.1.0" });

const dateShape = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End date YYYY-MM-DD"),
};

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function errorText(err: unknown) {
  return {
    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

server.tool(
  "qbo_company_info",
  "Get the connected QuickBooks Online company name and environment (verifies the QBO connection works).",
  {},
  async () => {
    try {
      const info = await companyInfo(makeQboClient());
      return text(JSON.stringify(info, null, 2));
    } catch (err) {
      return errorText(err);
    }
  },
);

server.tool(
  "qbo_query",
  "Run a QuickBooks Online query (QBO's SQL-like dialect) and return all matching rows as JSON. " +
    "Example: SELECT * FROM Deposit WHERE TxnDate >= '2026-06-01'. Read-only. " +
    "Entities include Deposit, JournalEntry, Payment, SalesReceipt, Invoice, Bill, Vendor, Account, Customer.",
  { query: z.string().describe("QBO query string (no STARTPOSITION/MAXRESULTS — pagination is automatic)") },
  async ({ query }) => {
    try {
      const rows = await queryAll(makeQboClient(), query);
      return text(JSON.stringify(rows, null, 2));
    } catch (err) {
      return errorText(err);
    }
  },
);

server.tool(
  "fieldroutes_list",
  "List FieldRoutes records in a date range. Read-only. " +
    "'tickets' are FieldRoutes invoices; 'payments' are customer payments collected.",
  {
    entity: z.enum(["tickets", "payments", "appointments", "customers", "serviceTypes", "employees"]),
    ...dateShape,
  },
  async ({ entity, from, to }) => {
    try {
      const client = makeFieldRoutesClient();
      const range: DateRange = { from, to };
      const records =
        entity === "tickets" ? await fr.tickets(client, range)
        : entity === "payments" ? await fr.payments(client, range)
        : entity === "appointments" ? await fr.appointments(client, range)
        : entity === "customers" ? await fr.customers(client)
        : entity === "serviceTypes" ? await fr.serviceTypes(client)
        : await fr.employees(client);
      return text(JSON.stringify(records, null, 2));
    } catch (err) {
      return errorText(err);
    }
  },
);

server.tool(
  "revenue_report",
  "FieldRoutes revenue rollup for a date range, grouped by service-type, route, or tech. " +
    "Source of truth is FieldRoutes tickets (invoices).",
  {
    by: z.enum(["service-type", "route", "tech"]).default("service-type"),
    ...dateShape,
  },
  async ({ by, from, to }) => {
    try {
      const report = await revenueReport(makeFieldRoutesClient(), by, { from, to });
      return text(formatRevenue(report) + "\n\n" + JSON.stringify(report, null, 2));
    } catch (err) {
      return errorText(err);
    }
  },
);

server.tool(
  "audit_sync",
  "Audit whether FieldRoutes' native QuickBooks sync is actually posting: compares successful " +
    "FieldRoutes payments (bucketed by day) against QBO deposits/journal entries/sales receipts/payments " +
    "in the same range, and reports matched vs unmatched days with a verdict.",
  { ...dateShape },
  async ({ from, to }) => {
    try {
      const report = await auditSync(makeFieldRoutesClient(), makeQboClient(), { from, to });
      return text(formatReport(report) + "\n\n" + JSON.stringify(report, null, 2));
    } catch (err) {
      return errorText(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("pestops-companion MCP server running on stdio");
