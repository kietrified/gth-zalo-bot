import fs from "node:fs";
import path from "node:path";

const STATE_PATH = path.resolve("data/reminder-state.json");
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ---- lead time parsing: "30m", "1h", "1h30m", "90m" -> minutes ----
export function parseLeadTime(str) {
  const s = String(str).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10); // bare number = minutes
  const match = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(`Can't parse lead time "${str}". Use formats like "30m", "1h", "1h30m".`);
  }
  const hours = parseInt(match[1] || "0", 10);
  const mins = parseInt(match[2] || "0", 10);
  return hours * 60 + mins;
}

function formatLeadTimeVN(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  return parts.length ? parts.join(" ") : "0 phút";
}

export function parseTimeToMinutes(hhmm) {
  const match = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid eventTime "${hhmm}", expected "HH:MM".`);
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  if (hours > 23 || mins > 59) {
    throw new Error(`Invalid eventTime "${hhmm}" — hours must be 00-23 and minutes 00-59.`);
  }
  return hours * 60 + mins;
}

// ---- timezone-safe "now", independent of the server/VPS's own timezone ----
function getNowParts(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((p) => [p.type, p.value]));
  // hour12:false can return "24" for midnight in some environments; normalize.
  const hour = parts.hour === "24" ? 0 : parseInt(parts.hour, 10);
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    weekday: parts.weekday.toLowerCase(),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function matchesRecurrence(reminder, now) {
  const r = reminder.recurrence;
  switch (r.type) {
    case "once":
      return r.date === `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
    case "daily":
      return true;
    case "weekly":
      return (r.daysOfWeek || []).map((d) => d.toLowerCase()).includes(now.weekday);
    case "monthly":
      return r.dayOfMonth === now.day;
    default:
      console.log(`[reminders] Unknown recurrence type "${r.type}" for reminder "${reminder.id}" — skipping.`);
      return false;
  }
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  // Prune keys older than 3 days so this file doesn't grow forever.
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  for (const key of Object.keys(state)) {
    if (state[key] < cutoff) delete state[key];
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---- computing the next occurrence, for startup visibility ----
function dateOnlyPartsAtOffset(offsetDays, timeZone) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });
  const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    weekday: parts.weekday.toLowerCase(),
  };
}

/**
 * Returns the next date/time this specific reminder+leadTime will fire,
 * as { dateStr: "YYYY-MM-DD", timeStr: "HH:MM" }, or null if it has no
 * upcoming occurrence within a year (e.g. a "once" reminder whose date
 * already passed). Used for startup logging so it's never a mystery when
 * something is scheduled to happen.
 */
export function getNextOccurrence(reminder, leadTimeRaw, timezone) {
  let eventMinutes, leadMinutes;
  try {
    eventMinutes = parseTimeToMinutes(reminder.eventTime);
    leadMinutes = parseLeadTime(leadTimeRaw);
  } catch {
    return null;
  }
  const notifyMinutes = eventMinutes - leadMinutes;
  const now = getNowParts(timezone);
  const nowMinutes = now.hour * 60 + now.minute;

  for (let offset = 0; offset <= 370; offset++) {
    const d = dateOnlyPartsAtOffset(offset, timezone);
    if (!matchesRecurrence(reminder, d)) continue;
    if (offset === 0 && notifyMinutes < nowMinutes) continue; // today's slot already passed
    const hh = String(Math.floor((((notifyMinutes % 1440) + 1440) % 1440) / 60)).padStart(2, "0");
    const mm = String((((notifyMinutes % 1440) + 1440) % 1440) % 60).padStart(2, "0");
    const dateStr = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    return { dateStr, timeStr: `${hh}:${mm}` };
  }
  return null;
}

/**
 * Logs the next occurrence for every enabled reminder+leadTime combo.
 * Call this once at startup so you always know exactly when something
 * will fire without having to mentally simulate the recurrence rule.
 */
export function logUpcomingOccurrences(reminders, timezone) {
  for (const reminder of reminders) {
    if (reminder.enabled === false) continue;
    for (const leadTimeRaw of reminder.leadTimes || ["0m"]) {
      const next = getNextOccurrence(reminder, leadTimeRaw, timezone);
      if (next) {
        console.log(
          `[reminders] "${reminder.id}" (${leadTimeRaw} before ${reminder.eventTime}) — next: ${next.dateStr} ${next.timeStr}`
        );
      } else {
        console.log(
          `[reminders] "${reminder.id}" (${leadTimeRaw} before ${reminder.eventTime}) — no upcoming occurrence (date may have already passed for a "once" reminder).`
        );
      }
    }
  }
}

export function loadReminders(remindersPath) {
  const raw = JSON.parse(fs.readFileSync(remindersPath, "utf-8"));
  return raw.filter((r) => !String(r.id || "").startsWith("_"));
}

