// Run this once: `npm run login`
// Scans a QR code with your Zalo mobile app, then saves the session
// (cookies + IMEI + user agent) to data/session.json so future runs
// don't need a fresh QR scan.
//
// IMPORTANT: data/session.json is as sensitive as a password to this
// Zalo account. Never commit it, never share it. Delete it and re-run
// this script if you ever suspect it leaked.

import { Zalo } from "zca-js";
import fs from "node:fs";
import path from "node:path";

const SESSION_PATH = path.resolve("data/session.json");

async function main() {
  const zalo = new Zalo();

  console.log("Opening QR login. Scan it with the Zalo app on the phone");
  console.log("that owns the account co-managing your two groups.\n");

  const api = await zalo.loginQR();

  const context = api.getContext();
  const sessionData = {
    cookie: context.cookie.toJSON ? context.cookie.toJSON() : context.cookie,
    imei: context.imei,
    userAgent: context.userAgent,
  };

  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(sessionData, null, 2));

  console.log(`\nLogin successful. Session saved to ${SESSION_PATH}`);
  console.log("Next: run `npm run inspect` to find your two group IDs and");
  console.log("confirm the exact shape of a 'member joined' event.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Login failed:", err);
  process.exit(1);
});
