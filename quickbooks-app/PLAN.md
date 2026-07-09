# Pest Control Ops Companion — Project Plan

A plan for building an app that (1) fills the gaps in the Intuit QuickBooks MCP server —
letting you make changes to QuickBooks Online (QBO) that the MCP can't do today — and
(2) connects **FieldRoutes** (your pest control field service platform) so Claude can
work across both systems: sales/revenue reporting, reconciliation, and syncing
FieldRoutes activity into your books.

## 1. Why this app

The Intuit QuickBooks MCP already handles a lot, so the app should **not** duplicate it.

**What the MCP already covers (don't rebuild):**

- Reports: P&L, cash flow, balance sheet, A/R & A/P aging (summary + detail), sales by customer/product, product list
- Sales: create / update / delete / duplicate / send **invoices** and **estimates**, payment links, sales settings
- Contacts & catalog: create + search **customers** and **products/services** (create only — no update/delete)
- Payroll: employee reads/creates/updates, contracts, payslips, pay types
- Transaction import (CSV), company profile info, benchmarking

**What the MCP cannot do (the app's job):**

| Area | Missing operations |
|---|---|
| Vendors & A/P | Create/update vendors, enter **bills**, record **bill payments** |
| Expenses | Purchases (checks, credit-card charges, cash expenses) |
| Accounting | **Journal entries**, chart of accounts CRUD, transfers, deposits |
| Sales (gaps) | Sales receipts, credit memos, refund receipts, recording customer payments directly |
| Entity maintenance | **Update/delete customers, products, vendors** (MCP is create-only) |
| Org structure | Classes, locations/departments, payment terms, tax codes |
| Misc | Attachments on transactions, time activities, batch operations, webhooks |

All of these are available in the **QuickBooks Online Accounting API** (REST, OAuth 2.0),
which is what this app will talk to directly.

## 1b. The FieldRoutes side

FieldRoutes (formerly PestRoutes) has an open REST API, documented at
https://fieldroutes.dev/documentation (plus a per-office Swagger UI inside your own
FieldRoutes instance).

**API basics:**

- Base URL: `https://{your-subdomain}.fieldroutes.com/api/`
- Auth: an `authenticationKey` + `authenticationToken` pair, generated for an API user
  in FieldRoutes settings — no OAuth dance, much simpler than the QBO side.
- Entities: **customer, subscription, appointment, ticket** (FieldRoutes' term for an
  invoice), **payment, appliedPayment, route, spot, serviceType, employee, office**, and
  more. Most support `search` / `get` / `create` / `update`. Search returns matching IDs;
  `get` hydrates them in batches — the client layer should hide that two-step pattern.

**What this unlocks (the sales/revenue tie-in):**

1. **Cross-system reporting through Claude** — "revenue by service type last month,"
   "production per tech/route," "which subscriptions churned," with FieldRoutes as the
   source of operational truth and QBO as the source of financial truth.
2. **Reconciliation** — compare FieldRoutes tickets/payments against QBO deposits and
   income, and flag mismatches (the classic end-of-month pain).
3. **Detail-level sync into QBO** — push FieldRoutes revenue into QBO the way *you* want
   it broken out (by service type, branch, class), not just one lump.
4. **Customer alignment** — match FieldRoutes customers to QBO customers, spot dupes.

**Important — FieldRoutes' native QBO sync already exists.** FieldRoutes ships a
built-in QuickBooks Online integration that posts aggregated payment/journal-entry
summaries. Decision to make: keep the native sync for posting and use this app for
*reporting + reconciliation only* (recommended starting point — zero risk of
double-counting revenue), or replace it with our own detail-level sync later. Never run
both writing revenue at the same time.

## 2. Recommended architecture

Build the app as a **custom MCP server + thin CLI**, in **TypeScript/Node**, in a new repo
(suggested name: `pestops-companion` — it's more than QuickBooks now).

Why this shape:

1. **Custom MCP server** — you already work through Claude with the Intuit MCP. A second,
   self-hosted MCP server that exposes the missing operations means you keep one workflow
   (talk to Claude, Claude calls tools) instead of context-switching to a separate UI.
   The two MCP servers coexist: Intuit's for what it does well, yours for the gaps —
   and yours is also the only place FieldRoutes and QBO data meet, which is what makes
   the cross-system tools (reconciliation, revenue breakdowns) possible.
2. **CLI on the same core** — the same service layer gets a command-line entry point
   (`qbc bill create ...`, `qbc vendor list`) so you can script things and test without Claude.
3. **TypeScript** — official `intuit-oauth` library for auth, `@modelcontextprotocol/sdk`
   for the MCP server, and typed models for QBO entities catch payload mistakes early.
   (Python + `python-quickbooks` is a fine alternative if you prefer; see Open Questions.)

```
pestops-companion/
├── src/
│   ├── auth/            # QBO OAuth2 flow, token storage & refresh
│   │   ├── oauth.ts     # authorize URL, callback handler, token exchange
│   │   └── tokens.ts    # encrypted token store on disk (never committed)
│   ├── qbo/             # QBO API client layer
│   │   ├── client.ts    # base REST client: baseURL, retries, rate limiting, minorversion
│   │   ├── query.ts     # QBO SQL-ish query builder ("select * from Bill where ...")
│   │   └── entities/    # one module per entity: vendor, bill, billPayment,
│   │                    #   purchase, journalEntry, account, deposit, transfer,
│   │                    #   salesReceipt, creditMemo, payment, customer, item, ...
│   ├── fieldroutes/     # FieldRoutes API client layer
│   │   ├── client.ts    # key/token auth, search→get hydration, rate limiting
│   │   └── entities/    # customer, subscription, appointment, ticket, payment,
│   │                    #   serviceType, route, employee, ...
│   ├── bridge/          # cross-system logic: reconciliation, revenue rollups,
│   │                    #   customer matching, (later) detail-level sync to QBO
│   ├── mcp/             # MCP server exposing entity + bridge ops as tools
│   │   └── server.ts
│   ├── cli/             # commander-based CLI over the same modules
│   │   └── index.ts
│   └── safety/          # dry-run, confirmation, audit log (see §5)
├── test/                # unit tests + sandbox integration tests
├── .env.example         # QBO_CLIENT_ID/SECRET/REALM_ID/ENVIRONMENT,
│                        # FR_SUBDOMAIN, FR_AUTH_KEY, FR_AUTH_TOKEN
├── package.json
└── README.md
```

## 3. Prerequisites (one-time setup, ~30 min)

1. **Intuit developer account** — sign up at https://developer.intuit.com with the same
   Intuit login you use for QuickBooks.
2. **Create an app** in the developer dashboard → gets you a Client ID + Client Secret.
   Scope needed: `com.intuit.quickbooks.accounting`.
3. **Sandbox company** — the dev dashboard gives you a free sandbox QBO company with
   demo data. All development and testing happens here; your real books are untouched
   until you deliberately connect production keys.
4. **Redirect URI** — register `http://localhost:8000/callback` for the local OAuth flow.
5. **FieldRoutes API credentials** — in FieldRoutes, generate an `authenticationKey` +
   `authenticationToken` for an API user (Settings → API, or ask FieldRoutes support to
   enable API access on your account). Note your subdomain
   (`https://{subdomain}.fieldroutes.com`). FieldRoutes has no sandbox — the client
   layer starts read-only there (see §5).

## 4. Implementation phases

### Phase 0 — Repo + skeleton (small)
- Create the `quickbooks-companion` GitHub repo.
- TypeScript project scaffold, lint/test config, `.env.example`, `.gitignore`
  (tokens and `.env` must never be committed).

### Phase 1 — Auth + client foundation
- OAuth2 authorization-code flow with a tiny local callback server
  (`npm run connect` opens the browser, captures the code, stores tokens).
- Token store with automatic refresh (access tokens last 1 hour, refresh tokens ~100 days).
- Base REST client: realm-scoped URLs, `minorversion` pinning, 401→refresh→retry,
  429/500 backoff, and QBO's fault-object error parsing surfaced as readable messages.
- **Milestone:** `qbc company info` prints your sandbox company name.

### Phase 2 — Read/query layer
- Generic query tool: run any QBO query (`select * from Bill where TxnDate > '2026-01-01'`)
  with pagination.
- Typed list/get for the entities we'll write to (vendor, account, bill, purchase, etc.) —
  reads come first because every write needs reference IDs (vendor refs, account refs).
- **Milestone:** list vendors, chart of accounts, and open bills from the sandbox.

### Phase 3 — Write operations, in priority order
1. **Vendors**: create, update, deactivate
2. **Bills + bill payments**: enter a bill, pay it (check/CC), void
3. **Expenses/Purchases**: checks, credit-card charges, cash
4. **Journal entries**: create, update, delete (with balanced-lines validation client-side)
5. **Chart of accounts**: create, update, deactivate accounts
6. **Deposits & transfers**
7. **Customer/product updates** (the MCP can only create)
8. **Sales receipts, credit memos, received payments**

Each entity module ships with: create/update/delete functions, an MCP tool definition,
a CLI subcommand, and sandbox tests. Ship 1–2 entities at a time — the app is useful
from the first one.

### Phase 4 — FieldRoutes client (read-only)
- Key/token auth client with the search→get hydration pattern and rate-limit handling.
- Read modules for: customers, subscriptions, appointments, tickets, payments,
  service types, routes, employees.
- **Milestone:** "show me completed appointments and ticket revenue for last week,
  by service type" answered entirely from FieldRoutes data.

### Phase 5 — Bridge: revenue reporting + reconciliation
- Revenue rollups from FieldRoutes tickets/payments (by service type, tech, route, month).
- Reconciliation report: FieldRoutes payments vs QBO deposits/income for a date range,
  with a mismatch list — this is the "tie FieldRoutes into QuickBooks" core.
- Customer matching report (FieldRoutes ↔ QBO customers, fuzzy match on name/email/phone).
- **Milestone:** month-end close where Claude tells you exactly what's out of balance
  between the two systems and why.

### Phase 6 — MCP server
- Wrap the QBO, FieldRoutes, and bridge operations as MCP tools with clear descriptions
  and JSON-schema inputs.
- Register it in your Claude config alongside the Intuit MCP.
- **Milestones:** "enter a $500 bill from Acme Supplies due July 30" lands in the QBO
  sandbox; "how did each route do last month, and does it match what's in QuickBooks?"
  gets a real answer.

### Phase 7 — Production cutover + niceties
- Connect QBO production credentials (separate `.env`, explicit `ENVIRONMENT=production` gate).
- Decide the revenue-sync question (§1b): keep FieldRoutes' native QBO sync, or replace
  it with detail-level posting from the bridge (only after reconciliation has been
  trustworthy for a while).
- Optional: FieldRoutes write operations (create/update customers, notes, appointments),
  QBO webhooks listener, attachments upload, batch endpoints, scheduled reconciliation
  reports.

## 5. Safety design (important — this app writes to your books)

- **Sandbox-first**: QBO environment is explicit config; production requires a separate flag.
- **FieldRoutes is read-only until Phase 7**: FieldRoutes has no sandbox, so the client
  ships with writes disabled behind a config flag. Reporting and reconciliation only
  need reads anyway.
- **One revenue writer at a time**: never enable bridge→QBO revenue posting while
  FieldRoutes' native QBO sync is on — that's how revenue gets double-counted.
- **Dry-run mode**: every write tool accepts `dryRun` and returns the exact payload it
  *would* send. In production, dry-run is the default; the real write requires `confirm: true`.
- **Audit log**: every write appends `{timestamp, entity, operation, payload, QBO response, txn id}`
  to a local JSONL file — your undo trail.
- **Soft deletes**: prefer QBO's deactivate/void over hard delete wherever the API allows.
- **SyncToken handling**: QBO requires the current SyncToken for updates (optimistic locking).
  The client always fetches fresh before updating and surfaces conflicts instead of clobbering.
- **Secrets hygiene**: tokens + client secret live in `.env` / OS keychain, git-ignored,
  with `.env.example` documenting shape only.

## 6. Effort estimate

| Phase | Rough size |
|---|---|
| 0 — Skeleton | ~1 session |
| 1 — QBO auth + client | 1–2 sessions |
| 2 — QBO read/query | 1 session |
| 3 — QBO writes (per entity group) | ~0.5–1 session each |
| 4 — FieldRoutes client (read-only) | 1–2 sessions |
| 5 — Bridge: reporting + reconciliation | 1–2 sessions |
| 6 — MCP server | 1 session |
| 7 — Production + extras | as needed |

Useful from Phase 2 onward; first "the MCP couldn't do this" win (bills + vendors) lands
early in Phase 3; the FieldRoutes revenue tie-in lands in Phases 4–5. If the FieldRoutes
tie-in matters more to you than QBO expense entry, Phases 4–5 can run before Phase 3 —
they only depend on Phases 0–2.

## 7. Open questions

1. **Language**: TypeScript recommended above; Python (`python-quickbooks` + FastMCP) is
   equally viable if that's your comfort zone.
2. **Interface priority**: MCP-first (recommended, keeps the Claude workflow) vs CLI-first
   vs adding a small web UI later.
3. **Write priority order**: §4 Phase 3 guesses bills/vendors matter most — reorder to
   match what you actually hit walls on. Also: QBO-writes-first vs FieldRoutes-first (see §6).
4. ~~QuickBooks edition~~ — confirmed QuickBooks Online.
5. **FieldRoutes native QBO sync**: is it currently on, and what does it post? Determines
   the reconciliation baseline and whether detail-level sync is worth building (§1b).
6. **FieldRoutes API access**: confirm API credentials can be generated on your
   FieldRoutes plan (some plans require asking support to enable it).

## 8. Key references

- QBO Accounting API reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account
- OAuth 2.0 guide: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- API Explorer (try calls in-browser): https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- intuit-oauth (Node): https://github.com/intuit/oauth-jsclient
- FieldRoutes API docs: https://fieldroutes.dev/documentation
- FieldRoutes per-office Swagger UI: `https://{subdomain}.fieldroutes.com/api/documentation/swagger`
  (requires your authenticationKey/Token)
- FieldRoutes API & integrations overview: https://www.fieldroutes.com/operations-suite/api-integrations
