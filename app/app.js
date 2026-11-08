// CRM персонального тренера — інтерфейс
(function () {
  const API_URL = (window.TRAINER_API || "").trim();
  const DEMO = !API_URL;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const D = (day) => new Date(day + "T12:00:00");
  const addDays = (day, n) => { const d = D(day); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());
  const weekStart = (day) => addDays(day, -((D(day).getDay() + 6) % 7));
  const monthStart = (day) => day.slice(0, 8) + "01";
  const monthEnd = (day) => { const d = D(monthStart(day)); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); };
  const WD = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const WDL = ["неділя", "понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота"];
  const MON = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
  const MONN = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
  const dLong = (day) => { const d = D(day); return `${d.getDate()} ${MON[d.getMonth()]}`; };
  const dShort = (day) => { const d = D(day); return `${d.getDate()}.${pad(d.getMonth() + 1)}`; };
  const num = (x) => Math.round(Number(x) || 0).toLocaleString("uk-UA").replace(/ /g, " ");
  const KIND = { personal: "Персональне", split: "Спліт", group: "Група" };
  const PAY = { paid: "Оплачено", debt: "Борг", package: "Абонемент" };
  const ICON = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c2 .6 3.2 2.3 3.5 5.2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // ───── API ─────
  let token = localStorage.getItem("trainer-token") || "";
  async function call(action, body = {}) {
    if (DEMO) return window.DemoBackend.call(action, body);
    let r;
    try {
      r = await fetch(API_URL, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ action, ...body, ...(token ? {} : { _app: location.origin + location.pathname }) }) });
    } catch { return { ok: false, error: "Немає зʼєднання з сервером. Перевірте інтернет." }; }
    const j = await r.json().catch(() => ({ ok: false, error: "Помилка сервера" }));
    if (j.error === "auth") { token = ""; localStorage.removeItem("trainer-token"); showLogin(); }
    return j;
  }
  async function must(action, body) {
    const j = await call(action, body);
    if (!j.ok) { if (j.error !== "auth") toast(j.error || "Помилка", true); throw new Error(j.error); }
    return j;
  }

  // ───── Стан ─────
  const st = { tab: "schedule", mode: "day", date: today(), clients: [], packages: [], settings: {}, q: "", statsPeriod: "month", statsDate: today(), clientId: null };
  const clientById = (id) => st.clients.find((c) => c.id === id);
  const sessTotal = (s) => (s.status === "cancelled" ? 0 : s.participants.reduce((a, p) => a + Number(p.price), 0) + Number(s.extra_amount || 0));
  const sessWho = (s) => s.kind === "group"
    ? `${s.title || "Група"}${s.participants.length ? ` · ${s.participants.length} уч.` : ""}`
    : s.participants.map((p) => p.name).join(", ") || s.title || "Тренування";
  const initials = (n) => n.split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();

  async function refreshBase() {
    const j = await must("bootstrap");
    st.clients = j.clients; st.packages = j.packages; st.settings = j.settings;
  }

  // ───── Каркас ─────
  const root = document.getElementById("app");
  function toast(msg, bad = false) {
    const t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : ""); t.textContent = msg; t.setAttribute("role", "status");
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  function shell(inner, opts = {}) {
    root.innerHTML = `
      ${DEMO ? '<div class="demo-banner">Демо-режим: дані зберігаються лише на цьому пристрої</div>' : ""}
      <div class="app">${inner}</div>
      ${opts.fab ? `<button class="fab" data-act="${opts.fab.act}">${ICON.plus}${esc(opts.fab.label)}</button>` : ""}
      <nav class="nav" aria-label="Розділи"><div class="nav-in">
        ${[["schedule", "Розклад", ICON.cal], ["clients", "Клієнти", ICON.people], ["stats", "Статистика", ICON.chart], ["more", "Ще", ICON.more]]
          .map(([k, l, i]) => `<button data-tab="${k}" ${st.tab === k ? 'aria-current="page"' : ""}>${i}${l}</button>`).join("")}
      </div></nav>`;
  }
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-act]");
    if (!t) return;
    if (t.dataset.tab) { st.tab = t.dataset.tab; st.clientId = null; render(); window.scrollTo(0, 0); return; }
    const fn = handlers[t.dataset.act];
    if (fn) fn(t.dataset, t);
  });

  // ───── Розклад ─────
  function periodRange() {
    if (st.mode === "day") return [st.date, st.date];
    if (st.mode === "week") { const f = weekStart(st.date); return [f, addDays(f, 6)]; }
    const f = weekStart(monthStart(st.date)), l = addDays(weekStart(monthEnd(st.date)), 6);
    return [f, l];
  }
  function periodLabel() {
    const d = D(st.date);
    if (st.mode === "day") {
      const rel = st.date === today() ? "Сьогодні" : st.date === addDays(today(), 1) ? "Завтра" : st.date === addDays(today(), -1) ? "Вчора" : null;
      return `${rel ?? dLong(st.date)}<small>${rel ? dLong(st.date) + ", " : ""}${WDL[d.getDay()]}</small>`;
    }
    if (st.mode === "week") { const f = weekStart(st.date), l = addDays(f, 6); return `${dShort(f)} – ${dShort(l)}<small>тиждень</small>`; }
    return `${MONN[d.getMonth()]}<small>${d.getFullYear()}</small>`;
  }
  async function renderSchedule() {
    shell(`
      <header class="top">
        <div class="top-row"><h1 class="title">Розклад</h1><button class="chip-btn" data-act="goToday">Сьогодні</button></div>
        <div class="seg" role="group" aria-label="Період">
          ${[["day", "День"], ["week", "Тиждень"], ["month", "Місяць"]].map(([k, l]) => `<button data-act="mode" data-mode="${k}" aria-pressed="${st.mode === k}">${l}</button>`).join("")}
        </div>
        <div class="datebar">
          <button class="icon-btn" data-act="shift" data-n="-1" aria-label="Назад">${ICON.left}</button>
          <div class="label">${periodLabel()}</div>
          <button class="icon-btn" data-act="shift" data-n="1" aria-label="Вперед">${ICON.right}</button>
        </div>
      </header>
      <div id="sched"><div class="loading">Завантаження…</div></div>`, { fab: { act: "newSession", label: "Тренування" } });
    const [from, to] = periodRange();
    const j = await must("range", { from, to });
    const box = $("#sched");
    if (!box) return;
    const ss = j.sessions;
    if (st.mode === "day") box.innerHTML = dayView(ss);
    else if (st.mode === "week") box.innerHTML = weekView(ss);
    else box.innerHTML = monthView(ss);
  }
  function totalBlock(ss, label) {
    const ok = ss.filter((s) => s.status !== "cancelled");
    const sum = ok.reduce((a, s) => a + sessTotal(s), 0);
    const debt = ok.flatMap((s) => s.participants).filter((p) => p.pay === "debt").reduce((a, p) => a + Number(p.price), 0);
    const people = new Set(ok.flatMap((s) => s.participants.map((p) => p.client_id))).size;
    return `<div class="total">
      <div><div class="sum">${num(sum)}<span>грн</span></div></div>
      <div class="meta">${label}<br><b>${ok.length}</b> трен. · <b>${people}</b> клієнт.${debt ? `<br><span style="color:var(--plate-red)">борг ${num(debt)} грн</span>` : ""}</div>
    </div>`;
  }
  function sessCard(s) {
    const tags = [];
    if (s.status === "no_show") tags.push('<span class="tag noshow">не прийшов</span>');
    if (s.participants.some((p) => p.pay === "debt")) tags.push('<span class="tag debt">борг</span>');
    if (s.participants.some((p) => p.pay === "package")) tags.push('<span class="tag pkg">абонемент</span>');
    if (s.moves && s.moves.length) tags.push(`<span class="tag moved">перенесено з ${s.moves[s.moves.length - 1].from_time}</span>`);
    const sub = [s.kind !== "personal" ? KIND[s.kind] : `${s.duration_min} хв`, ...tags];
    return `<button class="sess ${s.kind} ${s.status}" data-act="editSession" data-id="${s.id}">
      <div class="time">${s.start_time}<small>${s.duration_min} хв</small></div>
      <div class="body"><div class="who">${esc(sessWho(s))}</div><div class="sub">${sub.join(" ")}</div></div>
      <div class="price">${num(sessTotal(s) || (s.status === "cancelled" ? s.participants.reduce((a, p) => a + p.price, 0) + Number(s.extra_amount) : 0))}</div>
    </button>`;
  }
  function dayView(ss) {
    if (!ss.length) return `${totalBlock(ss, "за день")}<div class="empty"><b>День вільний</b>Натисніть «Тренування», щоб записати клієнта.</div>`;
    return `${totalBlock(ss, "за день")}<div class="day-list">${ss.map(sessCard).join("")}</div>`;
  }
  function weekView(ss) {
    const f = weekStart(st.date);
    let html = totalBlock(ss, "за тиждень") + '<div class="week">';
    for (let i = 0; i < 7; i++) {
      const day = addDays(f, i), ds = ss.filter((s) => s.day === day), sum = ds.reduce((a, s) => a + sessTotal(s), 0);
      html += `<button class="wday ${day === today() ? "today" : ""}" data-act="openDay" data-day="${day}">
        <div class="wday-h"><span class="d">${WD[D(day).getDay()]}, ${D(day).getDate()}<small>${ds.filter((s) => s.status !== "cancelled").length || ""}${ds.length ? " трен." : ""}</small></span><span class="s">${sum ? num(sum) + " грн" : ""}</span></div>
        ${ds.length ? `<ul>${ds.map((s) => `<li class="${s.kind} ${s.status}"><span class="t">${s.start_time}</span><span class="n">${esc(sessWho(s))}</span><span>${num(sessTotal(s))}</span></li>`).join("")}</ul>` : '<div class="none">Немає тренувань</div>'}
      </button>`;
    }
    return html + "</div>";
  }
  function monthView(ss) {
    const ms = monthStart(st.date), me = monthEnd(st.date);
    const inMonth = ss.filter((s) => s.day >= ms && s.day <= me);
    const [from, to] = periodRange();
    const sums = {}; let max = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const ds = ss.filter((s) => s.day === d && s.status !== "cancelled");
      sums[d] = { n: ds.length, v: ds.reduce((a, s) => a + sessTotal(s), 0) };
      if (d >= ms && d <= me) max = Math.max(max, sums[d].v);
    }
    let html = totalBlock(inMonth, "за місяць") + '<div class="month"><div class="mgrid">' + ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((w) => `<div class="wd">${w}</div>`).join("");
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const x = sums[d], out = d < ms || d > me;
      html += `<button class="mcell ${out ? "out" : ""} ${d === today() ? "today" : ""}" data-act="openDay" data-day="${d}" aria-label="${dLong(d)}: ${x.n} тренувань, ${num(x.v)} грн">
        <span class="n">${D(d).getDate()}</span>${!out && x.n ? `<span class="c">${x.n} трен.</span><span class="v">${num(x.v)}</span><span class="bar" style="width:${max ? Math.max(12, (x.v / max) * 100) : 0}%"></span>` : ""}
      </button>`;
    }
    return html + "</div></div>";
  }

  // ───── Редактор тренування ─────
  let draft = null;
  function openSheet(html, onMount) {
    closeSheet();
    const bg = document.createElement("div");
    bg.className = "sheet-bg"; bg.id = "sheet";
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
    bg.addEventListener("click", (e) => { if (e.target === bg) closeSheet(); });
    bg.addEventListener("click", (e) => { const t = e.target.closest("[data-act]"); if (t && handlers[t.dataset.act]) { e.stopPropagation(); handlers[t.dataset.act](t.dataset, t); } });
    document.body.appendChild(bg);
    document.body.style.overflow = "hidden";
    if (onMount) onMount(bg);
  }
  // Підтвердження всередині додатку (без системних діалогів)
  let pendingConfirm = null;
  function askConfirm(text, okLabel, fn) {
    pendingConfirm = fn;
    openSheet(`<h2>Підтвердіть</h2><p style="margin:0 0 16px">${esc(text)}</p>
      <div class="foot"><button class="btn light" data-act="close">Скасувати</button><button class="btn red" data-act="confirmOk">${esc(okLabel)}</button></div>`);
  }
  function closeSheet() { const s = $("#sheet"); if (s) s.remove(); document.body.style.overflow = ""; }

  function sessionSheet(s) {
    draft = s ? JSON.parse(JSON.stringify(s)) : { id: null, day: st.date, start_time: nextFreeTime(), duration_min: 60, kind: "personal", title: "", extra_amount: 0, note: "", status: "planned", participants: [] };
    drawSessionSheet();
  }
  function nextFreeTime() { const h = new Date().getHours() + 1; return `${pad(Math.min(21, Math.max(8, h)))}:00`; }
  function drawSessionSheet() {
    const s = draft, isNew = !s.id;
    const total = s.participants.reduce((a, p) => a + (p.pay === "package" ? pkgUnit(p.client_id, p.package_id) : Number(p.price) || 0), 0) + (s.kind === "group" ? Number(s.extra_amount) || 0 : 0);
    openSheet(`
      <h2>${isNew ? "Нове тренування" : "Тренування"}<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
      <div class="row3">
        <label class="field"><span>Дата</span><input type="date" id="f-day" value="${s.day}"></label>
        <label class="field"><span>Час</span><input type="time" id="f-time" value="${s.start_time}" step="300"></label>
        <label class="field"><span>Хвилин</span><input type="number" id="f-dur" value="${s.duration_min}" min="10" step="5" inputmode="numeric"></label>
      </div>
      <div class="kinds" role="group" aria-label="Тип">${Object.entries(KIND).map(([k, l]) => `<button data-act="kind" data-kind="${k}" aria-pressed="${s.kind === k}">${l}</button>`).join("")}</div>
      ${s.kind === "group" ? `<div class="row2">
        <label class="field"><span>Назва групи</span><input id="f-title" value="${esc(s.title || "")}" placeholder="Група"></label>
        <label class="field"><span>Сума без імен, грн</span><input id="f-extra" type="number" inputmode="decimal" value="${Number(s.extra_amount) || ""}" placeholder="0"></label>
      </div>` : ""}
      <div class="parts">${s.participants.map((p, i) => partRow(p, i)).join("")}</div>
      ${(s.kind === "personal" && s.participants.length >= 1) ? '<button class="btn light wide" style="margin-bottom:12px" data-act="addMore">+ Додати ще клієнта (спліт)</button>' : pickerHtml()}
      <label class="field"><span>Нотатка</span><textarea id="f-note" rows="2" placeholder="Що робили, самопочуття…">${esc(s.note || "")}</textarea></label>
      <div class="sum-line"><span>Вартість</span><b>${num(total)} грн</b></div>
      <div class="foot"><button class="btn blue" data-act="saveSession">${isNew ? "Записати" : "Зберегти"}</button></div>
      ${isNew ? "" : `<div class="more-actions">
        <button class="btn light" data-act="moveSession">Перенести</button>
        ${s.status === "planned" ? '<button class="btn light" data-act="statusSession" data-status="no_show">Не прийшов</button>' : '<button class="btn light" data-act="statusSession" data-status="planned">Відновити</button>'}
        ${s.status !== "cancelled" ? '<button class="btn red" data-act="statusSession" data-status="cancelled">Скасувати</button>' : ""}
        <button class="btn red" data-act="deleteSession">Видалити</button>
      </div>`}`, (bg) => {
      const q = $("#pick-q", bg);
      if (q) { q.addEventListener("input", () => { $("#pick-list", bg).innerHTML = pickList(q.value); }); }
      bg.addEventListener("input", (e) => {
        const t = e.target;
        if (t.dataset.price != null) { draft.participants[+t.dataset.price].price = t.value; updateSum(bg); }
        if (t.id === "f-extra") { draft.extra_amount = t.value; updateSum(bg); }
      });
    });
  }
  function updateSum(bg) {
    syncDraft();
    const s = draft;
    const total = s.participants.reduce((a, p) => a + (p.pay === "package" ? pkgUnit(p.client_id, p.package_id) : Number(p.price) || 0), 0) + (s.kind === "group" ? Number(s.extra_amount) || 0 : 0);
    const b = $(".sum-line b", bg); if (b) b.textContent = `${num(total)} грн`;
  }
  function activePkg(cid) {
    return st.packages.filter((p) => p.client_id === cid && (!p.expires_on || p.expires_on >= today()) && p.used < p.sessions_total).sort((a, b) => (a.bought_on < b.bought_on ? -1 : 1))[0];
  }
  function pkgUnit(cid, pkgId) {
    const p = (pkgId && st.packages.find((x) => x.id === pkgId)) || activePkg(cid);
    return p ? Math.round((p.price / p.sessions_total) * 100) / 100 : 0;
  }
  function partRow(p, i) {
    const c = clientById(p.client_id) || { name: p.name };
    const pk = activePkg(p.client_id) || (p.package_id && st.packages.find((x) => x.id === p.package_id));
    return `<div class="part">
      <div class="part-h"><span>${esc(c.name)}${pk ? ` <span class="tag pkg">абон. ${pk.sessions_total - pk.used} з ${pk.sessions_total}</span>` : ""}</span><button data-act="rmPart" data-i="${i}" aria-label="Прибрати">${ICON.close.replace('stroke-width="2.2"', 'stroke-width="2" width="18" height="18"')}</button></div>
      <div class="part-r">
        <input type="number" inputmode="decimal" data-price="${i}" value="${p.pay === "package" ? pkgUnit(p.client_id, p.package_id) : p.price}" ${p.pay === "package" ? "disabled" : ""} aria-label="Ціна">
        <div class="pay" role="group" aria-label="Оплата">${Object.entries(PAY).map(([k, l]) => `<button data-act="pay" data-i="${i}" data-pay="${k}" aria-pressed="${p.pay === k}">${l}</button>`).join("")}</div>
      </div>
    </div>`;
  }
  function pickerHtml() {
    return `<div class="picker"><input id="pick-q" placeholder="${draft.participants.length ? "Додати ще клієнта" : "Знайти клієнта або ввести нове імʼя"}" autocomplete="off"><ul id="pick-list">${pickList("")}</ul></div>`;
  }
  function pickList(q) {
    const taken = new Set(draft.participants.map((p) => p.client_id));
    const ql = q.trim().toLowerCase();
    const list = st.clients.filter((c) => !c.archived && !taken.has(c.id) && (!ql || c.name.toLowerCase().includes(ql) || (c.phone || "").includes(ql)))
      .sort((a, b) => (b.visits || 0) - (a.visits || 0)).slice(0, ql ? 20 : 6);
    let html = list.map((c) => `<li><button data-act="addPart" data-id="${c.id}"><span>${esc(c.name)}</span><small>${c.price ? num(c.price) + " грн" : ""}</small></button></li>`).join("");
    if (ql && !st.clients.some((c) => c.name.toLowerCase() === ql)) html += `<li><button class="add-new" data-act="quickClient" data-name="${esc(q.trim())}">+ Новий клієнт «${esc(q.trim())}»</button></li>`;
    return html || '<li><button disabled><small>Почніть вводити імʼя</small></button></li>';
  }
  function syncDraft() {
    if (!draft) return;
    const v = (id) => { const el = $("#" + id); return el ? el.value : undefined; };
    if (v("f-day") !== undefined) draft.day = v("f-day");
    if (v("f-time") !== undefined) draft.start_time = v("f-time");
    if (v("f-dur") !== undefined) draft.duration_min = Number(v("f-dur")) || 60;
    if (v("f-title") !== undefined) draft.title = v("f-title");
    if (v("f-extra") !== undefined) draft.extra_amount = v("f-extra");
    if (v("f-note") !== undefined) draft.note = v("f-note");
  }
  function addParticipant(c) {
    const pk = activePkg(c.id);
    draft.participants.push({ client_id: c.id, name: c.name, price: c.price || 0, pay: pk ? "package" : "paid", package_id: null });
    if (draft.kind === "personal" && draft.participants.length === 2) draft.kind = "split";
  }

  // ───── Клієнти ─────
  function renderClients() {
    if (st.clientId) return renderClient(st.clientId);
    const q = st.q.trim().toLowerCase();
    const list = st.clients.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "~"));
    const act = list.filter((c) => !c.archived), arch = list.filter((c) => c.archived);
    const row = (c) => {
      const pk = activePkg(c.id);
      return `<button class="crow" data-act="openClient" data-id="${c.id}">
        <span class="ava">${esc(initials(c.name))}</span>
        <span><span class="nm">${esc(c.name)}</span><br><span class="ph">${esc(c.phone || "без телефону")}</span></span>
        <span class="rt"><b>${c.price ? num(c.price) : "—"}</b>${Number(c.debt) ? `<span class="tag debt">борг ${num(c.debt)}</span>` : pk ? `<span class="tag pkg">${pk.sessions_total - pk.used} з ${pk.sessions_total}</span>` : `<span>${c.visits || 0} трен.</span>`}</span>
      </button>`;
    };
    shell(`
      <header class="top"><div class="top-row"><h1 class="title">Клієнти</h1><span style="color:var(--muted);font-weight:600">${act.length}</span></div>
        <label class="search">${ICON.search}<input id="cq" type="search" placeholder="Імʼя або телефон" value="${esc(st.q)}" aria-label="Пошук клієнтів"></label>
      </header>
      <div class="clients">${act.map(row).join("") || `<div class="empty"><b>${q ? "Нікого не знайдено" : "Поки що немає клієнтів"}</b>${q ? "Спробуйте інше імʼя або номер." : "Додайте першого клієнта кнопкою нижче."}</div>`}</div>
      ${arch.length ? `<div class="section-h">Архів</div><div class="clients">${arch.map(row).join("")}</div>` : ""}`, { fab: { act: "newClient", label: "Клієнт" } });
    const inp = $("#cq");
    inp.addEventListener("input", () => { st.q = inp.value; const pos = inp.selectionStart; renderClients(); const n = $("#cq"); n.focus(); n.setSelectionRange(pos, pos); });
  }
  async function renderClient(id) {
    const c = clientById(id);
    if (!c) { st.clientId = null; return renderClients(); }
    shell(`<header class="top"><div class="top-row"><button class="icon-btn" data-act="backClients" aria-label="Назад">${ICON.left}</button><h1 class="title">${esc(c.name)}</h1><button class="chip-btn" data-act="editClient" data-id="${c.id}">Змінити</button></div></header><div id="cbox"><div class="loading">Завантаження…</div></div>`,
      { fab: { act: "newSessionFor", label: "Записати" } });
    const j = await must("client_history", { id });
    const box = $("#cbox"); if (!box) return;
    const ok = j.history.filter((h) => h.status !== "cancelled");
    const spent = ok.reduce((a, h) => a + Number(h.price), 0);
    const debts = j.history.filter((h) => h.pay === "debt" && h.status !== "cancelled");
    const tel = (c.phone || "").replace(/[^\d+]/g, "");
    const intl = tel.startsWith("0") ? "+38" + tel : tel;
    box.innerHTML = `
      <div class="card">
        <div class="kv"><div><b>${ok.length}</b><span>тренувань</span></div><div><b>${num(spent)}</b><span>грн усього</span></div><div><b>${j.moves}</b><span>переносів</span></div></div>
        ${tel ? `<div class="actions" style="margin-top:12px"><a class="btn light" href="tel:${esc(intl)}">${ICON.phone}${esc(c.phone)}</a><a class="btn light" href="viber://chat?number=${esc(intl.replace("+", "%2B"))}">Viber</a><a class="btn light" href="https://t.me/${esc(intl)}" target="_blank" rel="noopener">Telegram</a></div>` : ""}
        <div style="margin-top:10px;color:var(--muted);font-size:14px">Стандартна ціна: <b style="color:var(--ink)">${c.price ? num(c.price) + " грн" : "не задана"}</b></div>
      </div>
      ${debts.length ? `<div class="card"><h3>Борг: ${num(debts.reduce((a, h) => a + Number(h.price), 0))} грн</h3><ul class="hist">${debts.map((h) => `<li><span>${dLong(h.day)}, ${h.start_time}</span><button class="btn light" style="height:34px" data-act="payDebt" data-id="${h.part_id}">Оплачено · ${num(h.price)}</button></li>`).join("")}</ul></div>` : ""}
      <div class="card"><h3>Абонементи</h3>
        ${j.packages.length ? j.packages.map((p) => `<button class="pkg" data-act="editPackage" data-id="${p.id}">
          <span style="min-width:96px"><b>${esc(p.title || p.sessions_total + " трен.")}</b><br><small style="color:var(--muted)">${num(p.price)} грн · ${dShort(p.bought_on)}${p.paid ? "" : " · не оплачено"}</small></span>
          <span class="plates" aria-label="Використано ${p.used} з ${p.sessions_total}">${Array.from({ length: p.sessions_total }, (_, i) => `<i class="${i < p.used ? "u" : ""}"></i>`).join("")}</span>
          <b>${p.sessions_total - p.used}</b></button>`).join("") : '<div style="color:var(--muted);font-size:14px;margin-bottom:8px">Абонементів немає</div>'}
        <button class="btn light wide" style="margin-top:8px" data-act="newPackage">Продати абонемент</button>
      </div>
      <div class="card"><h3>Програма та нотатки</h3><div class="notes">${c.notes ? esc(c.notes) : '<span style="color:var(--muted)">Додайте програму тренувань, побажання чи обмеження — кнопка «Змінити».</span>'}</div></div>
      <div class="card"><h3>Нагадування в Telegram</h3>
        <div style="font-size:14px;color:var(--muted);margin-bottom:10px">${c.tg_linked ? "✅ Клієнт підключив нагадування." : c.phone ? "Надішліть клієнту посилання — бот попросить підтвердити номер " + esc(c.phone) + " і нагадуватиме про тренування й переноси." : "Спершу вкажіть номер телефону клієнта — бот підключиться лише з цим номером."}</div>
        <button class="btn light wide" data-act="clientLink" data-id="${c.id}">${c.tg_linked ? "Посилання ще раз" : "Отримати посилання для клієнта"}</button>
        ${c.tg_linked ? `<button class="btn light wide" style="margin-top:8px" data-act="clientUnlink" data-id="${c.id}">Відʼєднати Telegram</button>` : ""}
      </div>
      <div class="card"><h3>Історія</h3>${j.history.length ? `<ul class="hist">${j.history.slice(0, 60).map((h) => `<li><span>${dLong(h.day)} ${h.start_time} ${h.kind !== "personal" ? `<span class="tag moved">${KIND[h.kind]}</span>` : ""} ${h.status === "cancelled" ? '<span class="tag moved">скасовано</span>' : h.status === "no_show" ? '<span class="tag noshow">не прийшов</span>' : ""} ${h.pay === "debt" ? '<span class="tag debt">борг</span>' : h.pay === "package" ? '<span class="tag pkg">абонемент</span>' : ""}</span><span class="p">${num(h.price)}</span></li>`).join("")}</ul>` : '<div style="color:var(--muted);font-size:14px">Ще не тренувався</div>'}</div>
      <div style="padding:0 16px"><button class="btn light wide" data-act="archiveClient" data-id="${c.id}">${c.archived ? "Повернути з архіву" : "Перенести в архів"}</button></div>`;
  }
  function clientSheet(c) {
    const x = c || { name: "", phone: "", price: "", notes: "", remind: true };
    openSheet(`
      <h2>${c ? "Клієнт" : "Новий клієнт"}<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
      <label class="field"><span>Імʼя та прізвище</span><input id="c-name" value="${esc(x.name)}" autocomplete="off"></label>
      <div class="row2">
        <label class="field"><span>Телефон</span><input id="c-phone" type="tel" value="${esc(x.phone || "")}" placeholder="050 123 45 67"></label>
        <label class="field"><span>Ціна тренування, грн</span><input id="c-price" type="number" inputmode="decimal" value="${x.price ?? ""}" placeholder="400"></label>
      </div>
      <label class="field"><span>Програма, нотатки</span><textarea id="c-notes" rows="5" placeholder="Цілі, вправи, обмеження">${esc(x.notes || "")}</textarea></label>
      <label class="toggle"><input type="checkbox" id="c-remind" ${x.remind !== false ? "checked" : ""}> Нагадувати в Telegram</label>
      <div class="foot"><button class="btn blue" data-act="saveClient" data-id="${c ? c.id : ""}">Зберегти</button></div>`, (bg) => { if (!c) $("#c-name", bg).focus(); });
  }
  function packageSheet(p, clientId) {
    const x = p || { client_id: clientId, title: "", sessions_total: 8, price: "", paid: true, bought_on: today(), expires_on: "" };
    const c = clientById(x.client_id);
    openSheet(`
      <h2>${p ? "Абонемент" : "Новий абонемент"}<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
      <div style="margin:-6px 0 12px;color:var(--muted)">${esc(c ? c.name : "")}</div>
      <div class="row2">
        <label class="field"><span>Тренувань</span><input id="p-n" type="number" inputmode="numeric" value="${x.sessions_total}" min="1"></label>
        <label class="field"><span>Ціна, грн</span><input id="p-price" type="number" inputmode="decimal" value="${x.price}" placeholder="${c && c.price ? c.price * 8 : 3000}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Куплено</span><input id="p-bought" type="date" value="${x.bought_on}"></label>
        <label class="field"><span>Діє до (необовʼязково)</span><input id="p-exp" type="date" value="${x.expires_on || ""}"></label>
      </div>
      <label class="field"><span>Назва (необовʼязково)</span><input id="p-title" value="${esc(x.title || "")}" placeholder="Місячний"></label>
      <label class="toggle"><input type="checkbox" id="p-paid" ${x.paid ? "checked" : ""}> Оплачено</label>
      <div class="foot"><button class="btn blue" data-act="savePackage" data-id="${p ? p.id : ""}" data-client="${x.client_id}">Зберегти</button>${p ? '<button class="btn red" data-act="deletePackage" data-id="' + p.id + '">Видалити</button>' : ""}</div>`);
  }

  // ───── Статистика ─────
  function statsRange() {
    const d = st.statsDate;
    if (st.statsPeriod === "week") { const f = weekStart(d); return [f, addDays(f, 6)]; }
    if (st.statsPeriod === "month") return [monthStart(d), monthEnd(d)];
    return [d.slice(0, 4) + "-01-01", d.slice(0, 4) + "-12-31"];
  }
  function statsLabel() {
    const [f, l] = statsRange(), d = D(st.statsDate);
    if (st.statsPeriod === "week") return `${dShort(f)} – ${dShort(l)}`;
    if (st.statsPeriod === "month") return `${MONN[d.getMonth()]} ${d.getFullYear()}`;
    return `${d.getFullYear()} рік`;
  }
  async function renderStats() {
    shell(`
      <header class="top"><div class="top-row"><h1 class="title">Статистика</h1></div>
        <div class="seg" role="group" aria-label="Період">${[["week", "Тиждень"], ["month", "Місяць"], ["year", "Рік"]].map(([k, l]) => `<button data-act="statsPeriod" data-p="${k}" aria-pressed="${st.statsPeriod === k}">${l}</button>`).join("")}</div>
        <div class="datebar"><button class="icon-btn" data-act="statsShift" data-n="-1" aria-label="Назад">${ICON.left}</button><div class="label">${statsLabel()}</div><button class="icon-btn" data-act="statsShift" data-n="1" aria-label="Вперед">${ICON.right}</button></div>
      </header><div id="sbox"><div class="loading">Рахую…</div></div>`);
    const [from, to] = statsRange();
    const j = await must("range", { from, to });
    const box = $("#sbox"); if (!box) return;
    const all = j.sessions, ok = all.filter((s) => s.status !== "cancelled");
    const income = ok.reduce((a, s) => a + sessTotal(s), 0);
    const parts = ok.flatMap((s) => s.participants.map((p) => ({ ...p, s })));
    const clientsN = new Set(parts.map((p) => p.client_id)).size;
    const debt = parts.filter((p) => p.pay === "debt").reduce((a, p) => a + Number(p.price), 0);
    const fromPkg = parts.filter((p) => p.pay === "package").reduce((a, p) => a + Number(p.price), 0);
    const cancelled = all.length - ok.length, noShow = all.filter((s) => s.status === "no_show").length;
    const moves = all.reduce((a, s) => a + (s.moves || []).length, 0);
    const avg = ok.length ? income / ok.length : 0;
    // по днях / місяцях
    let buckets = [];
    if (st.statsPeriod === "year") {
      for (let m = 0; m < 12; m++) { const key = `${from.slice(0, 4)}-${pad(m + 1)}`; buckets.push({ l: MONN[m].slice(0, 3), v: ok.filter((s) => s.day.startsWith(key)).reduce((a, s) => a + sessTotal(s), 0) }); }
    } else {
      for (let d = from; d <= to; d = addDays(d, 1)) buckets.push({ l: st.statsPeriod === "week" ? WD[D(d).getDay()] : String(D(d).getDate()), v: ok.filter((s) => s.day === d).reduce((a, s) => a + sessTotal(s), 0) });
    }
    const max = Math.max(1, ...buckets.map((b) => b.v));
    const byKind = ["personal", "split", "group"].map((k) => ({ k, v: ok.filter((s) => s.kind === k).reduce((a, s) => a + sessTotal(s), 0), n: ok.filter((s) => s.kind === k).length }));
    const colors = { personal: "var(--plate-blue)", split: "var(--plate-yellow)", group: "var(--plate-green)" };
    const top = Object.values(parts.reduce((m, p) => { const k = p.client_id; m[k] = m[k] || { name: p.name, v: 0, n: 0 }; m[k].v += Number(p.price); m[k].n++; return m; }, {})).sort((a, b) => b.v - a.v).slice(0, 8);
    // вільні вікна: найзавантаженіші години
    const hours = {}; ok.forEach((s) => { const h = s.start_time.slice(0, 2); hours[h] = (hours[h] || 0) + 1; });
    const busyHours = Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h + ":00");
    box.innerHTML = `
      <div class="total"><div><div class="sum">${num(income)}<span>грн</span></div></div><div class="meta">дохід<br><b>${ok.length}</b> трен. · <b>${clientsN}</b> клієнт.</div></div>
      <div class="stats-grid">
        <div class="stat"><b>${num(avg)}</b><span>середній чек, грн</span></div>
        <div class="stat"><b>${num(fromPkg)}</b><span>з абонементів, грн</span></div>
        <div class="stat"><b style="${debt ? "color:var(--plate-red)" : ""}">${num(debt)}</b><span>борги, грн</span></div>
        <div class="stat"><b>${moves}</b><span>переносів</span></div>
        <div class="stat"><b>${cancelled}</b><span>скасовано</span></div>
        <div class="stat"><b>${noShow}</b><span>не прийшли</span></div>
      </div>
      <div class="chart"><h3>Дохід ${st.statsPeriod === "year" ? "по місяцях" : "по днях"}</h3>
        <div class="bars">${buckets.map((b) => `<div style="height:${(b.v / max) * 100}%" title="${b.l}: ${num(b.v)} грн"></div>`).join("")}</div>
        <div class="bars-x">${buckets.map((b, i) => `<span>${buckets.length > 14 && i % 5 && i !== buckets.length - 1 ? "" : b.l}</span>`).join("")}</div>
      </div>
      <div class="chart"><h3>За типом тренувань</h3>
        <div class="split-bar">${byKind.filter((x) => x.v).map((x) => `<span style="width:${(x.v / Math.max(1, income)) * 100}%;background:${colors[x.k]}"></span>`).join("")}</div>
        <div class="legend">${byKind.map((x) => `<div><i style="background:${colors[x.k]}"></i><span>${KIND[x.k]} · ${x.n}</span><b>${num(x.v)} грн</b></div>`).join("")}</div>
      </div>
      <div class="chart"><h3>Топ клієнтів</h3>${top.length ? `<ol class="top-list">${top.map((t) => `<li><span>${esc(t.name)} · ${t.n} трен.</span><b>${num(t.v)}</b></li>`).join("")}</ol>` : '<div style="color:var(--muted)">Немає даних за період</div>'}
        ${busyHours.length ? `<div style="margin-top:10px;font-size:14px;color:var(--muted)">Найзавантаженіший час: <b style="color:var(--ink)">${busyHours.join(", ")}</b></div>` : ""}
      </div>`;
  }

  // ───── Ще / налаштування ─────
  function renderMore() {
    const s = st.settings;
    shell(`<header class="top"><div class="top-row"><h1 class="title">Налаштування</h1></div></header>
      <div class="card">
        <label class="field"><span>Ваше імʼя (бачать клієнти в нагадуваннях)</span><input id="s-name" value="${esc(s.trainer_name || "")}" placeholder="Наприклад, Олена"></label>
        <div class="row2">
          <label class="field"><span>План дня в Telegram о</span><input id="s-morning" type="time" value="${esc(s.digest_morning || "")}"></label>
          <label class="field"><span>Підсумок дня о</span><input id="s-evening" type="time" value="${esc(s.digest_evening || "")}"></label>
        </div>
        <label class="field"><span>Нагадувати клієнтам за</span><select id="s-remind">${[[0, "не нагадувати"], [60, "1 годину"], [120, "2 години"], [180, "3 години"], [720, "12 годин"], [1440, "добу"]].map(([v, l]) => `<option value="${v}" ${Number(s.remind_before_min) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn blue wide" data-act="saveSettings">Зберегти</button>
      </div>
      <div class="card">
        <button class="list-btn" data-act="botSheet"><span>Telegram-бот<small>${!s.bot_ready && !DEMO ? "Ще не підключено — натисніть, щоб налаштувати" : s.tg_linked ? "@" + esc(s.bot_username) + " · план і підсумок дня приходять вам" : "@" + esc(s.bot_username || "бот") + " · підключіть свій Telegram"}</small></span>${ICON.right}</button>
        <button class="list-btn" data-act="changePin"><span>Мій вхід<small>${s.phone_hint ? esc(s.phone_hint) + " · " : ""}змінити номер чи пароль</small></span>${ICON.right}</button>
        <button class="list-btn" data-act="exportCsv"><span>Вивантажити в Excel<small>Усі тренування у CSV-файлі</small></span>${ICON.right}</button>
        ${DEMO ? '<button class="list-btn" data-act="resetDemo"><span>Скинути демо-дані<small>Повернути приклад</small></span>' + ICON.right + "</button>" : '<button class="list-btn" data-act="logout"><span>Вийти<small>На цьому пристрої</small></span>' + ICON.right + "</button>"}
      </div>
      <p style="text-align:center;color:var(--muted);font-size:13px;padding:0 24px">Порада: додайте додаток на головний екран — «Поділитися» → «На екран Додому».</p>`);
  }

  // ───── Обробники ─────
  const handlers = {
    close: closeSheet,
    goToday() { st.date = today(); render(); },
    mode(d) { st.mode = d.mode; render(); },
    shift(d) {
      const n = +d.n;
      if (st.mode === "day") st.date = addDays(st.date, n);
      else if (st.mode === "week") st.date = addDays(st.date, 7 * n);
      else { const x = D(monthStart(st.date)); x.setMonth(x.getMonth() + n); st.date = iso(x); }
      render();
    },
    openDay(d) { st.date = d.day; st.mode = "day"; render(); },
    newSession() { sessionSheet(null); },
    newSessionFor() { const c = clientById(st.clientId); sessionSheet(null); if (c) { addParticipant(c); drawSessionSheet(); } },
    async editSession(d) {
      const [from, to] = periodRange();
      const j = await must("range", { from, to });
      const s = j.sessions.find((x) => x.id === +d.id); if (s) sessionSheet(s);
    },
    kind(d) { syncDraft(); draft.kind = d.kind; drawSessionSheet(); },
    addMore() { syncDraft(); draft.kind = "split"; drawSessionSheet(); const q = $("#pick-q"); if (q) q.focus(); },
    addPart(d) { syncDraft(); const c = clientById(+d.id); if (c) addParticipant(c); drawSessionSheet(); },
    async quickClient(d) {
      syncDraft();
      const j = await must("client_save", { client: { name: d.name } });
      await refreshBase();
      addParticipant(clientById(j.client.id) || j.client); drawSessionSheet();
      toast("Клієнта додано в базу");
    },
    rmPart(d) { syncDraft(); draft.participants.splice(+d.i, 1); if (draft.kind === "split" && draft.participants.length < 2) draft.kind = "personal"; drawSessionSheet(); },
    pay(d) {
      syncDraft();
      const p = draft.participants[+d.i];
      if (d.pay === "package" && !activePkg(p.client_id) && !p.package_id) { toast("Немає активного абонемента — продайте його в картці клієнта", true); return; }
      if (p.pay === "package" && d.pay !== "package") { p.package_id = null; p.price = (clientById(p.client_id) || {}).price || 0; }
      p.pay = d.pay; drawSessionSheet();
    },
    async saveSession() {
      syncDraft();
      const s = draft;
      await must("session_save", {
        session: { id: s.id, day: s.day, start_time: s.start_time, duration_min: s.duration_min, kind: s.kind, title: s.title, extra_amount: s.kind === "group" ? s.extra_amount : 0, note: s.note },
        participants: s.participants.map((p) => ({ client_id: p.client_id, price: Number(p.price) || 0, pay: p.pay, package_id: p.pay === "package" ? p.package_id : null })),
      });
      // запамʼятати ціну для клієнтів, у яких її ще немає
      for (const p of s.participants) {
        const c = clientById(p.client_id);
        if (c && !c.price && p.pay !== "package" && Number(p.price) > 0)
          await call("client_save", { client: { id: c.id, name: c.name, phone: c.phone, price: Number(p.price), notes: c.notes, remind: c.remind } });
      }
      closeSheet(); toast(s.id ? "Збережено" : "Записано"); st.date = s.day; await refreshBase(); render();
    },
    moveSession() {
      syncDraft();
      const s = draft;
      openSheet(`<h2>Перенести<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
        <div style="margin:-6px 0 12px;color:var(--muted)">${esc(sessWho(s))} · зараз ${dLong(s.day)}, ${s.start_time}</div>
        <div class="row2"><label class="field"><span>Нова дата</span><input type="date" id="m-day" value="${s.day}"></label><label class="field"><span>Новий час</span><input type="time" id="m-time" value="${s.start_time}" step="300"></label></div>
        <label class="field"><span>Причина (необовʼязково)</span><input id="m-reason" placeholder="Захворів, попросив інший час…"></label>
        <label class="toggle"><input type="checkbox" id="m-notify" checked> Повідомити клієнта в Telegram</label>
        <div class="foot"><button class="btn blue" data-act="doMove" data-id="${s.id}">Перенести</button></div>`);
    },
    async doMove(d) {
      const day = $("#m-day").value, time = $("#m-time").value;
      await must("session_move", { id: +d.id, day, start_time: time, reason: $("#m-reason").value, notify: $("#m-notify").checked });
      closeSheet(); toast(`Перенесено на ${dLong(day)}, ${time}`); st.date = day; render();
    },
    async statusSession(d) {
      await must("session_status", { id: draft.id, status: d.status });
      closeSheet(); toast({ cancelled: "Скасовано", no_show: "Позначено: не прийшов", planned: "Відновлено" }[d.status]); await refreshBase(); render();
    },
    deleteSession() {
      const id = draft.id;
      askConfirm("Видалити тренування назавжди? Якщо клієнт просто не прийде, краще «Скасувати» — тоді воно залишиться в історії.", "Видалити", async () => {
        await must("session_delete", { id }); closeSheet(); toast("Видалено"); await refreshBase(); render();
      });
    },
    async confirmOk() { const fn = pendingConfirm; pendingConfirm = null; if (fn) await fn(); },
    openClient(d) { st.clientId = +d.id; render(); window.scrollTo(0, 0); },
    backClients() { st.clientId = null; render(); },
    newClient() { clientSheet(null); },
    editClient(d) { clientSheet(clientById(+d.id)); },
    async saveClient(d) {
      const v = (id) => $("#" + id).value;
      const j = await must("client_save", { client: { id: d.id ? +d.id : undefined, name: v("c-name"), phone: v("c-phone"), price: v("c-price"), notes: v("c-notes"), remind: $("#c-remind").checked } });
      closeSheet(); toast("Збережено"); await refreshBase(); st.clientId = j.client.id; render();
    },
    async archiveClient(d) {
      const c = clientById(+d.id);
      await must("client_archive", { id: c.id, archived: !c.archived }); await refreshBase(); toast(c.archived ? "Повернуто з архіву" : "Перенесено в архів"); st.clientId = null; render();
    },
    async payDebt(d) { await must("participant_pay", { id: +d.id, pay: "paid" }); toast("Борг закрито"); await refreshBase(); render(); },
    newPackage() { packageSheet(null, st.clientId); },
    editPackage(d) { packageSheet(st.packages.find((p) => p.id === +d.id)); },
    async savePackage(d) {
      const v = (id) => $("#" + id).value;
      await must("package_save", { package: { id: d.id ? +d.id : undefined, client_id: +d.client, sessions_total: v("p-n"), price: v("p-price"), bought_on: v("p-bought"), expires_on: v("p-exp"), title: v("p-title"), paid: $("#p-paid").checked } });
      closeSheet(); toast("Абонемент збережено"); await refreshBase(); render();
    },
    deletePackage(d) {
      askConfirm("Видалити абонемент? Тренування, списані з нього, стануть боргом.", "Видалити", async () => {
        await must("package_delete", { id: +d.id }); closeSheet(); toast("Абонемент видалено"); await refreshBase(); render();
      });
    },
    async clientUnlink(d) { await must("tg_unlink_client", { id: +d.id }); toast("Telegram клієнта відʼєднано"); await refreshBase(); render(); },
    async clientLink(d) {
      const j = await must("tg_link_client", { id: +d.id });
      const c = clientById(+d.id);
      const text = `Привіт! Щоб отримувати нагадування про тренування, відкрийте посилання й підтвердіть свій номер: ${j.url}`;
      if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text); toast("Посилання скопійовано — надішліть його клієнту"); }
      catch { openSheet(`<h2>Посилання для ${esc(c ? c.name : "клієнта")}<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2><label class="field"><span>Скопіюйте й надішліть клієнту</span><textarea id="link-text" rows="3" readonly>${esc(text)}</textarea></label>`, (bg) => $("#link-text", bg).select()); }
    },
    statsPeriod(d) { st.statsPeriod = d.p; render(); },
    statsShift(d) {
      const n = +d.n, x = D(st.statsDate);
      if (st.statsPeriod === "week") st.statsDate = addDays(st.statsDate, 7 * n);
      else if (st.statsPeriod === "month") { x.setDate(1); x.setMonth(x.getMonth() + n); st.statsDate = iso(x); }
      else { x.setFullYear(x.getFullYear() + n); st.statsDate = iso(x); }
      render();
    },
    async saveSettings() {
      await must("settings_save", { settings: { trainer_name: $("#s-name").value, digest_morning: $("#s-morning").value, digest_evening: $("#s-evening").value, remind_before_min: +$("#s-remind").value } });
      await refreshBase(); toast("Збережено");
    },
    botSheet() {
      const s = st.settings;
      if (DEMO) { toast("Telegram-бот працює в робочій версії"); return; }
      const tokenForm = `<label class="field" style="margin-top:10px"><span>Токен бота</span><input id="bot-token" autocomplete="off" placeholder="123456789:AA…"></label>
        <button class="btn ${s.bot_ready ? "light" : "blue"} wide" data-act="botConnect">Підключити бота</button>`;
      let body;
      if (s.bot_ready) {
        body = `<div class="card" style="margin:0 0 12px"><b>@${esc(s.bot_username)}</b><div style="font-size:14px;color:var(--muted);margin-top:4px">${s.tg_linked ? "✅ Ваш Telegram підключено: щоранку план, увечері підсумок, команди /today /tomorrow /week /debts." : "Натисніть кнопку нижче, у Telegram — «Старт», потім «Надіслати мій номер». Номер має збігатися з номером входу."}</div></div>
          <button class="btn blue wide" data-act="tgTrainer">${s.tg_linked ? "Підключити інший пристрій" : "Підключити мій Telegram"}</button>
          ${s.tg_linked ? '<button class="btn light wide" style="margin-top:8px" data-act="tgUnlink">Відʼєднати мій Telegram</button>' : ""}
          ${s.bot_managed ? "" : `<details style="margin-top:16px"><summary style="cursor:pointer;color:var(--muted);font-size:14px">Замінити бота</summary>${tokenForm}</details>`}`;
      } else if (s.bot_managed) {
        body = `<p style="font-size:14px;color:var(--muted)">Бот підключається… Спробуйте за хвилину.</p>`;
      } else {
        body = `<p style="font-size:14px;color:var(--muted);margin:0 0 12px">1. Відкрийте <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> → /newbot → придумайте імʼя.<br>2. Скопіюйте токен, який він надішле, і вставте сюди. Токен зберігається лише на сервері.</p>${tokenForm}`;
      }
      openSheet(`<h2>Telegram-бот<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>${body}`);
    },
    async botConnect() {
      const v = $("#bot-token").value.trim(); if (!v) return toast("Вставте токен", true);
      const j = await must("bot_connect", { token: v }); toast("Бот @" + j.bot_username + " підключено"); await refreshBase(); render(); handlers.botSheet();
    },
    async tgTrainer() { const j = await must("tg_link_trainer"); window.open(j.url, "_blank"); toast("У Telegram натисніть «Старт», потім «Надіслати мій номер»"); },
    async tgUnlink() { await must("tg_unlink_trainer"); await refreshBase(); render(); toast("Відʼєднано"); handlers.botSheet(); },
    changePin() {
      openSheet(`<h2>Мій вхід<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
        <label class="field"><span>Номер телефону${st.settings.phone_hint ? " (зараз " + esc(st.settings.phone_hint) + ")" : ""}</span><input id="pin-phone" type="tel" autocomplete="tel" placeholder="Залиште порожнім, щоб не змінювати"></label>
        <label class="field"><span>Номер Telegram — якщо відрізняється${st.settings.tg_phone_hint ? " (зараз " + esc(st.settings.tg_phone_hint) + ")" : ""}</span><input id="pin-tg" type="tel" placeholder="${st.settings.tg_phone_hint ? "Залиште порожнім або «-», щоб прибрати" : "Номер, на який зареєстровано ваш Telegram"}"></label>
        <label class="field"><span>Новий пароль</span><input id="pin-new" type="password" autocomplete="new-password" placeholder="Від 8 символів, літери й цифри"></label>
        <label class="field"><span>Поточний пароль — для підтвердження</span><input id="pin-old" type="password" autocomplete="current-password"></label>
        <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Після зміни інші пристрої вийдуть із системи. Якщо зміните номер — Telegram треба буде підключити заново.</p>
        <div class="foot"><button class="btn blue" data-act="doChangePin">Зберегти</button></div>`);
    },
    async doChangePin() {
      if (DEMO) { closeSheet(); toast("У демо вхід не потрібен"); return; }
      const j = await must("credentials_save", { old: $("#pin-old").value, new: $("#pin-new").value, phone: $("#pin-phone").value.trim(), tg_phone: $("#pin-tg").value.trim() });
      token = j.token; localStorage.setItem("trainer-token", token); closeSheet(); toast("Збережено"); await refreshBase(); render();
    },
    async exportCsv() {
      if (DEMO) { toast("Вивантаження в Excel працює в робочій версії"); return; }
      const j = await must("export");
      const cl = Object.fromEntries(j.clients.map((c) => [c.id, c]));
      const ss = Object.fromEntries(j.sessions.map((s) => [s.id, s]));
      const rows = [["Дата", "Час", "Тип", "Клієнт", "Телефон", "Ціна", "Оплата", "Статус"]];
      for (const p of j.participants) { const s = ss[p.session_id], c = cl[p.client_id]; if (s && c) rows.push([s.day, s.start_time, KIND[s.kind], c.name, c.phone || "", p.price, PAY[p.pay], s.status === "cancelled" ? "скасовано" : s.status === "no_show" ? "не прийшов" : ""]); }
      for (const s of j.sessions) if (Number(s.extra_amount)) rows.push([s.day, s.start_time, KIND[s.kind], s.title || "Група", "", s.extra_amount, "", s.status === "cancelled" ? "скасовано" : ""]);
      const csv = "﻿" + rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `trenuvannya-${today()}.csv`; a.click();
    },
    logout() { token = ""; localStorage.removeItem("trainer-token"); showLogin(); },
    resetDemo() { askConfirm("Повернути початкові демо-дані? Ваші зміни в демо зникнуть.", "Скинути", async () => { window.DemoBackend.reset(); await refreshBase(); render(); toast("Демо-дані відновлено"); }); },
  };

  function render() {
    closeSheet();
    if (st.tab === "schedule") return renderSchedule();
    if (st.tab === "clients") return renderClients();
    if (st.tab === "stats") return renderStats();
    return renderMore();
  }

  // ───── Вхід ─────
  async function showLogin() {
    const s = await call("status");
    const m = location.hash.match(/reset=([\w-]+)/);
    let mode = m ? "reset" : s.ok && s.needs_setup ? "setup" : "login";
    const T = {
      setup: ["Створіть вхід", "Номер телефону й пароль, якими ви входитимете в журнал тренувань."],
      login: [`Вітаю${s.trainer_name ? ", " + esc(s.trainer_name) : ""}!`, "Увійдіть за номером телефону й паролем."],
      forgot: ["Забули пароль?", "Надішлемо посилання для нового пароля у ваш Telegram-бот (якщо його підключено)."],
      reset: ["Новий пароль", "Придумайте новий пароль. Інші пристрої вийдуть із системи."],
    };
    const draw = (err = "", info = "") => {
      const f = (id, label, type, ac, ph = "") => `<label class="field"><span>${label}</span><input id="${id}" type="${type}" autocomplete="${ac}" placeholder="${ph}"></label>`;
      root.innerHTML = `<form class="login" novalidate>
        <h1>${T[mode][0]}</h1><p>${T[mode][1]}</p>
        ${mode === "setup" ? f("l-name", "Ваше імʼя", "text", "name", "Наприклад, Олена") : ""}
        ${mode !== "reset" ? f("l-phone", "Номер телефону", "tel", "tel", "050 123 45 67") : ""}
        ${mode !== "forgot" ? f("l-pass", mode === "login" ? "Пароль" : "Пароль (від 8 символів, літери й цифри)", "password", mode === "login" ? "current-password" : "new-password") : ""}
        ${mode === "setup" || mode === "reset" ? f("l-pass2", "Повторіть пароль", "password", "new-password") : ""}
        <div class="err" role="alert">${esc(err)}</div>${info ? `<div class="ok-msg">${esc(info)}</div>` : ""}
        <button class="btn blue wide" type="submit">${{ setup: "Створити", login: "Увійти", forgot: "Надіслати посилання", reset: "Зберегти пароль" }[mode]}</button>
        ${mode === "login" ? '<button class="btn light wide" type="button" data-m="forgot" style="margin-top:10px">Забули пароль?</button>' : ""}
        ${mode === "forgot" || mode === "reset" ? '<button class="btn light wide" type="button" data-m="login" style="margin-top:10px">Назад до входу</button>' : ""}
      </form>`;
      const first = root.querySelector("input"); if (first) first.focus();
    };
    draw(s.ok ? "" : s.error || "");
    root.onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m; if (mode === "login") history.replaceState(null, "", location.pathname); draw(); };
    root.onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => ($("#" + id) ? $("#" + id).value : "");
      if ((mode === "setup" || mode === "reset") && v("l-pass") !== v("l-pass2")) return draw("Паролі не збігаються");
      const btn = root.querySelector("button[type=submit]"); btn.disabled = true;
      const j = mode === "setup" ? await call("setup", { name: v("l-name").trim(), phone: v("l-phone"), password: v("l-pass") })
        : mode === "login" ? await call("login", { phone: v("l-phone"), password: v("l-pass") })
        : mode === "forgot" ? await call("forgot", { phone: v("l-phone") })
        : await call("reset", { code: m ? m[1] : "", password: v("l-pass") });
      btn.disabled = false;
      if (!j.ok) return draw(j.error);
      if (mode === "forgot") { mode = "login"; return draw("", "Якщо номер правильний і Telegram підключено — посилання вже в боті."); }
      history.replaceState(null, "", location.pathname);
      token = j.token; localStorage.setItem("trainer-token", token); root.onclick = null; root.onsubmit = null; start();
    };
  }

  async function start() {
    try { await refreshBase(); } catch { return; }
    render();
  }
  if ("serviceWorker" in navigator && location.protocol === "https:" && !DEMO) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (DEMO || (token && !/reset=/.test(location.hash))) start(); else showLogin();
})();
