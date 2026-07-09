import { describe, expect, it, vi } from "vitest";
import { FieldRoutesClient, dateBetween } from "../src/fieldroutes/client.js";
import type { FieldRoutesConfig } from "../src/config.js";

const config: FieldRoutesConfig = { subdomain: "acme", authKey: "key", authToken: "token" };
const noSleep = async () => {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("FieldRoutesClient.searchAndGet", () => {
  it("searches, then hydrates records by ID, sending auth on every call", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ success: true, count: 2, ticketIDs: [11, 22] }))
      .mockResolvedValueOnce(
        json({ success: true, tickets: [{ ticketID: 11 }, { ticketID: 22 }] }),
      );
    const client = new FieldRoutesClient(config, { fetchImpl, sleep: noSleep });

    const rows = await client.searchAndGet("ticket", "ticketIDs", {
      dateCreated: dateBetween("2026-06-01", "2026-06-30"),
    });

    expect(rows).toEqual([{ ticketID: 11 }, { ticketID: 22 }]);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://acme.fieldroutes.com/api/ticket/search");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("https://acme.fieldroutes.com/api/ticket/get");

    for (const call of fetchImpl.mock.calls) {
      const body = String((call[1] as RequestInit).body);
      expect(body).toContain("authenticationKey=key");
      expect(body).toContain("authenticationToken=token");
    }
    // date filter is JSON-encoded into the form body
    expect(decodeURIComponent(String((fetchImpl.mock.calls[0]![1] as RequestInit).body))).toContain(
      '"operator":"BETWEEN"',
    );
  });

  it("uses propertyName when the response provides it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: true, propertyName: "customerIDs", customerIDs: [7] }),
      )
      .mockResolvedValueOnce(json({ success: true, customers: [{ customerID: 7 }] }));
    const client = new FieldRoutesClient(config, { fetchImpl, sleep: noSleep });

    const rows = await client.searchAndGet("customer", "customerIDs", {});
    expect(rows).toEqual([{ customerID: 7 }]);
  });

  it("returns [] without calling get when search finds nothing", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ success: true, ticketIDs: [] }));
    const client = new FieldRoutesClient(config, { fetchImpl, sleep: noSleep });

    expect(await client.searchAndGet("ticket", "ticketIDs", {})).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("hydrates in batches of 1000", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => i + 1);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ success: true, ticketIDs: ids }))
      .mockResolvedValueOnce(
        json({ success: true, tickets: ids.slice(0, 1000).map((ticketID) => ({ ticketID })) }),
      )
      .mockResolvedValueOnce(
        json({ success: true, tickets: ids.slice(1000).map((ticketID) => ({ ticketID })) }),
      );
    const client = new FieldRoutesClient(config, { fetchImpl, sleep: noSleep });

    const rows = await client.searchAndGet("ticket", "ticketIDs", {});
    expect(rows).toHaveLength(1500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws a readable error when FieldRoutes reports failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ success: false, errorMessage: "Invalid authentication" }));
    const client = new FieldRoutesClient(config, { fetchImpl, sleep: noSleep });

    await expect(client.searchAndGet("ticket", "ticketIDs", {})).rejects.toThrow(
      /Invalid authentication/,
    );
  });
});
