# QuickBooks Companion App — Project Plan

A plan for building an app that fills the gaps in the Intuit QuickBooks MCP server —
letting you make changes to QuickBooks Online (QBO) that the MCP can't do today.

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

## 2. Recommended architecture

Build the app as a **custom MCP server + thin CLI**, in **TypeScript/Node**, in a new repo
(suggested name: `quickbooks-companion`).

Why this shape:

1. **Custom MCP server** — you already work through Claude with the Intuit MCP. A second,
   self-hosted MCP server that exposes the missing operations means you keep one workflow
   (talk to Claude, Claude calls tools) instead of context-switching to a separate UI.
   The two MCP servers coexist: Intuit's for what it does well, yours for the gaps.
2. **CLI on the same core** — the same service layer gets a command-line entry point
   (`qbc bill create ...`, `qbc vendor list`) so you can script things and test without Claude.
3. **TypeScript** — official `intuit-oauth` library for auth, `@modelcontextprotocol/sdk`
   for the MCP server, and typed models for QBO entities catch payload mistakes early.
   (Python + `python-quickbooks` is a fine alternative if you prefer; see Open Questions.)

```
quickbooks-companion/
├── src/
│   ├── auth/            # OAuth2 flow, token storage & refresh
│   │   ├── oauth.ts     # authorize URL, callback handler, token exchange
│   │   └── tokens.ts    # encrypted token store on disk (never committed)
│   ├── qbo/             # QBO API client layer
│   │   ├── client.ts    # base REST client: baseURL, retries, rate limiting, minorversion
│   │   ├── query.ts     # QBO SQL-ish query builder ("select * from Bill where ...")
│   │   └── entities/    # one module per entity: vendor, bill, billPayment,
│   │                    #   purchase, journalEntry, account, deposit, transfer,
│   │                    #   salesReceipt, creditMemo, payment, customer, item, ...
│   ├── mcp/             # MCP server exposing the entity ops as tools
│   │   └── server.ts
│   ├── cli/             # commander-based CLI over the same entity modules
│   │   └── index.ts
│   └── safety/          # dry-run, confirmation, audit log (see §5)
├── test/                # unit tests + sandbox integration tests
├── .env.example         # CLIENT_ID, CLIENT_SECRET, REALM_ID, ENVIRONMENT (sandbox|production)
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

### Phase 4 — MCP server
- Wrap the entity operations as MCP tools with clear descriptions and JSON-schema inputs.
- Register it in your Claude config alongside the Intuit MCP.
- **Milestone:** ask Claude "enter a $500 bill from Acme Supplies due July 30" and it
  lands in the sandbox via your server.

### Phase 5 — Production cutover + niceties
- Connect production credentials (separate `.env`, explicit `ENVIRONMENT=production` gate).
- Optional: webhooks listener for change notifications, attachments upload,
  batch endpoint for bulk edits, CSV import for bills/expenses.

## 5. Safety design (important — this app writes to your books)

- **Sandbox-first**: environment is explicit config; production requires a separate flag.
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
| 1 — Auth + client | 1–2 sessions |
| 2 — Read/query | 1 session |
| 3 — Writes (per entity group) | ~0.5–1 session each |
| 4 — MCP server | 1 session |
| 5 — Production + extras | as needed |

Useful from Phase 2 onward; first real "the MCP couldn't do this" win (bills + vendors)
lands early in Phase 3.

## 7. Open questions

1. **Language**: TypeScript recommended above; Python (`python-quickbooks` + FastMCP) is
   equally viable if that's your comfort zone.
2. **Interface priority**: MCP-first (recommended, keeps the Claude workflow) vs CLI-first
   vs adding a small web UI later.
3. **Write priority order**: §4 Phase 3 guesses bills/vendors matter most — reorder to
   match what you actually hit walls on.
4. **QuickBooks edition**: this plan assumes QuickBooks **Online**. QuickBooks Desktop
   uses a completely different SDK and would change everything.

## 8. Key references

- QBO Accounting API reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account
- OAuth 2.0 guide: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- API Explorer (try calls in-browser): https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- intuit-oauth (Node): https://github.com/intuit/oauth-jsclient
