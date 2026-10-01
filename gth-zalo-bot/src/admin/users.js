import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

const USERS_PATH = path.resolve("data/users.json");

export function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

export function findUser(username) {
  return loadUsers().find((u) => u.username.toLowerCase() === String(username).toLowerCase());
}

export function verifyPassword(username, password) {
  const user = findUser(username);
  if (!user) return false;
  return bcrypt.compareSync(password, user.passwordHash);
}

export function addUser(username, password, displayName) {
  const users = loadUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error(`User "${username}" already exists.`);
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  users.push({ username, passwordHash, displayName: displayName || username });
  saveUsers(users);
}

export function removeUser(username) {
  const users = loadUsers();
  const filtered = users.filter((u) => u.username.toLowerCase() !== username.toLowerCase());
  if (filtered.length === users.length) {
    throw new Error(`User "${username}" not found.`);
  }
  saveUsers(filtered);
}

export function listUsernames() {
  return loadUsers().map((u) => u.username);
}
