import type { FieldRoutesConfig } from "../config.js";

/**
 * FieldRoutes (formerly PestRoutes) API client — READ-ONLY by design.
 *
 * API shape (confirm details against your per-office Swagger at
 * https://{subdomain}.fieldroutes.com/api/documentation/swagger):
 *   - Endpoint per entity+action:  /api/{entity}/{action}   (search | get)
 *   - Auth: authenticationKey + authenticationToken sent with every request
 *   - search returns matching IDs (in a key like "customerIDs" or "ids"),
 *     get hydrates up to ~1000 records per call from a list of IDs
 */
const GET_BATCH_SIZE = 1000;
/** Small courtesy delay between consecutive API calls (rate-limit friendly). */
const CALL_SPACING_MS = 150;

export class FieldRoutesApiError extends Error {
  constructor(
    message: string,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "FieldRoutesApiError";
  }
}

type Json = Record<string, unknown>;

export interface FieldRoutesClientOptions {
  fetchImpl?: typeof fetch;
  /** Injectable for tests to skip pacing delays. */
  sleep?: (ms: number) => Promise<void>;
}

export class FieldRoutesClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastCallAt = 0;

  constructor(
    private readonly config: FieldRoutesConfig,
    options: FieldRoutesClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private baseUrl(): string {
    return `https://${this.config.subdomain}.fieldroutes.com/api`;
  }

  private async pace(): Promise<void> {
    const wait = this.lastCallAt + CALL_SPACING_MS - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCallAt = Date.now();
  }

  private async call(entity: string, action: "search" | "get", params: Json): Promise<Json> {
    await this.pace();
    const endpoint = `${this.baseUrl()}/${entity}/${action}`;
    const body = new URLSearchParams({
      authenticationKey: this.config.authKey,
      authenticationToken: this.config.authToken,
    });
    for (const [key, value] of Object.entries(params)) {
      body.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const res = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new FieldRoutesApiError(`HTTP ${res.status} from FieldRoutes`, endpoint);
    }
    const json = (await res.json()) as Json;
    if (json.success === false || json.success === "false") {
      throw new FieldRoutesApiError(
        `FieldRoutes error: ${String(json.errorMessage ?? JSON.stringify(json)).slice(0, 300)}`,
        endpoint,
      );
    }
    return json;
  }

  /** Extract the ID list from a search response ("customerIDs", "ticketIDs", "ids", ...). */
  private static idsFrom(response: Json): Array<string | number> {
    if (typeof response.propertyName === "string" && Array.isArray(response[response.propertyName])) {
      return response[response.propertyName] as Array<string | number>;
    }
    const key = Object.keys(response).find(
      (k) => /ids$/i.test(k) && Array.isArray(response[k]),
    );
    return key ? (response[key] as Array<string | number>) : [];
  }

  /**
   * search → get hydration in one call: search for matching IDs, then fetch
   * full records in batches. `idField` is the entity's ID parameter name for
   * the get action (e.g. "customerIDs").
   */
  async searchAndGet<T = Json>(entity: string, idField: string, searchParams: Json): Promise<T[]> {
    const searchRes = await this.call(entity, "search", searchParams);
    const ids = FieldRoutesClient.idsFrom(searchRes);
    if (ids.length === 0) return [];

    const records: T[] = [];
    for (let i = 0; i < ids.length; i += GET_BATCH_SIZE) {
      const batch = ids.slice(i, i + GET_BATCH_SIZE);
      const getRes = await this.call(entity, "get", { [idField]: batch });
      // get responses key hydrated records by the plural entity name
      const key = Object.keys(getRes).find(
        (k) => Array.isArray(getRes[k]) && k.toLowerCase() !== "ids" && !/ids$/i.test(k),
      );
      if (key) records.push(...(getRes[key] as T[]));
    }
    return records;
  }
}

/** FieldRoutes date-range search parameter: { operator: "BETWEEN", ... }. */
export function dateBetween(from: string, to: string): Json {
  return { operator: "BETWEEN", valueA: from, valueB: to };
}
