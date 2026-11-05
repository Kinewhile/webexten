/* ================= defaults (first run only) ================= */
const DEFAULT_APPS = [
  { id: "youtube",  name: "youtube",  url: "https://www.youtube.com/" },
  { id: "whatsapp", name: "whatsapp", url: "https://web.whatsapp.com/" },
  { id: "telegram", name: "telegram", url: "https://web.telegram.org/a/#-1003691085198" },
  {
    id: "material", name: "material",
    url: "https://www.youtube.com/embed/videoseries?list=PLR2RsKKRngz7dgjwj2FKGXdC6GQ8Jx8FF",
    openUrl: "https://www.youtube.com/watch?v=-DI4hhftCNs&list=PLR2RsKKRngz7dgjwj2FKGXdC6GQ8Jx8FF&index=6",
  },
  { id: "goals", name: "goals", builtin: "goals", emoji: "🎯", w: 460, h: 520 },
];

/* ================= helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const store = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  remove: (k) => chrome.storage.local.remove(k),
};

const desktop = $("#Desktop_it_self");
const appsMenu = $("#apps");
const address = $("#address");
const btn = {
  ext: $("#ext"), back: $("#back"), forward: $("#forward"),
  reload: $("#reload"), newtab: $("#newtab"),
};

// Let any site load inside our windows (only frames opened from this page).
const rulesReady = chrome.declarativeNetRequest
  .updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
        ],
      },
      condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: ["sub_frame"] },
    }],
  })
  .catch((err) => console.error("frame rule failed", err));

/* ================= apps data ================= */
let apps = [];
const saveApps = () => store.set("apps_v3", apps);

function slot(i) {
  const rows = Math.max(1, Math.floor((desktop.clientHeight - 200) / 150));
  return { x: 24 + Math.floor(i / rows) * 150, y: 96 + (i % rows) * 150 };
}

async function loadApps() {
  let saved = await store.get("apps_v3");
  if (!saved) {
    // first run: seed defaults and keep any card positions saved by the old version
    const old = await chrome.storage.local.get(DEFAULT_APPS.map((a) => "pos_" + a.id));
    saved = DEFAULT_APPS.map((a) => {
      const p = old["pos_" + a.id];
      return p ? { ...a, x: p.x, y: p.y } : { ...a };
    });
  }
  saved.forEach((a, i) => {
    if (a.x == null) Object.assign(a, slot(i));
  });
  apps = saved;
  await saveApps();
}

/* ================= icons ================= */
const favicon = (url) =>
  "https://www.google.com/s2/favicons?sz=128&domain_url=" + encodeURIComponent(url);

function tile(text) {
  const d = document.createElement("div");
  d.className = "emoji";
  d.textContent = text;
  return d;
}

function makeIcon(app) {
  const letter = (app.name || "?").charAt(0).toUpperCase();
  if (app.icon || app.url) {
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    if (app.icon) {
      img.src = app.icon; // custom icon you picked
    } else {
      img.src = favicon(app.url); // taken from the site itself
      img.className = "fav";
    }
    img.addEventListener("error", () => img.replaceWith(tile(letter)));
    return img;
  }
  return tile(app.emoji || letter);
}

/* ================= desktop cards ================= */
function makeCard(app) {
  const card = document.createElement("div");
  card.className = "tap";
  card.dataset.id = app.id;
  const me = document.createElement("div");
  me.className = "me";
  const label = document.createElement("span");
  label.textContent = app.name;
  me.append(label, makeIcon(app)); // column-reverse puts the icon on top
  card.append(me);
  card.style.left = clamp(app.x, 0, Math.max(0, desktop.clientWidth - 130)) + "px";
  card.style.top = clamp(app.y, 0, Math.max(0, desktop.clientHeight - 150)) + "px";

  let sx, sy, ox, oy, moved = false, down = false;
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    down = true;
    card.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY;
    ox = card.offsetLeft; oy = card.offsetTop;
    moved = false;
  });
  card.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    card.style.left = clamp(ox + dx, 0, desktop.clientWidth - card.offsetWidth) + "px";
    card.style.top = clamp(oy + dy, 0, desktop.clientHeight - card.offsetHeight) + "px";
  });
  card.addEventListener("pointerup", () => {
    if (!down) return;
    down = false;
    if (moved) {
      app.x = card.offsetLeft;
      app.y = card.offsetTop;
      saveApps();
    } else {
      openApp(app);
    }
  });
  card.addEventListener("pointercancel", () => { down = false; });
  return card;
}

