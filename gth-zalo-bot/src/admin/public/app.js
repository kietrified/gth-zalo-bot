const WEEKDAYS = [
  ["monday", "T2"], ["tuesday", "T3"], ["wednesday", "T4"], ["thursday", "T5"],
  ["friday", "T6"], ["saturday", "T7"], ["sunday", "CN"],
];

let state = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function flash(el, message, ok = true) {
  el.textContent = message;
  el.className = `save-status ${ok ? "ok" : "err"}`;
  setTimeout(() => { el.textContent = ""; }, 3000);
}

// ---------- init ----------
async function init() {
  try {
    const me = await api("/api/me");
    if (!me.user) { window.location.href = "/login.html"; return; }
    document.getElementById("whoami").textContent = me.user.displayName || me.user.username;
  } catch {
    window.location.href = "/login.html";
    return;
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    window.location.href = "/login.html";
  });

  state = await api("/api/state");
  document.getElementById("loadingMsg").classList.add("hidden");
  for (const id of ["togglesSection", "welcomeSection", "keywordsSection", "remindersSection"]) {
    document.getElementById(id).classList.remove("hidden");
  }

  renderToggles();
  renderWelcome();
  renderKeywords();
  renderReminders();
}

// ---------- toggles ----------
function renderToggles() {
  document.getElementById("toggleWelcome").checked = !!state.welcomeMessage?.enabled;
  document.getElementById("toggleAutoReply").checked = state.autoReplyEnabled !== false;
  document.getElementById("toggleReminders").checked = state.remindersEnabled !== false;

  for (const [id, key] of [
    ["toggleWelcome", "welcomeMessageEnabled"],
    ["toggleAutoReply", "autoReplyEnabled"],
    ["toggleReminders", "remindersEnabled"],
  ]) {
    document.getElementById(id).addEventListener("change", async (e) => {
      try {
        await api("/api/toggles", { method: "POST", body: { [key]: e.target.checked } });
      } catch (err) {
        alert("Lỗi: " + err.message);
        e.target.checked = !e.target.checked; // revert on failure
      }
    });
  }
}

// ---------- welcome message ----------
function renderWelcome() {
  document.getElementById("welcomeText").value = state.welcomeMessage?.text || "";
  document.getElementById("saveWelcomeBtn").addEventListener("click", async () => {
    const status = document.getElementById("welcomeStatus");
    try {
      await api("/api/welcome-message", { method: "POST", body: { text: document.getElementById("welcomeText").value } });
      flash(status, "Đã lưu ✓");
    } catch (err) {
      flash(status, "Lỗi: " + err.message, false);
    }
  });
}

// ---------- keyword replies ----------
function renderKeywords() {
  const list = document.getElementById("keywordList");
  list.innerHTML = "";
  state.keywordReplies.forEach((rule, i) => list.appendChild(keywordRow(rule, i)));

  document.getElementById("addKeywordBtn").onclick = () => {
    state.keywordReplies.push({ triggers: [], reply: "", enabled: true });
    renderKeywords();
  };

  document.getElementById("saveKeywordsBtn").onclick = async () => {
    const status = document.getElementById("keywordsStatus");
    const rows = [...list.children];
    const payload = rows.map((row) => ({
      enabled: row.querySelector(".rule-enabled").checked,
      triggers: row.querySelector(".rule-triggers").value.split(",").map((s) => s.trim()).filter(Boolean),
      reply: row.querySelector(".rule-reply").value,
    }));
    try {
      const result = await api("/api/keyword-replies", { method: "POST", body: { keywordReplies: payload } });
      state.keywordReplies = result.keywordReplies;
      flash(status, "Đã lưu ✓");
    } catch (err) {
      flash(status, "Lỗi: " + err.message, false);
    }
  };
}

function keywordRow(rule, index) {
  const div = document.createElement("div");
  div.className = "item-card";
  div.innerHTML = `
    <div class="item-row">
      <label class="switch-row inline">
        <input type="checkbox" class="rule-enabled" ${rule.enabled !== false ? "checked" : ""} /> Bật
      </label>
      <button class="danger small remove-btn">Xóa</button>
    </div>
    <label>Từ khóa (cách nhau bởi dấu phẩy)
      <input type="text" class="rule-triggers" value="${escapeAttr((rule.triggers || []).join(", "))}" placeholder="học phí, giá, bảng giá" />
    </label>
    <label>Nội dung trả lời
      <textarea class="rule-reply" rows="2">${escapeHtml(rule.reply || "")}</textarea>
    </label>
  `;
  div.querySelector(".remove-btn").onclick = () => {
    state.keywordReplies.splice(index, 1);
    renderKeywords();
  };
  return div;
}

// ---------- reminders ----------
function renderReminders() {
  const list = document.getElementById("reminderList");
  list.innerHTML = "";
  state.reminders.forEach((reminder, i) => list.appendChild(reminderCard(reminder, i)));

  document.getElementById("addReminderBtn").onclick = () => {
    state.reminders.push({
      id: `reminder-${Date.now()}`,
      enabled: true,
      groupIds: state.managedGroupIds.slice(0, 1),
      recurrence: { type: "weekly", daysOfWeek: ["monday"] },
      eventTime: "18:00",
      leadTimes: ["30m"],
      message: "Nhắc nhở sẽ bắt đầu sau {leadTime} nữa, lúc {time}!",
    });
    renderReminders();
  };

  document.getElementById("saveRemindersBtn").onclick = async () => {
    const status = document.getElementById("remindersStatus");
    try {
      const payload = [...list.children].map((card) => readReminderCard(card));
      const result = await api("/api/reminders", { method: "POST", body: { reminders: payload } });
      state.reminders = result.reminders.map((r) => ({ ...r, _next: [] }));
      flash(status, "Đã lưu ✓ — đang tính lại lịch...");
      state = await api("/api/state");
      renderReminders();
    } catch (err) {
      flash(status, "Lỗi: " + err.message, false);
    }
  };
}

