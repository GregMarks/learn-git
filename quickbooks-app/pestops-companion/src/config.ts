import "dotenv/config";
import path from "node:path";

export type QboEnvironment = "sandbox" | "production";

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
  realmId: string | undefined;
}

export interface FieldRoutesConfig {
  subdomain: string;
  authKey: string;
  authToken: string;
}

export const TOKEN_FILE = path.resolve(process.env.QBC_TOKEN_FILE ?? "tokens.json");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in (see README "Setup").`,
    );
  }
  return value;
}

export function qboConfig(): QboConfig {
  const environment = (process.env.QBO_ENVIRONMENT ?? "sandbox") as QboEnvironment;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(`QBO_ENVIRONMENT must be "sandbox" or "production", got "${environment}"`);
  }
  return {
    clientId: required("QBO_CLIENT_ID"),
    clientSecret: required("QBO_CLIENT_SECRET"),
    redirectUri: process.env.QBO_REDIRECT_URI ?? "http://localhost:8000/callback",
    environment,
    realmId: process.env.QBO_REALM_ID || undefined,
  };
}

export function fieldRoutesConfig(): FieldRoutesConfig {
  return {
    subdomain: required("FR_SUBDOMAIN"),
    authKey: required("FR_AUTH_KEY"),
    authToken: required("FR_AUTH_TOKEN"),
  };
}

export function qboApiBase(environment: QboEnvironment): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}