function renderCards() {
  desktop.querySelectorAll(".tap").forEach((c) => c.remove());
  apps.forEach((app) => desktop.append(makeCard(app)));
}

/* ================= windows ================= */
const open = new Map();
let zTop = 10;
let current = null; // the focused window

function focusWin(w) {
  current = w;
  open.forEach((o) => o.el.classList.toggle("active", o === w));
  w.el.style.zIndex = ++zTop;
  syncToolbar();
}

function closeWin(w) {
  w.el.remove();
  open.delete(w.app.id);
  if (current === w) {
    current = null;
    const last = [...open.values()].pop();
    if (last) focusWin(last);
    else syncToolbar();
  }
}

async function openApp(app) {
  closeMenus();
  await rulesReady;
  const existing = open.get(app.id);
  if (existing) return focusWin(existing);

  const el = document.createElement("section");
  el.className = "win";
  el.innerHTML = `
    <header class="bar">
      <span class="title"></span>
      <button class="max" title="Maximize">□</button>
      <button class="close" title="Close">✕</button>
    </header>
    <div class="body"></div>`;
  $(".title", el).textContent = app.name;

  const win = { app, el, frame: null, state: null };
  const body = $(".body", el);
  if (app.url) {
    const frame = document.createElement("iframe");
    frame.src = app.url;
    frame.allow = "clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera";
    frame.allowFullscreen = true;
    body.append(frame);
    win.frame = frame;
  } else {
    buildGoals(body);
  }

  const n = open.size;
  const w = Math.min(app.w || 860, desktop.clientWidth - 40);
  const h = Math.min(app.h || 540, desktop.clientHeight - 100);
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.style.left = clamp(190 + n * 28, 0, desktop.clientWidth - w) + "px";
  el.style.top = clamp(80 + n * 28, 0, desktop.clientHeight - h) + "px";
  desktop.append(el);

  open.set(app.id, win);
  focusWin(win);

  el.addEventListener("pointerdown", () => { if (current !== win) focusWin(win); }, true);
  $(".max", el).addEventListener("click", () => el.classList.toggle("maxed"));
  $(".close", el).addEventListener("click", () => closeWin(win));

  const bar = $(".bar", el);
  let sx, sy, ox, oy;
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button") || el.classList.contains("maxed")) return;
    bar.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY;
    ox = el.offsetLeft; oy = el.offsetTop;
  });
  bar.addEventListener("pointermove", (e) => {
    if (!bar.hasPointerCapture(e.pointerId)) return;
    el.style.left = clamp(ox + e.clientX - sx, 120 - el.offsetWidth, desktop.clientWidth - 120) + "px";
    el.style.top = clamp(oy + e.clientY - sy, 0, desktop.clientHeight - 60) + "px";
  });
  bar.addEventListener("dblclick", (e) => {
    if (!e.target.closest("button")) el.classList.toggle("maxed");
  });
}

/* ================= toolbar: back / forward / reload / open in tab ================= */
function syncToolbar() {
  const w = current;
  const live = !!(w && w.frame);
  const s = w && w.state;
  btn.back.disabled = !(live && s && s.canBack);
  btn.forward.disabled = !(live && s && s.canForward);
  btn.reload.disabled = !live;
  btn.newtab.disabled = !live;
  if (!w) address.textContent = "Desktop";
  else if (!w.frame) address.textContent = w.app.name;
  else address.textContent = s ? (s.title || s.url) : w.app.name;
  address.title = live && s ? s.url : "";
}

function send(cmd) {
  const w = current;
  if (!w || !w.frame) return;
  w.frame.contentWindow.postMessage({ desktop: true, cmd }, "*");
}

btn.back.addEventListener("click", () => send("back"));
btn.forward.addEventListener("click", () => send("forward"));
btn.reload.addEventListener("click", () => {
  const w = current;
  if (!w || !w.frame) return;
  send("reload");
  setTimeout(() => { if (!w.state) w.frame.src = w.app.url; }, 800);
});
btn.newtab.addEventListener("click", () => {
  const w = current;
  if (!w || !w.frame) return;
  window.open((w.state && w.state.url) || w.app.openUrl || w.app.url, "_blank");
});

