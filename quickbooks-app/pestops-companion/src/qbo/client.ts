import { qboApiBase, type QboConfig } from "../config.js";
import { accessTokenStale, refreshTokenExpired, type StoredTokens } from "../auth/tokens.js";
import { refreshTokens } from "../auth/oauth.js";

/** QBO API minor version — pinned so responses don't shift under us. */
const MINOR_VERSION = "75";
const MAX_RETRIES = 4;

export class QboApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "QboApiError";
  }
}

interface QboFault {
  Fault?: { Error?: Array<{ Message?: string; Detail?: string; code?: string }> };
}

function faultMessage(status: number, body: string): QboApiError {
  try {
    const parsed = JSON.parse(body) as QboFault;
    const first = parsed.Fault?.Error?.[0];
    if (first) {
      return new QboApiError(
        `QBO error ${first.code ?? status}: ${first.Message ?? "unknown"}`,
        status,
        first.Detail,
      );
    }
  } catch {
    // not JSON — fall through
  }
  return new QboApiError(`QBO request failed with HTTP ${status}`, status, body.slice(0, 500));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface QboClientOptions {
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to real token refresh. */
  refresh?: (config: QboConfig, tokens: StoredTokens) => Promise<StoredTokens>;
}

export class QboClient {
  private readonly fetchImpl: typeof fetch;
  private readonly refresh: (config: QboConfig, tokens: StoredTokens) => Promise<StoredTokens>;

  constructor(
    private readonly config: QboConfig,
    private tokens: StoredTokens,
    options: QboClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.refresh = options.refresh ?? refreshTokens;
  }

  get realmId(): string {
    return this.tokens.realmId;
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const url = new URL(
      `${qboApiBase(this.config.environment)}/v3/company/${this.tokens.realmId}/${path}`,
    );
    url.searchParams.set("minorversion", MINOR_VERSION);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async ensureFreshToken(): Promise<void> {
    if (refreshTokenExpired(this.tokens)) {
      throw new Error(
        'QuickBooks refresh token has expired (they last ~100 days). Run "npm run connect" again.',
      );
    }
    if (accessTokenStale(this.tokens)) {
      this.tokens = await this.refresh(this.config, this.tokens);
    }
  }

  async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    params: Record<string, string> = {},
  ): Promise<T> {
    await this.ensureFreshToken();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(this.url(path, params), {
        method,
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.ok) return (await res.json()) as T;

      // 401 once: token may have been revoked/rotated — refresh and retry.
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        this.tokens = await this.refresh(this.config, this.tokens);
        continue;
      }
      // Throttling / transient server errors: exponential backoff.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw faultMessage(res.status, await res.text());
    }
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    return this.request<T>("GET", path, undefined, params);
  }
}
