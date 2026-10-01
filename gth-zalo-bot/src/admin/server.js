import express from "express";
import session from "express-session";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as store from "../store.js";
import { verifyPassword, findUser } from "./users.js";
import { validateReminder, getNextOccurrence } from "../reminders.js";

const SESSION_SECRET_PATH = path.resolve("data/.session-secret");

function getOrCreateSessionSecret() {
  if (fs.existsSync(SESSION_SECRET_PATH)) {
    return fs.readFileSync(SESSION_SECRET_PATH, "utf-8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(SESSION_SECRET_PATH), { recursive: true });
  fs.writeFileSync(SESSION_SECRET_PATH, secret);
  return secret;
}

export function startAdminServer(port = 3000) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: getOrCreateSessionSecret(),
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    })
  );

  const publicDir = path.resolve("src/admin/public");

  function requireAuth(req, res, next) {
    if (req.session?.user) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Not logged in." });
    return res.redirect("/login.html");
  }

  // ---- auth routes (no auth required) ----
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password || !verifyPassword(username, password)) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    const user = findUser(username);
    req.session.user = { username: user.username, displayName: user.displayName };
    res.json({ ok: true, user: req.session.user });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/me", (req, res) => {
    res.json({ user: req.session?.user || null });
  });

  // Serve login page and static assets without auth (the dashboard page
  // itself is static HTML — real protection is on the /api/* data routes).
  app.use(express.static(publicDir));

  // ---- everything below requires a logged-in session ----
  app.use(requireAuth);

  app.get("/api/state", (req, res) => {
    const config = store.getConfig();
    const reminders = store.getReminders();
    const timezone = config.timezone || "Asia/Ho_Chi_Minh";
    const remindersWithNext = reminders.map((r) => ({
      ...r,
      _next:
        r.enabled !== false
          ? (r.leadTimes || ["0m"]).map((lt) => ({ leadTime: lt, ...(getNextOccurrence(r, lt, timezone) || {}) }))
          : [],
    }));
    res.json({
      managedGroupIds: config.managedGroupIds,
      welcomeMessage: config.welcomeMessage,
      autoReplyEnabled: config.autoReplyEnabled !== false,
      remindersEnabled: config.remindersEnabled !== false,
      keywordReplies: config.keywordReplies || [],
      reminders: remindersWithNext,
      timezone,
    });
  });

  app.post("/api/toggles", (req, res) => {
    const patch = {};
    const { welcomeMessageEnabled, autoReplyEnabled, remindersEnabled } = req.body || {};
    if (typeof welcomeMessageEnabled === "boolean") {
      patch.welcomeMessage = { ...store.getConfig().welcomeMessage, enabled: welcomeMessageEnabled };
    }
    if (typeof autoReplyEnabled === "boolean") patch.autoReplyEnabled = autoReplyEnabled;
    if (typeof remindersEnabled === "boolean") patch.remindersEnabled = remindersEnabled;
    const updated = store.updateConfig(patch);
    res.json({ ok: true, config: updated });
  });

  app.post("/api/welcome-message", (req, res) => {
    const { text } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Welcome message text can't be empty." });
    }
    const updated = store.updateConfig({ welcomeMessage: { ...store.getConfig().welcomeMessage, text } });
    res.json({ ok: true, welcomeMessage: updated.welcomeMessage });
  });

  app.post("/api/keyword-replies", (req, res) => {
    const { keywordReplies } = req.body || {};
    if (!Array.isArray(keywordReplies)) {
      return res.status(400).json({ error: "keywordReplies must be an array." });
    }
    for (const rule of keywordReplies) {
      if (!Array.isArray(rule.triggers) || rule.triggers.length === 0 || rule.triggers.some((t) => !String(t).trim())) {
        return res.status(400).json({ error: "Each rule needs at least one non-empty trigger word." });
      }
      if (!rule.reply || !String(rule.reply).trim()) {
        return res.status(400).json({ error: "Each rule needs a non-empty reply message." });
      }
    }
    const updated = store.updateConfig({ keywordReplies });
    res.json({ ok: true, keywordReplies: updated.keywordReplies });
  });

  app.post("/api/reminders", (req, res) => {
    const { reminders } = req.body || {};
    if (!Array.isArray(reminders)) {
      return res.status(400).json({ error: "reminders must be an array." });
    }
    const ids = new Set();
    for (const reminder of reminders) {
      const err = validateReminder(reminder);
      if (err) return res.status(400).json({ error: err });
      if (ids.has(reminder.id)) {
        return res.status(400).json({ error: `Duplicate reminder id "${reminder.id}" — ids must be unique.` });
      }
      ids.add(reminder.id);
    }
    const saved = store.setReminders(reminders);
    res.json({ ok: true, reminders: saved });
  });

  const server = app.listen(port, () => {
    console.log(`Admin dashboard: http://localhost:${port} (or your server's address on that port)`);
  });
  return server;
}
