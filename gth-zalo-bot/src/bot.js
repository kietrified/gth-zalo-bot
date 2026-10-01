import { Zalo, ThreadType } from "zca-js";
import fs from "node:fs";
import path from "node:path";
import { pollGroupForNewMembers } from "./membership.js";
import { startReminderScheduler, logUpcomingOccurrences } from "./reminders.js";
import * as store from "./store.js";

const SESSION_PATH = path.resolve("data/session.json");

// ---- simple rolling-hour rate limiter (safety valve, not decoration) ----
const sentTimestamps = [];
function canSendMore() {
  const now = Date.now();
  const cap = store.getConfig().maxRepliesPerHour ?? 20;
  while (sentTimestamps.length && now - sentTimestamps[0] > 60 * 60 * 1000) {
    sentTimestamps.shift();
  }
  return sentTimestamps.length < cap;
}
function recordSend() {
  sentTimestamps.push(Date.now());
}

function randomDelay() {
  const [min, max] = store.getConfig().replyDelayMsRange ?? [4000, 15000];
  return min + Math.random() * (max - min);
}

function findKeywordReply(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const rule of store.getConfig().keywordReplies || []) {
    if (rule.enabled === false) continue;
    if (rule.triggers.some((t) => lower.includes(t.toLowerCase()))) {
      return rule.reply;
    }
  }
  return null;
}

async function sendWithDelay(api, text, threadId, threadType) {
  if (!canSendMore()) {
    console.log(`[rate-limit] Skipped a reply to ${threadId} — hourly cap reached.`);
    return;
  }
  const delay = randomDelay();
  console.log(`[queued] Reply to ${threadId} in ${Math.round(delay / 1000)}s`);
  await new Promise((r) => setTimeout(r, delay));
  await api.sendMessage({ msg: text }, threadId, threadType);
  recordSend();
  console.log(`[sent] -> ${threadId}: ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`);
}

// ---- separate rate limiter/sender for scheduled reminders ----
const reminderTimestamps = [];
function canSendReminderMore() {
  const now = Date.now();
  const cap = store.getConfig().maxRemindersPerHour ?? 30;
  while (reminderTimestamps.length && now - reminderTimestamps[0] > 60 * 60 * 1000) {
    reminderTimestamps.shift();
  }
  return reminderTimestamps.length < cap;
}

function makeReminderSender(api) {
  return async function sendReminder(text, groupId) {
    if (store.getConfig().remindersEnabled === false) return;
    if (!canSendReminderMore()) {
      console.log(`[reminders][rate-limit] Skipped reminder to ${groupId} — hourly cap reached.`);
      return;
    }
    const delay = 500 + Math.random() * 3000;
    await new Promise((r) => setTimeout(r, delay));
    try {
      await api.sendMessage({ msg: text }, groupId, ThreadType.Group);
      reminderTimestamps.push(Date.now());
      console.log(`[reminders][sent] -> ${groupId}: ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`);
    } catch (err) {
      console.log(`[reminders] Failed to send to ${groupId}:`, err.message);
    }
  };
}

// ---- welcome-message polling: self-rescheduling so a changed poll
// interval or enabled/disabled toggle from the dashboard takes effect on
// the very next cycle, without restarting the bot ----
function startWelcomePolling(api, groupId) {
  async function cycle() {
    const config = store.getConfig();
    if (config.welcomeMessage?.enabled) {
      try {
        const newMembers = await pollGroupForNewMembers(api, groupId);
        for (const member of newMembers) {
          const text = config.welcomeMessage.text.replace("{name}", member.name ?? "bạn");
          await sendWithDelay(api, text, groupId, ThreadType.Group);
        }
      } catch (err) {
        console.error(`[membership] Poll failed for ${groupId}:`, err.message);
      }
    }
    const nextIntervalMs = store.getConfig().pollIntervalMs ?? 120000;
    setTimeout(cycle, nextIntervalMs);
  }
  cycle();
}

async function main() {
  if (!fs.existsSync(SESSION_PATH)) {
    console.error("No saved session found. Run `npm run login` first.");
    process.exit(1);
  }
  const initialConfig = store.getConfig();
  if (initialConfig.managedGroupIds.some((id) => id.startsWith("PASTE_"))) {
    console.error("config.json still has placeholder group IDs. Run `npm run inspect`");
    console.error("to find your real group IDs, then edit config.json.");
    process.exit(1);
  }

  const session = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
  const zalo = new Zalo();
  const api = await zalo.login({
    cookie: session.cookie,
    imei: session.imei,
    userAgent: session.userAgent,
  });

  // ---- 1. Keyword auto-reply ----
  api.listener.on("message", async (message) => {
    if (message.isSelf) return;
    if (message.type !== ThreadType.Group) return;
    if (store.getConfig().autoReplyEnabled === false) return;
    const managed = new Set(store.getConfig().managedGroupIds);
    if (!managed.has(message.threadId)) return;

    const text = typeof message.data?.content === "string" ? message.data.content : null;
    const reply = findKeywordReply(text);
    if (reply) {
      await sendWithDelay(api, reply, message.threadId, ThreadType.Group);
    }
  });
  console.log("Keyword auto-reply: wired (toggle live via autoReplyEnabled in config)");

  // ---- 2. Welcome message on new member (polling, not a push event) ----
  // Always start a polling loop per managed group; each cycle checks the
  // *current* enabled flag and poll interval, so toggling from the
  // dashboard takes effect without a restart.
  for (const groupId of initialConfig.managedGroupIds) {
    startWelcomePolling(api, groupId);
  }

  // ---- 3. Scheduled reminders (class start times, events, etc.) ----
  logUpcomingOccurrences(store.getReminders(), store.getConfig().timezone || "Asia/Ho_Chi_Minh");
  startReminderScheduler(
    () => store.getReminders(),
    () => store.getConfig().timezone || "Asia/Ho_Chi_Minh",
    makeReminderSender(api)
  );

  api.listener.start();
  console.log("Bot is running. Managed groups:", initialConfig.managedGroupIds.join(", "));
  console.log(
    "Toggles (welcomeMessage.enabled, autoReplyEnabled, remindersEnabled, per-reminder/per-rule enabled) apply live — no restart needed."
  );
}

main().catch((err) => {
  console.error("Bot crashed:", err);
  process.exit(1);
});
