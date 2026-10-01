# GTH Zalo Group Auto-Responder

Event-based bot for the two Zalo groups you co-own:
- **Welcome message** when someone new joins
- **Keyword auto-reply** (e.g. someone asks about học phí / lịch học) in-group

Built on [`zca-js`](https://www.npmjs.com/package/zca-js), an **unofficial**
library that automates a real personal Zalo account by simulating the Zalo
Web client. Read the risk section below before running this on your main
account.

## ⚠️ Read this first

- This is not Zalo's official API. Zalo can lock or ban accounts it detects
  sending scripted/bulk messages. This project is built to *minimize* that
  risk (human-like delays, hourly send cap, only replies in your own two
  groups) — but the risk isn't zero.
- **Use a secondary Zalo account** that's a co-owner/admin of the two groups,
  not your personal daily-driver account, if at all possible. If the account
  gets flagged, you don't lose your own Zalo.
- Only one Zalo Web session can be active per account at a time — don't have
  Zalo Web open in a browser while the bot is running, it'll kick the bot's
  session.
- `data/session.json` is as sensitive as a password. Never commit it, never
  send it to anyone.
- Keep `maxRepliesPerHour` in `config.json` conservative. This is a floor of
  safety, not a target to max out.

## Setup

```bash
npm install
npm run login       # scan QR once with the bot account's Zalo app
npm run inspect      # prints your group IDs + real event names — read below
```

After `npm run inspect` prints your groups, edit `config.json`:
- Paste the two group IDs into `managedGroupIds`
- Edit `welcomeMessage.text` and `keywordReplies` to match GTH's actual wording/links

### How the welcome message actually triggers

`npm run inspect` was used to check whether `zca-js` pushes a distinct
"member joined" event over the listener — on the version installed here, it
doesn't (delivery-receipt events fire, but no group_event/member event).
Rather than depend on an internal push event that may not exist on your
version, the welcome message works by **polling**: every `pollIntervalMs`
(default 2 minutes, in `config.json`), the bot fetches each managed group's
member list and diffs it against the last check. Anyone new gets welcomed.
It's a couple minutes slower than an instant push event would be, but it
doesn't depend on undocumented internals.

The first poll after starting the bot only records a baseline — it won't
welcome your entire existing membership on first run.

Once your two real group IDs are in `config.json`:

```bash
npm run start
```

## Where to run this

It needs to stay running to catch events in real time, so:
- **Best**: a small always-on VPS (e.g. a $5–6/mo DigitalOcean/Vultr/Linode
  box, or a low-cost Vietnam-region VPS). Run with `pm2` or a `systemd`
  service so it restarts if it crashes.
- **OK for testing**: your own computer, left on, e.g. inside `tmux`/`screen`.
  Not reliable for real 24/7 use since sleep/reboots/network drops stop it.

Minimal `pm2` example once on a server:
```bash
npm install -g pm2
pm2 start src/index.js --name gth-zalo-bot
pm2 save
pm2 startup   # follow its printed instructions to survive reboots
```
(`src/index.js` starts both the bot and the admin dashboard together — see
below. If you only ever want the bot with no dashboard, use
`npm run start:bot-only` / `pm2 start src/bot.js` instead.)

## Scheduled reminders (class times, events)

Edit `reminders.json` — each entry is one reminder. Example (weekly class
reminder, 30 minutes before):

```json
{
  "id": "topik-class-mon-wed",
  "enabled": true,
  "groupIds": ["YOUR_GROUP_ID"],
  "recurrence": { "type": "weekly", "daysOfWeek": ["monday", "wednesday"] },
  "eventTime": "18:00",
  "leadTimes": ["30m"],
  "message": "⏰ Nhắc nhở: lớp học sẽ bắt đầu sau {leadTime} nữa, lúc {time}!"
}
```

- **`recurrence.type`**: `"once"` (needs `"date": "YYYY-MM-DD"`), `"daily"`,
  `"weekly"` (needs `"daysOfWeek": ["monday", ...]`), or `"monthly"` (needs
  `"dayOfMonth": 1`–`31`).
- **`eventTime`**: `"HH:MM"`, 24-hour, in the timezone set by `timezone` in
  `config.json` (defaults to `Asia/Ho_Chi_Minh`) — this is independent of
  whatever timezone the server itself is set to, so it won't silently shift
  if you move the bot to a VPS in a different region.
- **`leadTimes`**: an array — how long before `eventTime` to send. Accepts
  `"5m"`, `"10m"`, `"30m"`, `"1h"`, `"1h30m"`, etc. Put multiple values to
  send more than one reminder for the same event (e.g. `["1h", "10m"]`
  sends two separate messages).
- **`message`**: use `{leadTime}` and `{time}` as placeholders — they get
  filled in automatically (e.g. "sau 30 phút nữa, lúc 18:00").
- **`groupIds`**: which group(s) get this specific reminder — doesn't have
  to be all of `managedGroupIds`.
- **`enabled`**: `false` to keep a reminder defined but turned off.

**Limitation**: if a lead time is longer than the event's time-of-day (e.g.
a 1:00 AM event with a 2-hour lead time), the notify moment would cross
into the previous day — this isn't handled. Keep lead times shorter than
`eventTime`'s minutes, which covers normal daytime/evening class and event
reminders.

