import http from "node:http";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import type { QboConfig } from "../config.js";
import { loadTokens, saveTokens, type StoredTokens } from "./tokens.js";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

function basicAuth(config: QboConfig): string {
  return "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

function toStored(body: TokenResponse, realmId: string, now: number = Date.now()): StoredTokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accessTokenExpiresAt: now + body.expires_in * 1000,
    refreshTokenExpiresAt: now + body.x_refresh_token_expires_in * 1000,
    realmId,
  };
}

async function exchange(
  config: QboConfig,
  params: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`Intuit token endpoint returned ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshTokens(
  config: QboConfig,
  tokens: StoredTokens,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredTokens> {
  const body = await exchange(
    config,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
    fetchImpl,
  );
  const updated = toStored(body, tokens.realmId);
  saveTokens(updated);
  return updated;
}

export function authorizeUrl(config: QboConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Interactive connect flow: prints the authorize URL, waits for Intuit to
 * redirect the browser to the local callback, exchanges the code, and saves
 * tokens (including the realmId QBO hands back on the redirect).
 */
export async function connect(config: QboConfig): Promise<StoredTokens> {
  const state = crypto.randomBytes(16).toString("hex");
  const callback = new URL(config.redirectUri);
  const port = Number(callback.port || 80);

  console.log("\nOpen this URL in your browser and authorize the app:\n");
  console.log(`  ${authorizeUrl(config, state)}\n`);
  console.log(`Waiting for Intuit to redirect to ${config.redirectUri} ...`);

  const { code, realmId } = await new Promise<{ code: string; realmId: string }>(
    (resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (url.pathname !== callback.pathname) {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get("error");
        const gotState = url.searchParams.get("state");
        const gotCode = url.searchParams.get("code");
        const gotRealm = url.searchParams.get("realmId");
        if (err || !gotCode || !gotRealm || gotState !== state) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`Authorization failed: ${err ?? "missing code/realmId or bad state"}`);
          server.close();
          reject(new Error(`Authorization failed: ${err ?? "missing code/realmId or bad state"}`));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Connected. You can close this tab and return to the terminal.</h2>");
        server.close();
        resolve({ code: gotCode, realmId: gotRealm });
      });
      server.on("error", reject);
      server.listen(port);
    },
  );

  const body = await exchange(
    config,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  );
  const tokens = toStored(body, realmId);
  saveTokens(tokens);
  console.log(`\nConnected to QBO company (realm ${realmId}). Tokens saved to tokens.json.`);
  console.log(`Tip: set QBO_REALM_ID=${realmId} in your .env for reference.`);
  return tokens;
}

export function requireTokens(): StoredTokens {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('Not connected to QuickBooks yet. Run "npm run connect" first.');
  }
  return tokens;
}
