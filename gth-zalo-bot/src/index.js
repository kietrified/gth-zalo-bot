// Single entrypoint so one `pm2` process runs both the bot and the admin
// dashboard, sharing the same in-memory config/reminders store (src/store.js)
// — edits saved from the dashboard take effect in the bot immediately.
import "./bot.js"; // self-starts (see bottom of bot.js)
import { startAdminServer } from "./admin/server.js";

const port = parseInt(process.env.ADMIN_PORT || "3000", 10);
startAdminServer(port);