window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.desktop !== true || d.type !== "state") return;
  for (const w of open.values()) {
    if (w.frame && w.frame.contentWindow === e.source) {
      w.state = { url: d.url, title: d.title, canBack: d.canBack, canForward: d.canForward };
      if (w === current) syncToolbar();
      break;
    }
  }
});

/* ================= apps / extensions menu (🧩) ================= */
function renderAppsMenu() {
  appsMenu.replaceChildren();
  apps.forEach((app) => {
    const b = document.createElement("button");
    const t = document.createElement("span");
    t.textContent = app.name;
    b.append(makeIcon(app), t);
    b.addEventListener("click", () => openApp(app));
    appsMenu.append(b);
  });
  appsMenu.append(document.createElement("hr"));
  const manage = document.createElement("button");
  manage.innerHTML = '<div class="emoji">⚙️</div><span>Chrome extensions</span>';
  manage.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions" });
    closeMenus();
  });
  appsMenu.append(manage);
}
btn.ext.addEventListener("click", () => { appsMenu.hidden = !appsMenu.hidden; });

/* ================= right-click menu ================= */
const ctx = $("#ctx");

function showMenu(x, y, items) {
  ctx.replaceChildren();
  items.forEach((it) => {
    if (it === "-") {
      ctx.append(document.createElement("hr"));
      return;
    }
    const b = document.createElement("button");
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    if (it.danger) b.className = "danger";
    b.addEventListener("click", () => { hideCtx(); it.run(); });
    ctx.append(b);
  });
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  ctx.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
}
function hideCtx() { ctx.hidden = true; }
function closeMenus() { hideCtx(); appsMenu.hidden = true; }

let wallpaperSet = false;

function desktopItems(x, y) {
  return [
    { label: "Change wallpaper…", run: () => $("#wallPick").click() },
    { label: "Reset wallpaper", disabled: !wallpaperSet, run: resetWallpaper },
    "-",
    { label: "New shortcut…", run: () => openDialog(null, { x, y }) },
  ];
}

function cardItems(app) {
  return [
    { label: "Open", run: () => openApp(app) },
    { label: "Edit…", disabled: !app.url, run: () => openDialog(app) },
    { label: "Change icon…", run: () => { iconTarget = app; $("#iconPick").click(); } },
    { label: "Reset icon", disabled: !app.icon, run: () => { delete app.icon; refreshApps(); } },
    "-",
    { label: "Delete", danger: true, disabled: !!app.builtin, run: () => deleteApp(app) },
  ];
}

document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea")) return; // keep normal menu in text fields
  e.preventDefault();
  const card = e.target.closest(".tap");
  if (card) {
    const app = apps.find((a) => a.id === card.dataset.id);
    if (app) showMenu(e.clientX, e.clientY, cardItems(app));
    return;
  }
  if (e.target.closest("#toolbar, #apps, #ctx, #dialogWrap, .win")) return;
  showMenu(e.clientX, e.clientY, desktopItems(e.clientX, e.clientY));
});

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#ctx")) hideCtx();
  if (!e.target.closest("#apps, #ext")) appsMenu.hidden = true;
});
window.addEventListener("blur", hideCtx);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeMenus(); hideDialog(); }
});

/* ================= add / edit / delete shortcuts ================= */
const dlg = {
  wrap: $("#dialogWrap"), form: $("#dialog"), title: $("#dTitle"),
  name: $("#dName"), url: $("#dUrl"), err: $("#dErr"),
};
let editing = null, spawn = null, iconTarget = null;

function openDialog(app, pos) {
  editing = app;
  spawn = pos || null;
  dlg.title.textContent = app ? "Edit shortcut" : "New shortcut";
  dlg.name.value = app ? app.name : "";
  dlg.url.value = app ? app.url : "";
  dlg.err.textContent = "";
  dlg.wrap.hidden = false;
  (app ? dlg.name : dlg.url).focus();
}
function hideDialog() { dlg.wrap.hidden = true; }

$("#dCancel").addEventListener("click", hideDialog);
dlg.wrap.addEventListener("pointerdown", (e) => { if (e.target === dlg.wrap) hideDialog(); });