/**
 * Starts the reminder scheduler. Checks every `tickMs` (default 20s) —
 * frequent enough not to miss a minute boundary, deduped by
 * reminder+leadTime+date so a message never sends twice for the same
 * occurrence even if a tick overlaps a minute.
 *
 * getReminders() — called fresh on every tick (not just once at startup)
 * so edits saved from the admin dashboard take effect on the very next
 * tick without restarting the bot.
 * getTimezone() — same idea, called fresh each tick.
 * sendFn(text, groupId) — caller supplies how to actually send (so this
 * module doesn't need to know about zca-js, rate limits, or delays).
 *
 * NOTE: if a lead time is longer than the event's time-of-day (e.g. a
 * 1am event with a 2-hour lead time), the notify time crosses midnight
 * into the previous day. This scheduler does not handle that case —
 * keep lead times shorter than the event's time-of-day, which covers
 * normal class/event reminders.
 */
export function startReminderScheduler(getReminders, getTimezone, sendFn, tickMs = 20000) {
  const state = loadState();

  function tick() {
    const timezone = getTimezone();
    const now = getNowParts(timezone);
    const currentMinuteOfDay = now.hour * 60 + now.minute;
    const reminders = getReminders();

    for (const reminder of reminders) {
      if (reminder.enabled === false) continue;
      if (!matchesRecurrence(reminder, now)) continue;

      let eventMinutes;
      try {
        eventMinutes = parseTimeToMinutes(reminder.eventTime);
      } catch (err) {
        console.log(`[reminders] ${err.message} (reminder "${reminder.id}")`);
        continue;
      }

      for (const leadTimeRaw of reminder.leadTimes || ["0m"]) {
        let leadMinutes;
        try {
          leadMinutes = parseLeadTime(leadTimeRaw);
        } catch (err) {
          console.log(`[reminders] ${err.message} (reminder "${reminder.id}")`);
          continue;
        }

        const notifyMinutes = eventMinutes - leadMinutes;
        if (notifyMinutes !== currentMinuteOfDay) continue;

        const key = `${reminder.id}|${leadTimeRaw}|${now.dateKey}`;
        if (state[key]) continue; // already sent for this occurrence

        const text = (reminder.message || "")
          .replace(/\{leadTime\}/g, formatLeadTimeVN(leadMinutes))
          .replace(/\{time\}/g, reminder.eventTime);

        for (const groupId of reminder.groupIds || []) {
          sendFn(text, groupId);
        }

        state[key] = Date.now();
        saveState(state);
        console.log(`[reminders] Fired "${reminder.id}" (${leadTimeRaw} before ${reminder.eventTime})`);
      }
    }
  }

  tick(); // check immediately on startup too
  const timer = setInterval(tick, tickMs);
  return () => clearInterval(timer);
}

/**
 * Validates a single reminder object's shape. Returns an error string, or
 * null if valid. Used by the admin dashboard so a bad save gets rejected
 * with a clear message instead of silently breaking the scheduler.
 */
export function validateReminder(reminder) {
  if (!reminder.id || typeof reminder.id !== "string") {
    return "Each reminder needs a non-empty id.";
  }
  if (!Array.isArray(reminder.groupIds) || reminder.groupIds.length === 0) {
    return `Reminder "${reminder.id}" needs at least one group.`;
  }
  try {
    parseTimeToMinutes(reminder.eventTime);
  } catch (err) {
    return `Reminder "${reminder.id}": ${err.message}`;
  }
  if (!Array.isArray(reminder.leadTimes) || reminder.leadTimes.length === 0) {
    return `Reminder "${reminder.id}" needs at least one lead time.`;
  }
  for (const lt of reminder.leadTimes) {
    try {
      parseLeadTime(lt);
    } catch (err) {
      return `Reminder "${reminder.id}": ${err.message}`;
    }
  }
  const r = reminder.recurrence || {};
  if (r.type === "once") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) {
      return `Reminder "${reminder.id}": recurrence.date must be "YYYY-MM-DD".`;
    }
  } else if (r.type === "weekly") {
    if (!Array.isArray(r.daysOfWeek) || r.daysOfWeek.length === 0) {
      return `Reminder "${reminder.id}": weekly recurrence needs at least one day.`;
    }
    if (r.daysOfWeek.some((d) => !WEEKDAYS.includes(String(d).toLowerCase()))) {
      return `Reminder "${reminder.id}": daysOfWeek must be full weekday names (e.g. "monday").`;
    }
  } else if (r.type === "monthly") {
    if (!Number.isInteger(r.dayOfMonth) || r.dayOfMonth < 1 || r.dayOfMonth > 31) {
      return `Reminder "${reminder.id}": monthly recurrence needs dayOfMonth between 1 and 31.`;
    }
  } else if (r.type !== "daily") {
    return `Reminder "${reminder.id}": recurrence.type must be one of once, daily, weekly, monthly.`;
  }
  if (!reminder.message || typeof reminder.message !== "string") {
    return `Reminder "${reminder.id}" needs a non-empty message.`;
  }
  return null;
}
