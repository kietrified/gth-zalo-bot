import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.resolve("config.json");
const REMINDERS_PATH = path.resolve("reminders.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// Atomic write: write to a temp file then rename, so a crash or concurrent
// read never sees a half-written file.
function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

let configState = readJson(CONFIG_PATH);
let remindersState = readJson(REMINDERS_PATH).filter((r) => !String(r.id || "").startsWith("_"));

export function getConfig() {
  return configState;
}

export function getReminders() {
  return remindersState;
}

/** Merge-patch config.json (shallow merge at the top level) and persist. */
export function updateConfig(patch) {
  configState = { ...configState, ...patch };
  writeJsonAtomic(CONFIG_PATH, configState);
  return configState;
}

/** Replace the full reminders list and persist. */
export function setReminders(newReminders) {
  remindersState = newReminders;
  writeJsonAtomic(REMINDERS_PATH, remindersState);
  return remindersState;
}

// ---- fallback: pick up direct file edits (e.g. someone SSHes in and
// edits config.json by hand) without needing a full process restart ----
function watchFile(filePath, reload) {
  let timer = null;
  fs.watch(filePath, () => {
    // Debounce — editors/writes can fire multiple change events per save.
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        reload();
        console.log(`[store] Reloaded ${path.basename(filePath)} from disk (external change detected).`);
      } catch (err) {
        console.log(`[store] Failed to reload ${path.basename(filePath)} after external change:`, err.message);
      }
    }, 300);
  });
}

watchFile(CONFIG_PATH, () => {
  configState = readJson(CONFIG_PATH);
});
watchFile(REMINDERS_PATH, () => {
  remindersState = readJson(REMINDERS_PATH).filter((r) => !String(r.id || "").startsWith("_"));
});