dlg.form.addEventListener("submit", (e) => {
  e.preventDefault();
  let raw = dlg.url.value.trim();
  if (!raw) { dlg.err.textContent = "Enter a website address."; return; }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = "https://" + raw;
  let u;
  try { u = new URL(raw); } catch { dlg.err.textContent = "That address is not valid."; return; }
  if (!/^https?:$/.test(u.protocol)) { dlg.err.textContent = "Only http and https addresses work."; return; }
  const name = dlg.name.value.trim() || u.hostname.replace(/^www\./, "").split(".")[0];

  if (editing) {
    const changed = editing.url !== u.href;
    editing.name = name;
    editing.url = u.href;
    if (changed) delete editing.openUrl;
    const w = open.get(editing.id);
    if (w && changed) closeWin(w);
    else if (w) $(".title", w.el).textContent = name;
  } else {
    const p = spawn
      ? {
          x: clamp(spawn.x - 40, 0, Math.max(0, desktop.clientWidth - 130)),
          y: clamp(spawn.y - 40, 0, Math.max(0, desktop.clientHeight - 150)),
        }
      : slot(apps.length);
    apps.push({ id: "app_" + Date.now().toString(36), name, url: u.href, x: p.x, y: p.y });
  }
  hideDialog();
  refreshApps();
});

function deleteApp(app) {
  const w = open.get(app.id);
  if (w) closeWin(w);
  apps = apps.filter((a) => a !== app);
  refreshApps();
}

function refreshApps() {
  saveApps();
  renderCards();
  renderAppsMenu();
}

/* ================= pictures: wallpaper + custom icons ================= */
async function readImage(file, { max, square, type, q }) {
  const bmp = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height, w, h;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
    w = h = max;
  } else {
    const k = Math.min(1, max / Math.max(sw, sh));
    w = Math.round(sw * k); h = Math.round(sh * k);
  }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  bmp.close();
  return c.toDataURL(type, q);
}

function applyWallpaper(dataUrl) {
  document.body.style.backgroundImage = `url("${dataUrl}")`;
  wallpaperSet = true;
}
function resetWallpaper() {
  document.body.style.backgroundImage = "";
  wallpaperSet = false;
  store.remove("wallpaper");
}

$("#wallPick").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const url = await readImage(f, { max: 1920, type: "image/jpeg", q: 0.85 });
    await store.set("wallpaper", url);
    applyWallpaper(url);
  } catch {
    alert("Could not read that picture. Try a JPG or PNG.");
  }
});

$("#iconPick").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !iconTarget) return;
  try {
    iconTarget.icon = await readImage(f, { max: 128, square: true, type: "image/png" });
    refreshApps();
  } catch {
    alert("Could not read that picture. Try a JPG or PNG.");
  }
});

/* ================= clock ================= */
function updateClock() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  $("#now").textContent = `${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())}`;
  $("#now2").textContent = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
updateClock();
setInterval(updateClock, 1000);

/* ================= goals note ================= */
async function buildGoals(body) {
  let goals = (await store.get("goals")) || [];
  body.classList.add("goals");
  body.innerHTML = `
    <h2>My goals</h2>
    <p class="count"></p>
    <ul></ul>
    <div class="add">
      <input placeholder="Write a goal and press Enter" maxlength="120">
      <button>Add goal</button>
    </div>`;
  const ul = $("ul", body);
  const count = $(".count", body);
  const input = $("input", body);
  const save = () => store.set("goals", goals);

  function render() {
    ul.replaceChildren();
    goals.forEach((g, i) => {
      const li = document.createElement("li");
      li.classList.toggle("done", g.done);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = g.done;
      cb.addEventListener("change", () => { g.done = cb.checked; save(); render(); });

      const text = document.createElement("span");
      text.textContent = g.text;

      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "Delete goal";
      del.addEventListener("click", () => { goals.splice(i, 1); save(); render(); });

      li.append(cb, text, del);
      ul.append(li);
    });
    const done = goals.filter((g) => g.done).length;
    count.textContent = goals.length
      ? `${done} of ${goals.length} done`
      : "No goals yet. Add the first thing you want to reach.";
  }

  function add() {
    const text = input.value.trim();
    if (!text) return;
    goals.push({ text, done: false });
    input.value = "";
    save();
    render();
  }
  $(".add button", body).addEventListener("click", add);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  render();
}

/* ================= start ================= */
(async () => {
  await loadApps();
  const wp = await store.get("wallpaper");
  if (wp) applyWallpaper(wp);
  renderCards();
  renderAppsMenu();
  syncToolbar();
})();
