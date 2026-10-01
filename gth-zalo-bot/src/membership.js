import fs from "node:fs";
import path from "node:path";

const MEMBERS_DIR = path.resolve("data/members");

function membersFilePath(groupId) {
  return path.join(MEMBERS_DIR, `${groupId}.json`);
}

function loadKnownMemberIds(groupId) {
  const file = membersFilePath(groupId);
  if (!fs.existsSync(file)) return null; // null = "never polled before"
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function saveKnownMemberIds(groupId, ids) {
  fs.mkdirSync(MEMBERS_DIR, { recursive: true });
  fs.writeFileSync(membersFilePath(groupId), JSON.stringify(ids, null, 2));
}

// Pulls the current member ID list for a group from zca-js's getGroupInfo.
// Field name confirmed from real zca-js output: gridInfoMap[groupId].memberIds.
// Some accounts/groups report members under currentMems instead (array of
// {id, ...} objects) rather than memberIds (plain string array) — this
// normalizes both shapes to a flat array of member IDs.
let loggedFullInfoOnce = false;

async function fetchCurrentMemberIds(api, groupId) {
  const res = await api.getGroupInfo(groupId);
  const info = res?.gridInfoMap?.[groupId];
  if (!info) {
    throw new Error(`getGroupInfo returned no data for group ${groupId}`);
  }

  if (!loggedFullInfoOnce) {
    console.log(`[membership] DEBUG full getGroupInfo response for ${groupId} (logged once):`);
    console.dir(info, { depth: 6 });
    loggedFullInfoOnce = true;
  }

  if (Array.isArray(info.memberIds) && info.memberIds.length > 0) {
    return info.memberIds.map(String);
  }
  if (Array.isArray(info.currentMems) && info.currentMems.length > 0) {
    return info.currentMems.map((m) => String(m.id ?? m.uid ?? m));
  }
  // memberIds/currentMems can come back empty even when totalMember > 0 —
  // Zalo appears to lazy-load full membership under those keys, so fall
  // back to memVerList, which seems to always be populated with a version
  // stamp per member. Each entry looks like "<memberId>_<version>" — if
  // this parsing is wrong, the DEBUG dump above will show the real shape.
  if (Array.isArray(info.memVerList) && info.memVerList.length > 0) {
    return info.memVerList.map((entry) => String(entry).split("_")[0]);
  }
  // Empty group, or a shape we haven't seen — return empty rather than throw,
  // so one odd poll doesn't crash the whole bot.
  return [];
}

// Tries a couple of plausible spots for a display name; falls back to a
// generic greeting if none are found rather than showing a raw numeric ID.
async function fetchDisplayName(api, groupId, memberId) {
  try {
    const res = await api.getGroupInfo(groupId);
    const info = res?.gridInfoMap?.[groupId];
    const match = info?.currentMems?.find((m) => String(m.id ?? m.uid) === memberId);
    if (match?.dName) return match.dName;
    if (match?.name) return match.name;
  } catch {
    // fall through to generic name
  }
  try {
    if (typeof api.getUserInfo === "function") {
      const userRes = await api.getUserInfo(memberId);
      const name =
        userRes?.changed_profiles?.[memberId]?.displayName ??
        userRes?.unchanged_profiles?.[memberId]?.displayName;
      if (name) return name;
    }
  } catch {
    // fall through
  }
  return null;
}

// Polls one group once: returns an array of {id, name} for any member IDs
// not seen on the previous poll. On the very first poll for a group (no
// saved file yet) it just records the baseline and returns [] — otherwise
// every existing member would look like a "new join" on first run.
export async function pollGroupForNewMembers(api, groupId) {
  const currentIds = await fetchCurrentMemberIds(api, groupId);
  const knownIds = loadKnownMemberIds(groupId);

  saveKnownMemberIds(groupId, currentIds);

  if (knownIds === null) {
    console.log(`[membership] Baseline recorded for ${groupId}: ${currentIds.length} members.`);
    return [];
  }

  const knownSet = new Set(knownIds);
  const newIds = currentIds.filter((id) => !knownSet.has(id));

  const newMembers = [];
  for (const id of newIds) {
    const name = await fetchDisplayName(api, groupId, id);
    newMembers.push({ id, name });
  }
  return newMembers;
}
