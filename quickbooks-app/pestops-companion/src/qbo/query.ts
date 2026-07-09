import type { QboClient } from "./client.js";

const PAGE_SIZE = 1000;

interface QueryResponse {
  QueryResponse: Record<string, unknown> & {
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

/**
 * Run a QBO query (their SQL-ish dialect) and return all rows, following
 * STARTPOSITION pagination. The entity array key in the response matches the
 * entity name in the FROM clause (e.g. "Payment", "Deposit", "JournalEntry").
 */
export async function queryAll<T = Record<string, unknown>>(
  client: QboClient,
  query: string,
): Promise<T[]> {
  if (/\b(STARTPOSITION|MAXRESULTS)\b/i.test(query)) {
    throw new Error("Leave pagination to queryAll — remove STARTPOSITION/MAXRESULTS.");
  }
  const rows: T[] = [];
  for (let start = 1; ; start += PAGE_SIZE) {
    const paged = `${query} STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`;
    const res = await client.get<QueryResponse>("query", { query: paged });
    const qr = res.QueryResponse ?? {};
    const entityKey = Object.keys(qr).find((k) => Array.isArray(qr[k]));
    const page = entityKey ? (qr[entityKey] as T[]) : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export interface CompanyInfo {
  CompanyName: string;
  LegalName?: string;
  Country?: string;
  CompanyAddr?: { City?: string; CountrySubDivisionCode?: string };
}

export async function companyInfo(client: QboClient): Promise<CompanyInfo> {
  const res = await client.get<{ CompanyInfo: CompanyInfo }>(
    `companyinfo/${client.realmId}`,
  );
  return res.CompanyInfo;
}
