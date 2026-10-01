// Run this once after `npm run login`: `npm run inspect`
//
// Why this script exists: zca-js is an unofficial, reverse-engineered
// library that changes between versions. Rather than guessing at the
// exact event name / payload shape for "a member joined the group" and
// shipping you code that might silently never fire, this script prints
// every event zca-js emits in real time. You:
//   1. Run this script and leave it running.
//   2. Have a test account join (or leave/get added to) one of your
//      two groups.
//   3. Watch the console — copy the event name and payload shape you
//      see for the join case.
//   4. Paste that into src/bot.js where marked TODO.
// This also prints your group IDs (group names -> IDs), which you need
// for config.json.

import { Zalo, ThreadType } from "zca-js";
import fs from "node:fs";
import path from "node:path";

const SESSION_PATH = path.resolve("data/session.json");

async function main() {
  if (!fs.existsSync(SESSION_PATH)) {
    console.error("No saved session found. Run `npm run login` first.");
    process.exit(1);
  }

  const session = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
  const zalo = new Zalo();
  const api = await zalo.login({
    cookie: session.cookie,
    imei: session.imei,
    userAgent: session.userAgent,
  });

  console.log("Logged in. Fetching your groups...\n");

  try {
    const allGroups = await api.getAllGroups();
    const groupIds = Object.keys(allGroups?.gridVerMap ?? allGroups ?? {});
    if (groupIds.length) {
      const info = await api.getGroupInfo(groupIds);
      const groups = info?.gridInfoMap ?? info ?? {};
      console.log("=== Your groups (name -> ID) ===");
      for (const id of groupIds) {
        const g = groups[id];
        console.log(`${g?.name ?? "(unknown name)"}  ->  ${id}`);
      }
      console.log("\nCopy the IDs for your two GTH groups into config.json.\n");
    } else {
      console.log("Could not list groups automatically — that's fine, the");
      console.log("event log below will still show group IDs as members");
      console.log("join/leave/message.\n");
    }
  } catch (err) {
    console.log("Group listing failed (non-fatal):", err.message);
  }

  console.log("=== Listening for ALL events. Leave this running and ===");
  console.log("=== trigger a join/leave in one of your groups now.   ===\n");

  // Log every event the listener's underlying emitter fires, whatever
  // it's called on your installed version.
  const emitter = api.listener;
  const originalEmit = emitter.emit.bind(emitter);
  emitter.emit = (eventName, ...args) => {
    console.log(`\n[event: ${eventName}]`);
    console.dir(args, { depth: 6 });
    return originalEmit(eventName, ...args);
  };

  // Also attach the documented "message" listener so you can see
  // regular messages flow too, with thread type resolved.
  emitter.on("message", (message) => {
    const kind = message.type === ThreadType.Group ? "GROUP" : "USER";
    console.log(`[message | ${kind} | thread ${message.threadId}]`, message.data?.content);
  });

  emitter.start();
}

main().catch((err) => {
  console.error("Inspect script failed:", err);
  process.exit(1);
});
