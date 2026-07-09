import { describe, expect, it, vi } from "vitest";
import { QboClient } from "../src/qbo/client.js";
import { queryAll } from "../src/qbo/query.js";
import type { StoredTokens } from "../src/auth/tokens.js";
import type { QboConfig } from "../src/config.js";

const config: QboConfig = {
  clientId: "id",
  clientSecret: "secret",
  redirectUri: "http://localhost:8000/callback",
  environment: "sandbox",
  realmId: "123",
};

function freshTokens(): StoredTokens {
  return {
    accessToken: "at-1",
    refreshToken: "rt-1",
    accessTokenExpiresAt: Date.now() + 3600_000,
    refreshTokenExpiresAt: Date.now() + 86_400_000,
    realmId: "123",
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("QboClient", () => {
  it("hits the realm-scoped URL with minorversion and bearer token", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const client = new QboClient(config, freshTokens(), { fetchImpl });
    await client.get("companyinfo/123");

    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("sandbox-quickbooks.api.intuit.com/v3/company/123/companyinfo/123");
    expect(url).toContain("minorversion=75");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ ok: true }));
    const refresh = vi.fn(async (_c: QboConfig, t: StoredTokens) => ({
      ...t,
      accessToken: "at-2",
    }));
    const client = new QboClient(config, freshTokens(), { fetchImpl, refresh });

    await client.get("companyinfo/123");

    expect(refresh).toHaveBeenCalledTimes(1);
    const [, secondInit] = fetchImpl.mock.calls[1]! as [string, RequestInit];
    expect((secondInit.headers as Record<string, string>).Authorization).toBe("Bearer at-2");
  });

  it("refreshes proactively when the access token is stale", async () => {
    const stale = { ...freshTokens(), accessTokenExpiresAt: Date.now() - 1000 };
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const refresh = vi.fn(async (_c: QboConfig, t: StoredTokens) => ({
      ...t,
      accessToken: "at-2",
      accessTokenExpiresAt: Date.now() + 3600_000,
    }));
    const client = new QboClient(config, stale, { fetchImpl, refresh });

    await client.get("companyinfo/123");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("throws a readable error when the refresh token is dead", async () => {
    const dead = { ...freshTokens(), refreshTokenExpiresAt: Date.now() - 1000 };
    const client = new QboClient(config, dead, { fetchImpl: vi.fn() });
    await expect(client.get("companyinfo/123")).rejects.toThrow(/npm run connect/);
  });

  it("surfaces QBO fault objects as readable errors", async () => {
    const fault = {
      Fault: { Error: [{ Message: "Invalid query", Detail: "Bad FROM clause", code: "4000" }] },
    };
    const fetchImpl = vi.fn(async () => json(fault, 400));
    const client = new QboClient(config, freshTokens(), { fetchImpl });
    await expect(client.get("query")).rejects.toThrow(/QBO error 4000: Invalid query/);
  });
});

describe("queryAll", () => {
  it("follows STARTPOSITION pagination until a short page", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ Id: String(i) }));
    const page2 = [{ Id: "1000" }, { Id: "1001" }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ QueryResponse: { Deposit: page1 } }))
      .mockResolvedValueOnce(json({ QueryResponse: { Deposit: page2 } }));
    const client = new QboClient(config, freshTokens(), { fetchImpl });

    const rows = await queryAll(client, "SELECT * FROM Deposit");

    expect(rows).toHaveLength(1002);
    const decode = (u: unknown) => decodeURIComponent(String(u)).replaceAll("+", " ");
    const firstUrl = decode(fetchImpl.mock.calls[0]![0]);
    const secondUrl = decode(fetchImpl.mock.calls[1]![0]);
    expect(firstUrl).toContain("STARTPOSITION 1");
    expect(secondUrl).toContain("STARTPOSITION 1001");
  });

  it("returns [] for an empty QueryResponse", async () => {
    const fetchImpl = vi.fn(async () => json({ QueryResponse: {} }));
    const client = new QboClient(config, freshTokens(), { fetchImpl });
    expect(await queryAll(client, "SELECT * FROM Deposit")).toEqual([]);
  });

  it("rejects queries that hand-roll pagination", async () => {
    const client = new QboClient(config, freshTokens(), { fetchImpl: vi.fn() });
    await expect(queryAll(client, "SELECT * FROM Bill MAXRESULTS 5")).rejects.toThrow(
      /pagination/,
    );
  });
});
