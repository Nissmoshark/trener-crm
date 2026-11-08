// CRM персонального тренера — інтерфейс
(function () {
  const API_URL = (window.TRAINER_API || "").trim();
  const DEMO = !API_URL;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
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
  const EXP = { rent: ["Оренда залу", "🏟"], gear: ["Інвентар", "🏋️"], transport: ["Транспорт", "🚕"], education: ["Навчання", "📚"], ads: ["Реклама", "📣"], food: ["Харчування", "🥗"], other: ["Інше", "🧾"] };
  const REPEAT = [[0, "не повторювати"], [4, "4 тижні"], [8, "8 тижнів"], [12, "12 тижнів"], [26, "півроку"]];
  const MEAS = [["weight", "Вага", "кг"], ["waist", "Талія", "см"], ["hips", "Стегна", "см"], ["chest", "Груди", "см"], ["fat", "Жир", "%"]];
  const parseProg = (x) => { try { const a = JSON.parse(x || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
  async function shareText(text, okMsg) {
    if (navigator.share) { try { await navigator.share({ text }); return; } catch { /* скасовано */ } }
    try { await navigator.clipboard.writeText(text); toast(okMsg || "Скопійовано"); }
    catch { openSheet(`<h2>Текст<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2><label class="field"><span>Скопіюйте й надішліть</span><textarea id="share-text" rows="6" readonly>${esc(text)}</textarea></label>`, (bg) => $("#share-text", bg).select()); }
  }
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
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="18" rx="3"/><path d="M8.5 9.5l1.5 1.5 3-3M8.5 15.5h7"/></svg>',
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
  const st = { planDate: today(), tab: "schedule", mode: "day", date: today(), clients: [], packages: [], settings: {}, q: "", statsPeriod: "month", statsDate: today(), clientId: null };
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
        ${[["schedule", "Розклад", ICON.cal], ["plans", "Плани", ICON.plan], ["clients", "Клієнти", ICON.people], ["stats", "Статистика", ICON.chart], ["more", "Ще", ICON.more]]
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
    if (st.mode === "day") box.innerHTML = dayView(ss) + dayPlansStrip(j.plans || []);
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
    if (s.participants.some((p) => p.confirm === "no")) tags.push('<span class="tag debt">❌ не зможе</span>');
    else if (s.participants.length && s.participants.every((p) => p.confirm === "yes")) tags.push('<span class="tag ok">✅ підтверджено</span>');
    if (s.series) tags.push('<span class="tag moved">↻</span>');
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

  // ───── Плани (особисті справи) ─────
  const CATS = { personal: ["Особисте", "🙂"], beauty: ["Краса", "💇"], health: ["Здоровʼя", "🩺"], errand: ["Справи", "🛒"], work: ["Робота", "💼"] };
  const REMIND = [[0, "без нагадування"], [15, "за 15 хв"], [30, "за 30 хв"], [60, "за 1 год"], [120, "за 2 год"], [1440, "за добу"]];
  const endMin = (t, d) => +t.slice(0, 2) * 60 + +t.slice(3, 5) + (Number(d) || 0);
  const minT = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  function clashes(p, ss) {
    if (!p.time) return [];
    const a = minT(p.time), b = endMin(p.time, p.duration_min || 1);
    return ss.filter((s) => s.status !== "cancelled" && minT(s.start_time) < b && endMin(s.start_time, s.duration_min) > a);
  }
  function planRow(p, ss) {
    const c = CATS[p.cat] || CATS.personal, cl = clashes(p, ss);
    return `<div class="plan ${p.done ? "done" : ""}">
      <button class="chk" data-act="planDone" data-id="${p.id}" data-done="${p.done ? 0 : 1}" aria-label="${p.done ? "Позначити як не виконане" : "Виконано"}" aria-pressed="${p.done}">${p.done ? "✓" : ""}</button>
      <button class="pbody" data-act="editPlan" data-id="${p.id}">
        <span class="pt">${p.time ? `<b>${p.time}</b>${p.duration_min ? `<small>–${pad(Math.floor(endMin(p.time, p.duration_min) / 60) % 24)}:${pad(endMin(p.time, p.duration_min) % 60)}</small>` : ""}` : "<small>день</small>"}</span>
        <span class="pw"><span class="pn">${c[1]} ${esc(p.title)}</span>${p.place || p.note || p.remind_min || cl.length ? `<span class="ps">${[p.place ? "📍 " + esc(p.place) : "", p.remind_min ? "🔔 " + (REMIND.find((r) => r[0] === p.remind_min) || [0, p.remind_min + " хв"])[1] : "", p.note ? esc(p.note) : ""].filter(Boolean).join(" · ")}${cl.length ? `<span class="clash">⚠️ перетин із тренуванням ${cl.map((s) => s.start_time).join(", ")}</span>` : ""}</span>` : ""}</span>
      </button></div>`;
  }
  function dayPlansStrip(ps) {
    if (!ps.length) return "";
    return `<div class="card plans-mini"><h3>Мої плани</h3>${ps.map((p) => `<button class="pm ${p.done ? "done" : ""}" data-act="editPlan" data-id="${p.id}"><b>${p.time || "день"}</b><span>${(CATS[p.cat] || CATS.personal)[1]} ${esc(p.title)}</span></button>`).join("")}</div>`;
  }
  async function renderPlans() {
    const d = st.planDate, rel = d === today() ? "Сьогодні" : d === addDays(today(), 1) ? "Завтра" : d === addDays(today(), -1) ? "Вчора" : null;
    shell(`<header class="top">
        <div class="top-row"><h1 class="title">Плани</h1><button class="chip-btn" data-act="planToday">Сьогодні</button></div>
        <div class="datebar">
          <button class="icon-btn" data-act="planShift" data-n="-1" aria-label="Попередній день">${ICON.left}</button>
          <div class="label">${rel ?? dLong(d)}<small>${rel ? dLong(d) + ", " : ""}${WDL[D(d).getDay()]}</small></div>
          <button class="icon-btn" data-act="planShift" data-n="1" aria-label="Наступний день">${ICON.right}</button>
        </div>
      </header><div id="pbox"><div class="loading">Завантаження…</div></div>`, { fab: { act: "newPlan", label: "План" } });
    const to = addDays(d, 7);
    const j = await must("range", { from: d, to });
    const box = $("#pbox"); if (!box) return;
    st.plans = j.plans || [];
    const dayS = j.sessions.filter((s) => s.day === d), dayP = st.plans.filter((p) => p.day === d);
    const busy = dayS.filter((s) => s.status !== "cancelled");
    const agenda = [...dayP.filter((p) => p.time).map((p) => ({ t: p.time, h: planRow(p, busy) })),
      ...busy.map((s) => ({ t: s.start_time, h: `<button class="plan-sess" data-act="planOpenDay" data-day="${d}"><span class="pt"><b>${s.start_time}</b><small>${s.duration_min} хв</small></span><span class="pw"><span class="pn">💪 ${esc(sessWho(s))}</span><span class="ps">тренування</span></span></button>` }))]
      .sort((a, b) => a.t.localeCompare(b.t));
    const allDay = dayP.filter((p) => !p.time);
    const next = st.plans.filter((p) => p.day > d && !p.done);
    let nextHtml = "", last = "";
    for (const p of next) { if (p.day !== last) { nextHtml += `<div class="pday">${WD[D(p.day).getDay()]}, ${dLong(p.day)}</div>`; last = p.day; } nextHtml += planRow(p, j.sessions.filter((s) => s.day === p.day && s.status !== "cancelled")); }
    box.innerHTML = `
      ${busy.length ? `<div class="pnote">💪 ${busy.length} трен. · ${busy[0].start_time}–${(() => { const l = busy[busy.length - 1]; const e = endMin(l.start_time, l.duration_min); return pad(Math.floor(e / 60) % 24) + ":" + pad(e % 60); })()}</div>` : ""}
      <div class="card"><h3>Розпорядок дня</h3>${agenda.length ? agenda.map((x) => x.h).join("") : '<div class="none">На цей день нічого не заплановано за часом</div>'}</div>
      <div class="card"><h3>Протягом дня</h3>${allDay.length ? allDay.map((p) => planRow(p, [])).join("") : '<div class="none">Справи без часу: купити, подзвонити, оплатити…</div>'}</div>
      ${nextHtml ? `<div class="card"><h3>Найближчі 7 днів</h3>${nextHtml}</div>` : ""}`;
  }
  function planSheet(p) {
    const x = p || { day: st.tab === "plans" ? st.planDate : st.date, time: "", duration_min: 60, title: "", place: "", note: "", cat: "personal", remind_min: 60 };
    openSheet(`<h2>${p ? "План" : "Новий план"}<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
      <label class="field"><span>Що заплановано</span><input id="pl-title" value="${esc(x.title)}" placeholder="Перукар, стоматолог, забрати посилку…" maxlength="200"></label>
      <div class="cats" role="group" aria-label="Категорія">${Object.entries(CATS).map(([k, [l, e]]) => `<button data-act="planCat" data-cat="${k}" aria-pressed="${x.cat === k}">${e} ${l}</button>`).join("")}</div>
      <div class="row3">
        <label class="field"><span>Дата</span><input id="pl-day" type="date" value="${x.day}"></label>
        <label class="field"><span>Час</span><input id="pl-time" type="time" value="${x.time || ""}"></label>
        <label class="field"><span>Хвилин</span><input id="pl-dur" type="number" inputmode="numeric" value="${x.duration_min || ""}" placeholder="60"></label>
      </div>
      <label class="field"><span>Нагадати в Telegram</span><select id="pl-rem">${REMIND.map(([v, l]) => `<option value="${v}" ${Number(x.remind_min) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Місце (необовʼязково)</span><input id="pl-place" value="${esc(x.place || "")}" placeholder="Адреса чи назва"></label>
      <label class="field"><span>Нотатка</span><textarea id="pl-note" rows="2">${esc(x.note || "")}</textarea></label>
      ${p ? (p.series ? '<p class="hint">↻ Частина щотижневої серії.</p>' : "") : `<label class="field"><span>Повторювати щотижня</span><select id="pl-rep">${REPEAT.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>`}
      <div class="foot"><button class="btn blue" data-act="savePlan" data-id="${p ? p.id : ""}">Зберегти</button>${p ? `<button class="btn red" data-act="deletePlan" data-id="${p.id}">Видалити</button>` : ""}</div>`, (bg) => { if (!p) $("#pl-title", bg).focus(); bg.dataset.cat = x.cat; });
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
      ${isNew ? `<label class="field"><span>Повторювати щотижня</span><select id="f-rep">${REPEAT.map(([v, l]) => `<option value="${v}" ${Number(s.repeat || 0) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : s.series ? '<p class="hint">↻ Це тренування — частина щотижневої серії.</p>' : ""}
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
  // Стан абонемента: проведено / заплановано / вільно
  function pkgState(p) {
    const done = p.used_done ?? p.used, booked = Math.max(0, p.used - done), free = Math.max(0, p.sessions_total - p.used);
    return { done, booked, free, total: p.sessions_total };
  }
  const pkgShort = (p) => { const x = pkgState(p); return `вільно ${x.free} з ${x.total}`; };
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
      <div class="part-h"><span>${esc(c.name)}${p.confirm === "yes" ? ' <span class="tag ok">✅ буде</span>' : p.confirm === "no" ? ' <span class="tag debt">❌ не зможе</span>' : ""}${pk ? ` <span class="tag pkg">абонемент · ${pkgShort(pk)}</span>` : ""}</span><button data-act="rmPart" data-i="${i}" aria-label="Прибрати">${ICON.close.replace('stroke-width="2.2"', 'stroke-width="2" width="18" height="18"')}</button></div>
      <div class="part-r">
        <input type="number" inputmode="decimal" data-price="${i}" value="${p.pay === "package" ? pkgUnit(p.client_id, p.package_id) : p.price}" ${p.pay === "package" ? "disabled" : ""} aria-label="Ціна">
        <div class="pay" role="group" aria-label="Оплата">${Object.entries(PAY).map(([k, l]) => `<button data-act="pay" data-i="${i}" data-pay="${k}" aria-pressed="${p.pay === k}">${l}</button>`).join("")}</div>
      </div>
      ${p.pay === "package" && pk ? `<div class="part-hint">Спишеться 1 тренування з абонемента (${num(pkgUnit(p.client_id, p.package_id))} грн). ${pkgState(pk).free <= 1 && !p.package_id ? "⚠️ Це останнє вільне." : ""}</div>`
        : pk && pkgState(pk).free > 0 ? `<div class="part-hint">💡 У клієнта є абонемент (${pkgShort(pk)}). Щоб списати це тренування з нього — натисніть «Абонемент».</div>` : ""}
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
    if (v("f-rep") !== undefined) draft.repeat = Number(v("f-rep")) || 0;
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
        <span class="rt"><b>${c.price ? num(c.price) : "—"}</b>${Number(c.debt) ? `<span class="tag debt">борг ${num(c.debt)}</span>` : pk ? `<span class="tag ${pkgState(pk).free <= 2 ? "warn" : "pkg"}">${pkgState(pk).free <= 2 ? "⚠️ " : "абон. "}${pkgShort(pk)}</span>` : `<span>${c.visits || 0} трен.</span>`}</span>
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
    const debts = j.debts || [];
    const prog = parseProg(c.program);
    const ms = j.measures || [];
    const tel = (c.phone || "").replace(/[^\d+]/g, "");
    const intl = tel.startsWith("0") ? "+38" + tel : tel;
    box.innerHTML = `
      <div class="card">
        <div class="kv"><div><b>${ok.length}</b><span>тренувань</span></div><div><b>${num(spent)}</b><span>грн усього</span></div><div><b>${j.moves}</b><span>переносів</span></div></div>
        ${tel ? `<div class="actions" style="margin-top:12px"><a class="btn light" href="tel:${esc(intl)}">${ICON.phone}${esc(c.phone)}</a><a class="btn light" href="viber://chat?number=${esc(intl.replace("+", "%2B"))}">Viber</a><a class="btn light" href="https://t.me/${esc(intl)}" target="_blank" rel="noopener">Telegram</a></div>` : ""}
        <div style="margin-top:10px;color:var(--muted);font-size:14px">Стандартна ціна: <b style="color:var(--ink)">${c.price ? num(c.price) + " грн" : "не задана"}</b></div>
      </div>
      ${debts.length ? `<div class="card"><h3>Борг: ${num(debts.reduce((a, h) => a + Number(h.price), 0))} грн</h3><ul class="hist">${debts.map((h) => `<li><span>${dLong(h.day)}${h.time ? ", " + h.time : ""}</span><button class="btn light" style="height:34px" data-act="payDebt" data-id="${h.part_id}">Оплачено · ${num(h.price)}</button></li>`).join("")}</ul>
        <button class="btn light wide" style="margin-top:8px" data-act="debtRemind" data-id="${c.id}">💬 ${c.tg_linked ? "Нагадати в Telegram" : "Надіслати нагадування"}</button></div>` : ""}
      <div class="card"><h3 class="row-h"><span>Абонементи</span><button class="chip-btn sm" data-act="pkgHelp">Як це працює?</button></h3>
        ${j.packages.length ? j.packages.map((p) => `<button class="pkg" data-act="editPackage" data-id="${p.id}">
          <span style="min-width:96px"><b>${esc(p.title || p.sessions_total + " трен.")}</b><br><small style="color:var(--muted)">${num(p.price)} грн · ${dShort(p.bought_on)}${p.paid ? "" : " · не оплачено"}</small></span>
          <span class="plates" aria-label="Проведено ${pkgState(p).done}, заплановано ${pkgState(p).booked}, вільно ${pkgState(p).free} з ${p.sessions_total}">${Array.from({ length: p.sessions_total }, (_, i) => `<i class="${i < pkgState(p).done ? "u" : i < p.used ? "b" : ""}"></i>`).join("")}</span>
          <b>${pkgState(p).free}<small>вільно</small></b>
          <span class="pk-line">проведено ${pkgState(p).done} · заплановано ${pkgState(p).booked} · вільно ${pkgState(p).free}${p.expires_on ? ` · до ${dShort(p.expires_on)}` : ""}</span></button>`).join("") + '<div class="plates-legend"><span><i class="u"></i>проведено</span><span><i class="b"></i>заплановано</span><span><i></i>вільно</span></div>'  : '<div style="color:var(--muted);font-size:14px;margin-bottom:8px">Абонементів немає</div>'}
        <button class="btn light wide" style="margin-top:8px" data-act="newPackage">Продати абонемент</button>
      </div>
      <div class="card"><h3 class="row-h"><span>Програма тренувань</span><button class="chip-btn sm" data-act="editProgram" data-id="${c.id}">${prog.length ? "Змінити" : "Скласти"}</button></h3>
        ${prog.length ? `<table class="prog"><thead><tr><th>Вправа</th><th>Підх.</th><th>Повт.</th><th>Вага</th></tr></thead><tbody>${prog.map((r) => `${r.day ? `<tr class="pday-r"><td colspan="4">${esc(r.day)}</td></tr>` : ""}<tr><td>${esc(r.name)}${r.note ? `<small>${esc(r.note)}</small>` : ""}</td><td>${esc(r.sets)}</td><td>${esc(r.reps)}</td><td>${esc(r.weight)}</td></tr>`).join("")}</tbody></table>` : '<div class="none">Вправи з підходами, повтореннями й вагою — щоб не тримати в голові.</div>'}
      </div>
      <div class="card"><h3 class="row-h"><span>Заміри й прогрес</span><button class="chip-btn sm" data-act="newMeasure" data-id="${c.id}">+ Замір</button></h3>${measuresHtml(ms)}</div>
      ${c.notes ? `<div class="card"><h3>Нотатки</h3><div class="notes">${esc(c.notes)}</div></div>` : ""}
      <div class="card"><h3>Нагадування в Telegram</h3>
        <div style="font-size:14px;color:var(--muted);margin-bottom:10px">${c.tg_linked ? "✅ Клієнт підключив нагадування." : c.phone ? "Надішліть клієнту посилання — бот попросить підтвердити номер " + esc(c.phone) + " і нагадуватиме про тренування й переноси." : "Спершу вкажіть номер телефону клієнта — бот підключиться лише з цим номером."}</div>
        <button class="btn light wide" data-act="clientLink" data-id="${c.id}">${c.tg_linked ? "Посилання ще раз" : "Отримати посилання для клієнта"}</button>
        ${c.tg_linked ? `<button class="btn light wide" style="margin-top:8px" data-act="clientUnlink" data-id="${c.id}">Відʼєднати Telegram</button>` : ""}
      </div>
      <div class="card"><h3>Історія</h3>${j.history.length ? `<ul class="hist">${j.history.slice(0, 60).map((h) => `<li><span>${dLong(h.day)} ${h.start_time} ${h.kind !== "personal" ? `<span class="tag moved">${KIND[h.kind]}</span>` : ""} ${h.status === "cancelled" ? '<span class="tag moved">скасовано</span>' : h.status === "no_show" ? '<span class="tag noshow">не прийшов</span>' : ""} ${h.pay === "debt" ? '<span class="tag debt">борг</span>' : h.pay === "package" ? '<span class="tag pkg">абонемент</span>' : ""}</span><span class="p">${num(h.price)}</span></li>`).join("")}</ul>` : '<div style="color:var(--muted);font-size:14px">Ще не тренувався</div>'}</div>
      <div style="padding:0 16px"><button class="btn light wide" data-act="archiveClient" data-id="${c.id}">${c.archived ? "Повернути з архіву" : "Перенести в архів"}</button></div>`;
  }
  // Заміри: остання цифра, зміна від першого заміру, міні-графік ваги
  function measuresHtml(ms) {
    if (!ms.length) return '<div class="none">Вага, талія, стегна, груди, % жиру — і видно прогрес клієнта.</div>';
    const first = ms[0], last = ms[ms.length - 1];
    const tiles = MEAS.map(([k, l, u]) => {
      const vals = ms.filter((m) => m[k] != null); if (!vals.length) return "";
      const a = vals[0][k], b = vals[vals.length - 1][k], d = Math.round((b - a) * 10) / 10;
      return `<div><b>${num1(b)}</b><span>${l}, ${u}</span>${vals.length > 1 && d ? `<em class="${d < 0 ? "dn" : "up"}">${d > 0 ? "+" : ""}${num1(d)}</em>` : ""}</div>`;
    }).join("");
    const w = ms.filter((m) => m.weight != null);
    let chart = "";
    if (w.length > 1) {
      const mn = Math.min(...w.map((m) => m.weight)), mx = Math.max(...w.map((m) => m.weight)), span = Math.max(0.5, mx - mn);
      const pts = w.map((m, i) => `${(i / (w.length - 1)) * 300},${70 - ((m.weight - mn) / span) * 60}`).join(" ");
      chart = `<svg class="mchart" viewBox="-6 0 312 80" role="img" aria-label="Вага: від ${num1(w[0].weight)} до ${num1(w[w.length - 1].weight)} кг"><polyline points="${pts}" fill="none" stroke="var(--plate-blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${w.map((m, i) => `<circle cx="${(i / (w.length - 1)) * 300}" cy="${70 - ((m.weight - mn) / span) * 60}" r="3.5" fill="var(--plate-blue)"/>`).join("")}</svg>`;
    }
    return `<div class="mtiles">${tiles}</div>${chart}<div class="msub">з ${dLong(first.day)} · ${ms.length} замір.</div>
      <ul class="hist">${[...ms].reverse().slice(0, 12).map((m) => `<li><button class="mrow" data-act="editMeasure" data-id="${m.id}"><span>${dLong(m.day)}</span><span>${MEAS.filter(([k]) => m[k] != null).map(([k, l, u]) => `${l.toLowerCase()} ${num1(m[k])}`).join(" · ") || esc(m.note || "")}</span></button></li>`).join("")}</ul>`;
  }
  const num1 = (x) => (Math.round(Number(x) * 10) / 10).toLocaleString("uk-UA");
  function measureSheet(m, clientId) {
    const x = m || { day: today(), client_id: clientId };
    openSheet(`<h2>${m ? "Замір" : "Новий замір"}<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
      <label class="field"><span>Дата</span><input id="ms-day" type="date" value="${x.day}"></label>
      <div class="row2">${MEAS.map(([k, l, u]) => `<label class="field"><span>${l}, ${u}</span><input id="ms-${k}" type="number" inputmode="decimal" step="0.1" value="${x[k] ?? ""}"></label>`).join("")}</div>
      <label class="field"><span>Нотатка</span><input id="ms-note" value="${esc(x.note || "")}" placeholder="Самопочуття, фото в телефоні…"></label>
      <div class="foot"><button class="btn blue" data-act="saveMeasure" data-id="${m ? m.id : ""}" data-client="${x.client_id}">Зберегти</button>${m ? `<button class="btn red" data-act="deleteMeasure" data-id="${m.id}">Видалити</button>` : ""}</div>`);
  }
  let progDraft = [];
  function programSheet(c) {
    progDraft = parseProg(c.program).map((r) => ({ ...r }));
    if (!progDraft.length) progDraft.push({ name: "", sets: "", reps: "", weight: "", note: "", day: "" });
    drawProgram(c.id);
  }
  function drawProgram(cid) {
    openSheet(`<h2>Програма<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
      <p class="hint" style="margin-top:-6px">Розділ (необовʼязково) — напр. «День 1: ноги». Порожні рядки не зберігаються.</p>
      <div class="prog-ed">${progDraft.map((r, i) => `<div class="pr">
        <input data-pf="day" data-i="${i}" value="${esc(r.day || "")}" placeholder="Розділ" class="pr-day">
        <div class="pr-main"><input data-pf="name" data-i="${i}" value="${esc(r.name)}" placeholder="Вправа"><button class="icon-btn sm" data-act="progRm" data-i="${i}" aria-label="Прибрати">${ICON.close}</button></div>
        <div class="pr-nums"><input data-pf="sets" data-i="${i}" value="${esc(r.sets)}" placeholder="Підх." inputmode="numeric"><input data-pf="reps" data-i="${i}" value="${esc(r.reps)}" placeholder="Повт."><input data-pf="weight" data-i="${i}" value="${esc(r.weight)}" placeholder="Вага"></div>
        <input data-pf="note" data-i="${i}" value="${esc(r.note || "")}" placeholder="Підказка (техніка, темп)" class="pr-note"></div>`).join("")}</div>
      <button class="btn light wide" data-act="progAdd" style="margin:8px 0 12px">+ Вправа</button>
      <div class="foot"><button class="btn blue" data-act="saveProgram" data-id="${cid}">Зберегти програму</button></div>`, (bg) => {
      bg.addEventListener("input", (e) => { const t = e.target; if (t.dataset.pf) progDraft[+t.dataset.i][t.dataset.pf] = t.value; });
    });
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
      <label class="field"><span>Нотатки</span><textarea id="c-notes" rows="4" placeholder="Цілі, травми, обмеження, побажання">${esc(x.notes || "")}</textarea></label>
      <label class="toggle"><input type="checkbox" id="c-remind" ${x.remind !== false ? "checked" : ""}> Нагадувати в Telegram</label>
      <div class="foot"><button class="btn blue" data-act="saveClient" data-id="${c ? c.id : ""}">Зберегти</button></div>`, (bg) => { if (!c) $("#c-name", bg).focus(); });
  }
  let pkgReturn = null; // продаж абонемента просто з запису тренування
  function packageSheet(p, clientId, ret = null) {
    pkgReturn = ret;
    const x = p || { client_id: clientId, title: "", sessions_total: 8, price: "", paid: true, bought_on: today(), expires_on: "" };
    const c = clientById(x.client_id);
    openSheet(`
      <h2>${p ? "Абонемент" : "Новий абонемент"}<button class="icon-btn" data-act="${ret ? "pkgBack" : "close"}" aria-label="${ret ? "Назад до тренування" : "Закрити"}">${ret ? ICON.left : ICON.close}</button></h2>
      ${ret ? '<p style="margin:-4px 0 12px;font-size:14px;color:var(--muted)">У клієнта немає активного абонемента. Оформіть його — і це тренування одразу спишеться з нього.</p>' : ""}
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
      <div class="foot">${ret ? '<button class="btn light" data-act="pkgBack">Назад</button>' : ""}<button class="btn blue" data-act="savePackage" data-id="${p ? p.id : ""}" data-client="${x.client_id}">${ret ? "Оформити й списати" : "Зберегти"}</button>${p ? '<button class="btn red" data-act="deletePackage" data-id="' + p.id + '">Видалити</button>' : ""}</div>`);
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
    const [j, ej] = await Promise.all([must("range", { from, to }), must("expenses_range", { from, to })]);
    const box = $("#sbox"); if (!box) return;
    const exps = ej.expenses || [];
    st.expenses = exps;
    const all = j.sessions, ok = all.filter((s) => s.status !== "cancelled");
    const income = ok.reduce((a, s) => a + sessTotal(s), 0);
    const parts = ok.flatMap((s) => s.participants.map((p) => ({ ...p, s })));
    const clientsN = new Set(parts.map((p) => p.client_id)).size;
    const debt = parts.filter((p) => p.pay === "debt" && p.s.day <= today()).reduce((a, p) => a + Number(p.price), 0);
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
    const spent = exps.reduce((a, e) => a + Number(e.amount), 0), net = income - spent;
    const goal = Number(st.settings.month_goal) || 0;
    const goalHtml = st.statsPeriod === "month" && goal ? (() => {
      const pct = Math.round((income / goal) * 100), isCur = monthStart(today()) === from;
      const daysLeft = isCur ? Math.max(0, (D(to) - D(today())) / 86400000) : 0;
      return `<div class="card goal"><h3 class="row-h"><span>🎯 Ціль місяця</span><b>${pct}%</b></h3>
        <div class="gbar"><i style="width:${Math.min(100, pct)}%"></i></div>
        <div class="msub">${num(income)} з ${num(goal)} грн${income < goal ? ` · лишилось ${num(goal - income)}${isCur && daysLeft ? ` · ≈${num((goal - income) / daysLeft)} грн/день` : ""}` : " · ціль досягнута 🎉"}</div></div>`;
    })() : st.statsPeriod === "month" ? '<div class="card goal"><button class="list-btn" data-act="goalSheet"><span>🎯 Поставити ціль на місяць<small>Скільки хочете заробити — покажу прогрес щодня</small></span>' + ICON.right + "</button></div>" : "";
    const byCat = Object.entries(exps.reduce((m, e) => { m[e.cat] = (m[e.cat] || 0) + Number(e.amount); return m; }, {})).sort((a, b) => b[1] - a[1]);
    const expHtml = `<div class="chart"><h3 class="row-h"><span>Витрати</span><button class="chip-btn sm" data-act="newExpense">+ Витрата</button></h3>
      ${exps.length ? `<div class="legend">${byCat.map(([k, v]) => `<div><i style="background:var(--plate-red)"></i><span>${(EXP[k] || EXP.other)[1]} ${(EXP[k] || EXP.other)[0]}</span><b>${num(v)} грн</b></div>`).join("")}</div>
        <ul class="hist" style="margin-top:8px">${exps.slice(0, 30).map((e) => `<li><button class="mrow" data-act="editExpense" data-id="${e.id}"><span>${dShort(e.day)} · ${(EXP[e.cat] || EXP.other)[1]} ${esc(e.note || (EXP[e.cat] || EXP.other)[0])}</span><span class="p">−${num(e.amount)}</span></button></li>`).join("")}</ul>`
        : '<div class="none">Оренда залу, інвентар, дорога, курси — щоб бачити чистий прибуток.</div>'}</div>`;
    box.innerHTML = `
      <div class="total"><div><div class="sum">${num(income)}<span>грн</span></div></div><div class="meta">дохід<br><b>${ok.length}</b> трен. · <b>${clientsN}</b> клієнт.</div></div>
      <div class="stats-grid two">
        <div class="stat"><b style="color:var(--plate-red)">${spent ? "−" + num(spent) : "0"}</b><span>витрати, грн</span></div>
        <div class="stat"><b style="${net < 0 ? "color:var(--plate-red)" : "color:var(--plate-green, #1e7d4f)"}">${num(net)}</b><span>чистий прибуток, грн</span></div>
      </div>
      ${goalHtml}
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
      </div>
      ${expHtml}`;
  }

  function expenseSheet(e) {
    const x = e || { day: today(), amount: "", cat: "rent", note: "" };
    openSheet(`<h2>${e ? "Витрата" : "Нова витрата"}<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
      <div class="row2"><label class="field"><span>Сума, грн</span><input id="ex-amount" type="number" inputmode="decimal" value="${x.amount}" placeholder="0"></label>
        <label class="field"><span>Дата</span><input id="ex-day" type="date" value="${x.day}"></label></div>
      <div class="cats" role="group" aria-label="Категорія">${Object.entries(EXP).map(([k, [l, ic]]) => `<button data-act="expCat" data-cat="${k}" aria-pressed="${x.cat === k}">${ic} ${l}</button>`).join("")}</div>
      <label class="field"><span>Коментар</span><input id="ex-note" value="${esc(x.note || "")}" placeholder="Напр. оренда за листопад"></label>
      <div class="foot"><button class="btn blue" data-act="saveExpense" data-id="${e ? e.id : ""}">Зберегти</button>${e ? `<button class="btn red" data-act="deleteExpense" data-id="${e.id}">Видалити</button>` : ""}</div>`, (bg) => { bg.dataset.cat = x.cat; if (!e) $("#ex-amount", bg).focus(); });
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
        <label class="field"><span>Адреса залу (додається в нагадування клієнтам)</span><input id="s-gym" value="${esc(s.gym_address || "")}" placeholder="Зал «Сила», вул. Сирецька 5"></label>
        <label class="field"><span>Ціль доходу на місяць, грн</span><input id="s-goal" type="number" inputmode="numeric" value="${s.month_goal || ""}" placeholder="Напр. 40000"></label>
        <label class="field"><span>Нагадувати клієнтам за</span><select id="s-remind">${[[0, "не нагадувати"], [60, "1 годину"], [120, "2 години"], [180, "3 години"], [720, "12 годин"], [1440, "добу"]].map(([v, l]) => `<option value="${v}" ${Number(s.remind_before_min) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn blue wide" data-act="saveSettings">Зберегти</button>
      </div>
      <div class="card">
        <button class="list-btn" data-act="botSheet"><span>Telegram-бот<small>${!s.bot_ready && !DEMO ? "Ще не підключено — натисніть, щоб налаштувати" : s.tg_linked ? "@" + esc(s.bot_username) + " · план і підсумок дня приходять вам" : "@" + esc(s.bot_username || "бот") + " · підключіть свій Telegram"}</small></span>${ICON.right}</button>
        <button class="list-btn" data-act="changePin"><span>Мій вхід<small>${s.phone_hint ? esc(s.phone_hint) + " · " : ""}змінити номер чи пароль</small></span>${ICON.right}</button>
        <button class="list-btn" data-act="backupNow"><span>Резервна копія в Telegram<small>${s.last_backup ? "Остання: " + dLong(s.last_backup.slice(0, 10)) : "Файл з усіма даними — у ваш бот"}${s.backup_weekly ? " · щонеділі автоматично" : ""}</small></span>${ICON.right}</button>
        <label class="toggle" style="padding:10px 0"><input type="checkbox" id="s-backup" ${s.backup_weekly ? "checked" : ""} data-act="toggleBackup"> Щотижнева копія (неділя ввечері)</label>
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
      if (d.pay === "package" && !activePkg(p.client_id) && !p.package_id) { packageSheet(null, p.client_id, { i: +d.i }); return; }
      if (p.pay === "package" && d.pay !== "package") { p.package_id = null; p.price = (clientById(p.client_id) || {}).price || 0; }
      p.pay = d.pay; drawSessionSheet();
    },
    async saveSession() {
      syncDraft();
      const s = draft;
      const r = await must("session_save", {
        session: { id: s.id, day: s.day, start_time: s.start_time, duration_min: s.duration_min, kind: s.kind, title: s.title, extra_amount: s.kind === "group" ? s.extra_amount : 0, note: s.note },
        participants: s.participants.map((p) => ({ client_id: p.client_id, price: Number(p.price) || 0, pay: p.pay, package_id: p.pay === "package" ? p.package_id : null })),
        repeat_weeks: s.id ? 0 : s.repeat || 0,
      });
      // запамʼятати ціну для клієнтів, у яких її ще немає
      for (const p of s.participants) {
        const c = clientById(p.client_id);
        if (c && !c.price && p.pay !== "package" && Number(p.price) > 0)
          await call("client_save", { client: { id: c.id, name: c.name, phone: c.phone, price: Number(p.price), notes: c.notes, remind: c.remind } });
      }
      closeSheet(); toast(s.id ? "Збережено" : r.created > 1 ? `Записано ${r.created} тренувань щотижня${r.no_package ? ` · ${r.no_package} без абонемента (борг)` : ""}` : "Записано", !!r.no_package); st.date = s.day; await refreshBase(); render();
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
      if (draft.series) {
        openSheet(`<h2>Видалити тренування<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
          <p style="margin:0 0 16px">Це тренування — частина щотижневої серії. Якщо клієнт просто не прийде, краще «Скасувати».</p>
          <div class="foot col"><button class="btn red" data-act="delSeries" data-id="${id}" data-scope="one">Лише це</button><button class="btn red" data-act="delSeries" data-id="${id}" data-scope="future">Це й усі наступні</button></div>`);
        return;
      }
      askConfirm("Видалити тренування назавжди? Якщо клієнт просто не прийде, краще «Скасувати» — тоді воно залишиться в історії.", "Видалити", async () => {
        await must("session_delete", { id }); closeSheet(); toast("Видалено"); await refreshBase(); render();
      });
    },
    async delSeries(d) {
      const r = await must("session_delete", { id: +d.id, scope: d.scope }); closeSheet(); toast(`Видалено: ${r.deleted || 1}`); await refreshBase(); render();
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
    pkgHelp() {
      openSheet(`<h2>Як працюють абонементи<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
        <ol class="help">
          <li><b>Продайте абонемент.</b> Картка клієнта → «Продати абонемент»: скільки тренувань і за скільки. Або прямо під час запису: натисніть «Абонемент», якщо його ще немає — додаток запропонує оформити.</li>
          <li><b>Записуйте тренування з позначкою «Абонемент».</b> Кожне таке тренування забирає 1 тренування з абонемента. Якщо в клієнта є абонемент, «Абонемент» вибирається сам.</li>
          <li><b>Як читати цифри.</b> <span class="plates-legend inline"><span><i class="u"></i>проведено</span> — вже відтреноване; <span><i class="b"></i>заплановано</span> — записане на майбутнє; <span><i></i>вільно</span> — ще можна записати.</span></li>
          <li><b>Скасували тренування</b> — воно повертається в абонемент. <b>«Не прийшов»</b> — списується, як проведене.</li>
          <li><b>Гроші.</b> Ціна абонемента ділиться на тренування: 3000 грн за 10 = 300 грн за кожне. У статистиці дохід зʼявляється по мірі тренувань, а не в день продажу.</li>
          <li><b>Коли вільних 1–2</b> — у списку клієнтів зʼявиться ⚠️, а вранці бот нагадає продати новий.</li>
          <li><b>Абонемент закінчився або минув термін</b> — «Абонемент» більше не спишеться. Продайте новий.</li>
          <li><b>Видалили абонемент</b> — його тренування стануть боргом.</li>
        </ol>
        <div class="foot"><button class="btn blue" data-act="close">Зрозуміло</button></div>`);
    },
    async debtRemind(d) {
      const r = await must("debt_remind", { client_id: +d.id });
      if (r.sent) toast("Нагадування надіслано в Telegram"); else await shareText(r.text, "Текст скопійовано — надішліть клієнту");
    },
    editProgram(d) { const c = clientById(+d.id); if (c) programSheet(c); },
    progAdd() { progDraft.push({ name: "", sets: "", reps: "", weight: "", note: "", day: "" }); drawProgram(+$("[data-act=saveProgram]").dataset.id); setTimeout(() => { const ins = $$("[data-pf=name]"); ins[ins.length - 1]?.focus(); }, 30); },
    progRm(d) { progDraft.splice(+d.i, 1); drawProgram(+$("[data-act=saveProgram]").dataset.id); },
    async saveProgram(d) {
      await must("client_program", { id: +d.id, program: progDraft.filter((r) => String(r.name || "").trim()) });
      closeSheet(); toast("Програму збережено"); await refreshBase(); render();
    },
    async newMeasure(d) { measureSheet(null, +d.id); },
    async editMeasure(d) { const j = await must("client_history", { id: st.clientId }); const m = (j.measures || []).find((x) => x.id === +d.id); if (m) measureSheet(m, m.client_id); },
    async saveMeasure(d) {
      const v = (id) => $("#" + id).value.replace(",", ".");
      await must("measure_save", { measure: { id: d.id ? +d.id : undefined, client_id: +d.client, day: v("ms-day"), weight: v("ms-weight"), waist: v("ms-waist"), hips: v("ms-hips"), chest: v("ms-chest"), fat: v("ms-fat"), note: $("#ms-note").value } });
      closeSheet(); toast("Замір збережено"); render();
    },
    deleteMeasure(d) { askConfirm("Видалити цей замір?", "Видалити", async () => { await must("measure_delete", { id: +d.id }); closeSheet(); toast("Видалено"); render(); }); },
    newExpense() { expenseSheet(null); },
    editExpense(d) { const e = (st.expenses || []).find((x) => x.id === +d.id); if (e) expenseSheet(e); },
    expCat(d, el) { const bg = $("#sheet"); bg.dataset.cat = d.cat; bg.querySelectorAll("[data-act=expCat]").forEach((b) => b.setAttribute("aria-pressed", b === el)); },
    async saveExpense(d) {
      await must("expense_save", { expense: { id: d.id ? +d.id : undefined, amount: $("#ex-amount").value.replace(",", "."), day: $("#ex-day").value, cat: $("#sheet").dataset.cat, note: $("#ex-note").value } });
      closeSheet(); toast("Витрату збережено"); render();
    },
    deleteExpense(d) { askConfirm("Видалити витрату?", "Видалити", async () => { await must("expense_delete", { id: +d.id }); closeSheet(); toast("Видалено"); render(); }); },
    goalSheet() {
      openSheet(`<h2>Ціль на місяць<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
        <label class="field"><span>Скільки хочете заробляти за місяць, грн</span><input id="g-goal" type="number" inputmode="numeric" value="${st.settings.month_goal || ""}" placeholder="40000"></label>
        <div class="foot"><button class="btn blue" data-act="saveGoal">Зберегти</button></div>`, (bg) => $("#g-goal", bg).focus());
    },
    async saveGoal() { await must("settings_save", { settings: { month_goal: +$("#g-goal").value || 0 } }); closeSheet(); await refreshBase(); toast("Ціль збережено"); render(); },
    async backupNow() { if (DEMO) { toast("Резервна копія працює в робочій версії"); return; } await must("backup_now"); await refreshBase(); toast("Файл надіслано у ваш Telegram"); render(); },
    async toggleBackup(d, el) { await must("settings_save", { settings: { backup_weekly: el.checked } }); await refreshBase(); toast(el.checked ? "Щотижнева копія увімкнена" : "Щотижнева копія вимкнена"); },
    async payDebt(d) { await must("participant_pay", { id: +d.id, pay: "paid" }); toast("Борг закрито"); await refreshBase(); render(); },
    newPackage() { packageSheet(null, st.clientId); },
    editPackage(d) { packageSheet(st.packages.find((p) => p.id === +d.id)); },
    async savePackage(d) {
      const v = (id) => $("#" + id).value;
      await must("package_save", { package: { id: d.id ? +d.id : undefined, client_id: +d.client, sessions_total: v("p-n"), price: v("p-price"), bought_on: v("p-bought"), expires_on: v("p-exp"), title: v("p-title"), paid: $("#p-paid").checked } });
      const ret = pkgReturn; pkgReturn = null;
      await refreshBase();
      if (ret && draft && draft.participants[ret.i]) { draft.participants[ret.i].pay = "package"; draft.participants[ret.i].package_id = null; drawSessionSheet(); toast("Абонемент оформлено — тренування спишеться з нього"); return; }
      closeSheet(); toast("Абонемент збережено"); render();
    },
    pkgBack() { pkgReturn = null; drawSessionSheet(); },
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
    planOpenDay(d) { st.tab = "schedule"; st.date = d.day; st.mode = "day"; render(); window.scrollTo(0, 0); },
    planToday() { st.planDate = today(); render(); },
    planShift(d) { st.planDate = addDays(st.planDate, +d.n); render(); },
    newPlan() { planSheet(null); },
    async editPlan(d) {
      let p = (st.plans || []).find((x) => x.id === +d.id);
      if (!p) { const j = await must("plans_range", { from: addDays(st.date, -1), to: addDays(st.date, 8) }); p = j.plans.find((x) => x.id === +d.id); }
      if (p) planSheet(p);
    },
    planCat(d, el) { const bg = $("#sheet"); bg.dataset.cat = d.cat; bg.querySelectorAll("[data-act=planCat]").forEach((b) => b.setAttribute("aria-pressed", b === el)); },
    async savePlan(d) {
      const v = (id) => $("#" + id).value;
      const day = v("pl-day");
      const r = await must("plan_save", { plan: { id: d.id ? +d.id : undefined, title: v("pl-title"), day, time: v("pl-time"), duration_min: v("pl-dur"), remind_min: +v("pl-rem"), place: v("pl-place"), note: v("pl-note"), cat: $("#sheet").dataset.cat }, repeat_weeks: $("#pl-rep") ? +$("#pl-rep").value : 0 });
      closeSheet(); toast(r.created > 1 ? `Заплановано ${r.created} рази щотижня` : "Збережено");
      if (st.tab === "plans") st.planDate = day;
      render();
    },
    deletePlan(d) {
      const p = (st.plans || []).find((x) => x.id === +d.id);
      if (p && p.series) {
        openSheet(`<h2>Видалити план<button class="icon-btn" data-act="close" aria-label="Закрити">${ICON.close}</button></h2>
          <p style="margin:0 0 16px">«${esc(p.title)}» повторюється щотижня.</p>
          <div class="foot col"><button class="btn red" data-act="delPlanSeries" data-id="${p.id}" data-scope="one">Лише цей</button><button class="btn red" data-act="delPlanSeries" data-id="${p.id}" data-scope="future">Цей і всі наступні</button></div>`);
        return;
      }
      askConfirm("Видалити цей план?", "Видалити", async () => { await must("plan_delete", { id: +d.id }); closeSheet(); toast("Видалено"); render(); });
    },
    async delPlanSeries(d) { const r = await must("plan_delete", { id: +d.id, scope: d.scope }); closeSheet(); toast(`Видалено: ${r.deleted || 1}`); render(); },
    async planDone(d) { await must("plan_done", { id: +d.id, done: d.done === "1" }); render(); },
    statsPeriod(d) { st.statsPeriod = d.p; render(); },
    statsShift(d) {
      const n = +d.n, x = D(st.statsDate);
      if (st.statsPeriod === "week") st.statsDate = addDays(st.statsDate, 7 * n);
      else if (st.statsPeriod === "month") { x.setDate(1); x.setMonth(x.getMonth() + n); st.statsDate = iso(x); }
      else { x.setFullYear(x.getFullYear() + n); st.statsDate = iso(x); }
      render();
    },
    async saveSettings() {
      await must("settings_save", { settings: { trainer_name: $("#s-name").value, digest_morning: $("#s-morning").value, digest_evening: $("#s-evening").value, remind_before_min: +$("#s-remind").value, gym_address: $("#s-gym").value, month_goal: +$("#s-goal").value || 0 } });
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
          ${s.tg_linked ? `<a class="btn blue wide" href="https://t.me/${esc(s.bot_username)}" target="_blank" rel="noopener">Відкрити бота</a>
          <button class="btn light wide" style="margin-top:8px" data-act="tgTrainer">Підключити інший Telegram-акаунт</button>` : '<button class="btn blue wide" data-act="tgTrainer">Підключити мій Telegram</button>'}
          <p class="hint" style="margin-top:10px">${s.tg_linked ? "На інших пристроях з тим самим Telegram нічого підключати не треба — бот уже працює." : "У Telegram натисніть «Старт», а потім кнопку «📱 Надіслати мій номер» унизу екрана."}</p>
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
        <label class="field"><span>Новий пароль — лише якщо хочете змінити</span><input id="pin-new" type="password" autocomplete="off" placeholder="Залиште порожнім, щоб не змінювати"></label>
        <label class="field"><span>Повторіть новий пароль</span><input id="pin-new2" type="password" autocomplete="off"></label>
        <label class="toggle" style="margin:-4px 0 10px"><input type="checkbox" data-act="pinShow"> Показати паролі</label>
        <label class="field"><span>Поточний пароль — для підтвердження змін</span><input id="pin-old" type="password" autocomplete="current-password"></label>
        <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Якщо iPhone запропонує «надійний пароль» — краще відмовтесь і введіть свій, щоб його памʼятати. Після зміни пароля інші пристрої вийдуть із системи. Якщо зміните номер — Telegram треба буде підключити заново.</p>
        <div class="foot"><button class="btn blue" data-act="doChangePin">Зберегти</button></div>`);
    },
    pinShow(d, el) { for (const id of ["pin-new", "pin-new2", "pin-old"]) { const i = $("#" + id); if (i) i.type = el.checked ? "text" : "password"; } },
    async doChangePin() {
      if (DEMO) { closeSheet(); toast("У демо вхід не потрібен"); return; }
      if ($("#pin-new").value !== $("#pin-new2").value) { toast("Нові паролі не збігаються", true); return; }
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
    if (st.tab === "plans") return renderPlans();
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

  // ───── Адмінка розробника (#admin) ─────
  let atoken = ""; try { atoken = localStorage.getItem("trainer-admin") || ""; } catch { /* */ }
  async function acall(action, body = {}) {
    if (DEMO) return { ok: false, error: "Адмінка працює лише з сервером" };
    try {
      const r = await fetch(API_URL, { method: "POST", headers: { "content-type": "application/json", ...(atoken ? { authorization: "Bearer " + atoken } : {}) }, body: JSON.stringify({ action, ...body }) });
      return await r.json();
    } catch { return { ok: false, error: "Немає зʼєднання з сервером" }; }
  }
  async function showAdmin(msg = "") {
    root.onclick = null; root.onsubmit = null;
    if (!atoken) {
      const stt = await acall("admin_state");
      const setup = stt.ok && !stt.exists;
      root.innerHTML = `<form class="login" novalidate><h1>🛠 Адмінка</h1><p>${setup ? "Створіть вхід розробника. Потрібен одноразовий код." : "Вхід для розробника."}</p>
        ${setup ? '<label class="field"><span>Код</span><input id="a-code" autocomplete="off"></label>' : ""}
        <label class="field"><span>Номер телефону</span><input id="a-phone" type="tel" autocomplete="username"></label>
        <label class="field"><span>Пароль</span><input id="a-pass" type="password" autocomplete="${setup ? "new-password" : "current-password"}"></label>
        <div class="err" role="alert">${esc(msg || (stt.ok ? "" : stt.error || ""))}</div>
        <button class="btn blue wide" type="submit">${setup ? "Створити" : "Увійти"}</button>
        <button class="btn light wide" type="button" data-a="exit" style="margin-top:10px">До журналу</button></form>`;
      root.onclick = (e) => { if (e.target.closest("[data-a=exit]")) { location.hash = ""; location.reload(); } };
      root.onsubmit = async (e) => {
        e.preventDefault();
        const j = await acall(setup ? "admin_setup" : "admin_login", { code: $("#a-code")?.value, phone: $("#a-phone").value, password: $("#a-pass").value });
        if (!j.ok) return showAdmin(j.error);
        atoken = j.token; try { localStorage.setItem("trainer-admin", atoken); } catch { /* */ }
        showAdmin();
      };
      return;
    }
    const j = await acall("admin_status");
    if (!j.ok) { if (j.error === "auth") { atoken = ""; try { localStorage.removeItem("trainer-admin"); } catch { /* */ } } return showAdmin(j.error === "auth" ? "" : j.error); }
    const row = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    const dt = (x) => (x ? new Date(x).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "—");
    root.innerHTML = `<div class="app admin">
      <header class="top"><div class="top-row"><h1 class="title">🛠 Адмінка</h1><button class="chip-btn" data-a="refresh">Оновити</button></div></header>
      ${msg ? `<div class="card" role="status">${esc(msg)}</div>` : ""}
      <div class="card"><h3>Тренер</h3><div class="rows">${row("Імʼя", esc(j.trainer.name || "—"))}${row("Номер входу", esc(j.trainer.phone || "—"))}${row("Номер Telegram", esc(j.trainer.tg_phone || "—"))}${row("Пароль", j.trainer.has_password ? "є" : "немає")}${row("Telegram", j.trainer.tg_linked ? "✅ підключено" : "❌ ні")}</div>
        <div class="actions" style="margin-top:12px;flex-wrap:wrap"><button class="btn blue" data-a="imp">Увійти як тренер</button><button class="btn light" data-a="pass">Новий пароль тренеру</button></div></div>
      <div class="card"><h3>Дані</h3><div class="rows">${Object.entries(j.counts).map(([k, v]) => row({ clients: "Клієнти", packages: "Абонементи", sessions: "Тренування", parts: "Учасники тренувань", moves: "Переноси", plans: "Плани", expenses: "Витрати", measures: "Заміри" }[k] || k, v)).join("")}</div></div>
      <div class="card"><h3>Бот</h3><div class="rows">${row("Бот", j.bot.username ? "@" + esc(j.bot.username) : "—")}${row("Вбудований", j.bot.managed ? "так" : "ні")}${row("Webhook", j.bot.webhook ? esc(j.bot.webhook.url) : "—")}${row("У черзі", j.bot.webhook ? j.bot.webhook.pending : "—")}${j.bot.webhook && j.bot.webhook.last_error ? row("Остання помилка", esc(j.bot.webhook.last_error) + " · " + dt(j.bot.webhook.last_error_at)) : ""}</div>
        <div class="actions" style="margin-top:12px;flex-wrap:wrap"><button class="btn light" data-a="msg">Тест-повідомлення тренеру</button><button class="btn light" data-a="backup">Резервна копія</button></div></div>
      <div class="card"><h3>Розклад перевірок</h3><div class="rows">${row("Остання перевірка", dt(j.ticks.last))}${row("Ранковий план", esc(j.ticks.morning || "—"))}${row("Вечірній підсумок", esc(j.ticks.evening || "—"))}${row("Резервна копія", dt(j.ticks.backup))}${row("Час сервера (Київ)", esc(j.local.day + " " + j.local.hm))}</div>
        <p class="hint" style="margin-top:10px">Для точних нагадувань до хвилини додайте це посилання в cron-job.org (щохвилини, GET):</p>
        <div class="copy-row"><input id="a-tick" readonly value="${esc(j.tick_url)}"><button class="btn light" data-a="copy">Копіювати</button></div>
        <div class="actions" style="margin-top:12px"><button class="btn light" data-a="tick">Запустити перевірку зараз</button><button class="btn light" data-a="thr">Зняти блокування спроб</button></div></div>
      <div class="card"><h3 class="row-h"><span>Помилки (${j.errors.length})</span>${j.errors.length ? '<button class="chip-btn sm" data-a="clr">Очистити</button>' : ""}</h3>
        ${j.errors.length ? `<ul class="errs">${j.errors.map((e) => `<li><small>${dt(e.at)} · ${esc(e.where)}</small><code>${esc(e.msg)}</code></li>`).join("")}</ul>` : '<div class="none">Помилок немає 👌</div>'}</div>
      <div style="padding:0 16px 32px;display:grid;gap:8px"><button class="btn light wide" data-a="exit">До журналу</button><button class="btn light wide" data-a="out">Вийти з адмінки</button><button class="btn red wide" data-a="outall">Вийти з адмінки на всіх пристроях</button></div>
    </div>`;
    root.onclick = async (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const a = b.dataset.a, run = async (action, body, okMsg) => { const r = await acall(action, body); showAdmin(r.ok ? okMsg(r) : "⚠️ " + r.error); };
      if (a === "refresh") return showAdmin();
      if (a === "imp") { const r = await acall("admin_impersonate"); if (!r.ok) return showAdmin("⚠️ " + r.error); token = r.token; localStorage.setItem("trainer-token", token); location.hash = ""; root.onclick = null; return start(); }
      if (a === "pass") { const p = prompt("Новий пароль для тренера (від 8 символів, літери й цифри):"); if (p) return run("admin_set_trainer_password", { password: p }, () => "Пароль тренера змінено. Тренера на інших пристроях виведено."); return; }
      if (a === "msg") return run("admin_test_message", { text: "Перевірка звʼязку" }, () => "Повідомлення надіслано тренеру");
      if (a === "backup") return run("admin_backup", {}, () => "Резервну копію надіслано тренеру в Telegram");
      if (a === "tick") return run("admin_tick", {}, (r) => "Перевірку виконано: " + (r.done.length ? r.done.join(", ") : "нічого не треба було надсилати"));
      if (a === "thr") return run("admin_reset_throttles", {}, (r) => "Знято блокувань: " + r.cleared);
      if (a === "clr") return run("admin_clear_errors", {}, () => "Журнал помилок очищено");
      if (a === "copy") { const i = $("#a-tick"); i.select(); try { await navigator.clipboard.writeText(i.value); } catch { /* */ } return toast("Скопійовано"); }
      if (a === "exit") { location.hash = ""; location.reload(); return; }
      if (a === "out" || a === "outall") { if (a === "outall") await acall("admin_logout_all"); atoken = ""; try { localStorage.removeItem("trainer-admin"); } catch { /* */ } return showAdmin(); }
    };
  }

  async function start() {
    try { await refreshBase(); } catch { return; }
    render();
  }
  // Дата українською: системне поле iPhone показує дату мовою телефону, тож малюємо свій підпис поверх
  const MON_G = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
  const uaDate = (v) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return ""; const [y, m, d] = v.split("-").map(Number); return `${d} ${MON_G[m - 1]}${y !== new Date().getFullYear() ? " " + y : ""}`; };
  function dateUa(inp) {
    if (inp.dataset.ua) return;
    inp.dataset.ua = "1";
    const wrap = document.createElement("span"); wrap.className = "dt-wrap";
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    const show = document.createElement("span"); show.className = "dt-show"; show.setAttribute("aria-hidden", "true"); wrap.appendChild(show);
    const upd = () => { const t = uaDate(inp.value); show.textContent = t || "оберіть дату"; show.classList.toggle("empty", !t); };
    inp.addEventListener("input", upd); inp.addEventListener("change", upd); upd();
  }
  new MutationObserver(() => document.querySelectorAll('input[type="date"]:not([data-ua])').forEach(dateUa)).observe(document.body, { childList: true, subtree: true });

  // iPhone ігнорує user-scalable=no, тому блокуємо масштабування жестами вручну
  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.scale !== undefined && e.scale !== 1) e.preventDefault(); }, { passive: false });
  // подвійний дотик вимкнено через touch-action: manipulation (CSS) — швидкі натискання кнопок не губляться
  if ("serviceWorker" in navigator && location.protocol === "https:" && !DEMO) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (location.hash === "#admin") showAdmin();
  else if (DEMO || (token && !/reset=/.test(location.hash))) start(); else showLogin();
})();
