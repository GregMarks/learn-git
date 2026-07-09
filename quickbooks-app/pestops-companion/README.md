# pestops-companion

QuickBooks Online + FieldRoutes companion for a pest control business.
Fills the gaps in the Intuit QuickBooks MCP and bridges FieldRoutes revenue
into your books: revenue reporting, and an **audit of whether FieldRoutes'
native QBO sync is actually posting anything**.

Everything in this version is **read-only** against both systems.

## What's here

- **CLI (`qbc`)** — query QBO, list FieldRoutes tickets/payments/customers,
  revenue rollups, sync audit.
- **MCP server** — the same capabilities as tools Claude can call, alongside
  the official Intuit QuickBooks MCP.

## Setup (~30 minutes, one time)

### 1. QuickBooks side

1. Sign up at [developer.intuit.com](https://developer.intuit.com) with your
   normal Intuit login.
2. Create an app (workspace → Create an app → QuickBooks Online and Payments),
   scope **Accounting**. Copy the **Client ID** and **Client Secret** from the
   Keys page. Start with the **Development** keys (sandbox).
3. On the app's Keys page, add redirect URI exactly: `http://localhost:8000/callback`
4. The dashboard gives you a free **sandbox company** — use it until you're
   comfortable, then switch `.env` to production keys for read-only auditing.

### 2. FieldRoutes side

Generate API credentials (an `authenticationKey` + `authenticationToken`) for
an API user in FieldRoutes, and note your subdomain
(`https://YOURSUBDOMAIN.fieldroutes.com`). If you don't see an API section in
settings, ask FieldRoutes support to enable API access.

### 3. Connect

```bash
npm install
cp .env.example .env    # fill in the values from steps 1–2
npm run connect         # opens Intuit auth; tokens saved to tokens.json
npm run qbc -- qbo company   # should print your company name
```

`tokens.json` and `.env` hold secrets and are git-ignored — never commit them.

## CLI usage

```bash
npm run qbc -- qbo company
npm run qbc -- qbo query "SELECT * FROM Deposit WHERE TxnDate >= '2026-06-01'"

npm run qbc -- fr tickets  --from 2026-06-01 --to 2026-06-30
npm run qbc -- fr payments --from 2026-06-01 --to 2026-06-30
npm run qbc -- fr customers

npm run qbc -- revenue --by service-type --from 2026-06-01 --to 2026-06-30
npm run qbc -- revenue --by route --from 2026-06-01 --to 2026-06-30

# The big one: is the native FieldRoutes→QBO sync actually posting?
npm run qbc -- audit-sync --from 2026-06-01 --to 2026-06-30
```

`audit-sync` buckets successful FieldRoutes payments by day and looks for QBO
transactions (deposits, journal entries, sales receipts, payments) matching
each day's total within ±3 days. It prints a per-day match table and a verdict.

## MCP server (use it from Claude)

Add to your Claude MCP config (e.g. `claude mcp add` or your client's config
file), pointing at this repo:

```json
{
  "mcpServers": {
    "pestops": {
      "command": "npx",
      "args": ["tsx", "/path/to/pestops-companion/src/mcp/server.ts"],
      "cwd": "/path/to/pestops-companion"
    }
  }
}
```

Tools exposed: `qbo_company_info`, `qbo_query`, `fieldroutes_list`,
`revenue_report`, `audit_sync`. All read-only.

## Development

```bash
npm run typecheck
npm test
```

Tests run against mocked HTTP — no credentials needed.

### A note on FieldRoutes field names

FieldRoutes' docs block automated access, so entity field names in
`src/fieldroutes/entities.ts` follow the documented PestRoutes API shape.
If a field looks off during live testing, check your office's Swagger:
`https://YOURSUBDOMAIN.fieldroutes.com/api/documentation/swagger`
(append your `authenticationKey`/`authenticationToken` as query params).

## Roadmap

The full multi-phase plan (QBO write gaps: vendors, bills, journal entries;
customer matching; optional detail-level sync replacing the native one) lives
in the `learn-git` repo at `quickbooks-app/PLAN.md`.