Reminders use their own send path (not the keyword-reply one) with a small
random delay (0.5–3.5s, for timing accuracy) and their own hourly safety
cap (`maxRemindersPerHour` in `config.json`, default 30).

## Admin dashboard (for non-technical staff)

A small password-protected web page where GTH staff can edit reminders,
keyword replies, and turn features on/off — changes save instantly, no
restart, no editing JSON by hand or touching the command line.

**Create staff accounts** (only someone with server access can do this —
there's no public signup page, by design):
```bash
npm run add-user
```
It'll prompt for a username, display name, and password (typed characters
show as `*`). Run it again for each staff member. Other account commands:
`npm run list-users`, `npm run remove-user -- <username>`.

**Start it** — `npm run start` (or `pm2 start src/index.js`, per above)
now runs the bot *and* the dashboard together in one process, sharing the
same live config. The dashboard listens on port 3000 by default; override
with `ADMIN_PORT=8080 npm run start` if you need a different port.

**Access it**: `http://your_server_ip:3000` — staff log in with the
username/password you created above, then can edit:
- The three master toggles (welcome message, keyword auto-reply, reminders)
- The welcome message text
- All keyword-reply rules (add/edit/remove/enable/disable)
- All scheduled reminders (add/edit/remove/enable/disable), with a live
  "next occurrence" shown for each so it's never a mystery when something
  will fire

### ⚠️ Put this behind HTTPS before giving staff the link

As set up above, the dashboard runs on plain HTTP. That means a staff
member's password travels the internet unencrypted every time they log in
— fine for testing from your own machine, not something to hand around to
"log in from anywhere." Before real use, put it behind free HTTPS with
[Caddy](https://caddyserver.com/) (much less setup than nginx + certbot):

1. You need a domain or subdomain pointed at your server's IP (e.g.
   `bot.yourdomain.com` — an A record in whatever DNS provider GTH already
   uses for the main site).
2. On the server:
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install -y caddy
   ```
3. Edit `/etc/caddy/Caddyfile` to just:
   ```
   bot.yourdomain.com {
     reverse_proxy localhost:3000
   }
   ```
4. `sudo systemctl reload caddy`. Caddy automatically gets and renews a
   real HTTPS certificate for that domain — no manual certbot steps.
5. Give staff `https://bot.yourdomain.com` instead of the raw IP:port.

If a domain isn't available, at minimum don't expose port 3000 to the
whole internet — restrict access with your VPS firewall to specific staff
IPs, or have them connect over an SSH tunnel
(`ssh -L 3000:localhost:3000 user@server`, then open `localhost:3000`
locally) instead of a public port.



- More keyword rules: add entries to `keywordReplies` in `config.json`, no
  code changes needed.
- Different reply per group: switch `keywordReplies`/`welcomeMessage` to be
  keyed by group ID instead of shared — ask if you want this scaffolded.
- Logging to a file instead of console: swap `console.log` calls for a
  logger (e.g. `pino`) once you're running this unattended.