function reminderCard(reminder, index) {
  const div = document.createElement("div");
  div.className = "item-card";
  div.dataset.id = reminder.id;

  const nextText = (reminder._next || [])
    .map((n) => (n.dateStr ? `${n.leadTime} trước → ${n.dateStr} ${n.timeStr}` : `${n.leadTime} trước → (đã qua, không còn lần tới)`))
    .join(" · ");

  div.innerHTML = `
    <div class="item-row">
      <label class="switch-row inline">
        <input type="checkbox" class="r-enabled" ${reminder.enabled !== false ? "checked" : ""} /> Bật
      </label>
      <button class="danger small remove-btn">Xóa</button>
    </div>
    <label>Tên nhắc nhở (id, không dấu, không trùng)
      <input type="text" class="r-id" value="${escapeAttr(reminder.id)}" />
    </label>
    <label>Nhóm áp dụng (Group ID, cách nhau bởi dấu phẩy)
      <input type="text" class="r-groups" value="${escapeAttr((reminder.groupIds || []).join(", "))}" />
    </label>
    <label>Lặp lại
      <select class="r-recurtype">
        <option value="daily">Hằng ngày</option>
        <option value="weekly">Theo tuần (chọn ngày)</option>
        <option value="monthly">Theo tháng (chọn ngày trong tháng)</option>
        <option value="once">Một lần (ngày cụ thể)</option>
      </select>
    </label>
    <div class="r-recur-fields"></div>
    <label>Giờ sự kiện (VD lớp học bắt đầu lúc mấy giờ)
      <input type="time" class="r-time" value="${escapeAttr(reminder.eventTime || "18:00")}" />
    </label>
    <label>Nhắc trước bao lâu (cách nhau bởi dấu phẩy — VD: 30m, 1h, 1h30m)
      <input type="text" class="r-leadtimes" value="${escapeAttr((reminder.leadTimes || []).join(", "))}" />
    </label>
    <label>Nội dung tin nhắn (dùng {leadTime} và {time})
      <textarea class="r-message" rows="2">${escapeHtml(reminder.message || "")}</textarea>
    </label>
    <p class="hint next-fire">${nextText ? "Lần tới: " + nextText : ""}</p>
  `;

  div.querySelector(".remove-btn").onclick = () => {
    state.reminders.splice(index, 1);
    renderReminders();
  };

  const typeSelect = div.querySelector(".r-recurtype");
  typeSelect.value = reminder.recurrence?.type || "weekly";
  renderRecurrenceFields(div, reminder.recurrence || { type: "weekly", daysOfWeek: [] });
  typeSelect.addEventListener("change", () => {
    renderRecurrenceFields(div, { type: typeSelect.value });
  });

  return div;
}

function renderRecurrenceFields(card, recurrence) {
  const container = card.querySelector(".r-recur-fields");
  const type = recurrence.type;
  card.querySelector(".r-recurtype").value = type;

  if (type === "weekly") {
    container.innerHTML = `<div class="weekday-picker">${WEEKDAYS.map(
      ([val, label]) => `<label class="weekday-chip"><input type="checkbox" value="${val}" ${
        (recurrence.daysOfWeek || []).includes(val) ? "checked" : ""
      } />${label}</label>`
    ).join("")}</div>`;
  } else if (type === "monthly") {
    container.innerHTML = `<label>Ngày trong tháng (1-31)
      <input type="number" class="r-dayofmonth" min="1" max="31" value="${recurrence.dayOfMonth || 1}" />
    </label>`;
  } else if (type === "once") {
    container.innerHTML = `<label>Ngày cụ thể
      <input type="date" class="r-date" value="${recurrence.date || ""}" />
    </label>`;
  } else {
    container.innerHTML = "";
  }
}

function readReminderCard(card) {
  const type = card.querySelector(".r-recurtype").value;
  let recurrence = { type };
  if (type === "weekly") {
    recurrence.daysOfWeek = [...card.querySelectorAll(".weekday-chip input:checked")].map((el) => el.value);
  } else if (type === "monthly") {
    recurrence.dayOfMonth = parseInt(card.querySelector(".r-dayofmonth").value, 10);
  } else if (type === "once") {
    recurrence.date = card.querySelector(".r-date").value;
  }
  return {
    id: card.querySelector(".r-id").value.trim(),
    enabled: card.querySelector(".r-enabled").checked,
    groupIds: card.querySelector(".r-groups").value.split(",").map((s) => s.trim()).filter(Boolean),
    recurrence,
    eventTime: card.querySelector(".r-time").value,
    leadTimes: card.querySelector(".r-leadtimes").value.split(",").map((s) => s.trim()).filter(Boolean),
    message: card.querySelector(".r-message").value,
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

init();
