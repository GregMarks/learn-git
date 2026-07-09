import fs from "node:fs";
import { TOKEN_FILE } from "../config.js";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  accessTokenExpiresAt: number;
  /** Epoch ms when the refresh token expires (~100 days from issue). */
  refreshTokenExpiresAt: number;
  realmId: string;
}

export function loadTokens(file: string = TOKEN_FILE): StoredTokens | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as StoredTokens;
}

export function saveTokens(tokens: StoredTokens, file: string = TOKEN_FILE): void {
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2) + "\n", { mode: 0o600 });
}

/** True when the access token expires within the next 60 seconds. */
export function accessTokenStale(tokens: StoredTokens, now: number = Date.now()): boolean {
  return now >= tokens.accessTokenExpiresAt - 60_000;
}

export function refreshTokenExpired(tokens: StoredTokens, now: number = Date.now()): boolean {
  return now >= tokens.refreshTokenExpiresAt;
}
