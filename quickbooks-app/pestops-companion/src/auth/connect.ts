import { qboConfig } from "../config.js";
import { connect } from "./oauth.js";

connect(qboConfig()).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
