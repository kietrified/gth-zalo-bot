import readline from "node:readline";
import { addUser, removeUser, listUsernames } from "./users.js";

function ask(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!mask) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }
    // Simple password masking: intercept stdout writes while this prompt
    // is active so typed characters show as "*" instead of the raw input.
    const stdin = process.stdin;
    process.stdout.write(question);
    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char) => {
      if (char === "\n" || char === "\r" || char === "\u0004") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (char === "\u0003") {
        process.exit(1);
      } else if (char === "\u007f") {
        input = input.slice(0, -1);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + "*".repeat(input.length));
      } else {
        input += char;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

const command = process.argv[2];

async function main() {
  if (command === "remove") {
    const username = process.argv[3] || (await ask("Username to remove: "));
    removeUser(username);
    console.log(`Removed user "${username}".`);
    return;
  }

  if (command === "list") {
    const names = listUsernames();
    console.log(names.length ? names.join("\n") : "(no users yet)");
    return;
  }

  // default: add a user
  const username = process.argv[3] || (await ask("New username: "));
  const displayName = await ask("Display name (optional, press Enter to skip): ");
  const password = await ask("Password: ", { mask: true });
  const confirm = await ask("Confirm password: ", { mask: true });
  if (password !== confirm) {
    console.error("Passwords didn't match — nothing was saved. Try again.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password should be at least 8 characters — nothing was saved. Try again.");
    process.exit(1);
  }
  addUser(username, password, displayName);
  console.log(`\nUser "${username}" added. They can now log in to the dashboard.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
