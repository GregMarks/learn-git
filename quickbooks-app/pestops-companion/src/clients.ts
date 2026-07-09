import { fieldRoutesConfig, qboConfig } from "./config.js";
import { requireTokens } from "./auth/oauth.js";
import { QboClient } from "./qbo/client.js";
import { FieldRoutesClient } from "./fieldroutes/client.js";

export function makeQboClient(): QboClient {
  return new QboClient(qboConfig(), requireTokens());
}

export function makeFieldRoutesClient(): FieldRoutesClient {
  return new FieldRoutesClient(fieldRoutesConfig());
}
