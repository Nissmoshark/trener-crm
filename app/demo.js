// Демо-сервер у браузері: та сама логіка, що й на бекенді, дані — в localStorage.
(function () {
  const KEY = "trainer-demo-v2";
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());

  function seed() {
    const db = { seq: 1, clients: [], packages: [], sessions: [], participants: [], moves: [], settings: { remind_before_min: 120, digest_morning: "08:00", digest_evening: "21:00", trainer_name: "" } };
    const id = () => db.seq++;
    const C = (name, price, phone = "", notes = "") => { const c = { id: id(), name, phone, price, notes, remind: true, archived: false, tg_chat_id: null, created_at: new Date().toISOString() }; db.clients.push(c); return c.id; };
    const ira = C("Макарова Іра", 350, "0509692301", "Ягодиці: розгинання колін з резинкою, місток з м'ячем, болгарські присідання, румунська тяга");
    const masha = C("Духненко Марія", 400, "0671234567");
    const yulia = C("Медведева Юля", 400, "0931112233");
    const nadia = C("Циціліна Надя", 350, "0501234455");
    const vova = C("Сімірецький Вова", 350, "0661239876");
    const tanya = C("Кузьміна Таня", 400, "0979876543");
    const natali = C("Ровна Наталі", 400);
    const mariaN = C("Нехова Марія", 400, "0632223344");
    const olena = C("Старченко Олена", 400);
    const igor = C("Старченко Ігор", 400);
    const nastya = C("Оберемчук Настя", 400);
    const dasha = C("Озерова Даша", 400, "0953334455");
    const anastasia = C("Анастасія", 400, "0509692301");
    const arina = C("Чагір Аріна", 400);
    const alla = C("Сидоренко Алла", 400);
    const dinys = C("Михайлов Диніс", 350);
    const pk = { id: id(), client_id: nadia, title: "8 тренувань", sessions_total: 8, price: 2400, paid: true, bought_on: addDays(today(), -10), expires_on: null };
    db.packages.push(pk);
    const mon = (() => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d); })();
    const S = (dayOff, time, parts, extra = {}) => {
      const s = { id: id(), day: addDays(mon, dayOff), start_time: time, duration_min: 60, kind: "personal", title: null, status: "planned", extra_amount: 0, note: null, ...extra };
      db.sessions.push(s);
      for (const [cid, price, pay = "paid"] of parts) db.participants.push({ id: id(), session_id: s.id, client_id: cid, price: pay === "package" ? 300 : price, pay, package_id: pay === "package" ? pk.id : null });
      return s;
    };
    S(-7, "10:00", [[ira, 350]], { note: "Ягодиці: місток 4×12, болгарські 3×10" }); S(-7, "17:30", [[masha, 400]], { note: "Спина: тяга верхнього блоку, гіперекстензія" });
    S(0, "10:00", [[ira, 350]]); S(0, "17:30", [[masha, 400]]); S(0, "18:30", [[yulia, 400]], { online: true }); S(0, "19:30", [[nadia, 0, "package"]]);
    S(1, "09:00", [[natali, 400]]); S(1, "14:00", [[mariaN, 400]]); S(1, "15:00", [[vova, 350]]); S(1, "16:30", [[olena, 400], [igor, 400]], { kind: "split" });
    S(2, "10:00", [[ira, 350]]); S(2, "12:00", [[anastasia, 400]]); S(2, "13:00", [[mariaN, 400]]); S(2, "14:00", [[arina, 400, "debt"]]); S(2, "16:00", [[alla, 400]]); S(2, "16:30", [[dinys, 400]]); S(2, "18:30", [[yulia, 400]]);
    S(3, "16:30", [[vova, 350]]); S(3, "17:30", [[tanya, 400]]); S(3, "18:30", [], { kind: "group", title: "Група", extra_amount: 900 }); S(3, "19:30", [[nadia, 0, "package"]]);
    S(4, "10:00", [[ira, 350]]); S(4, "11:00", [[nastya, 400]]); const m = S(4, "19:00", [[dasha, 400]]);
    db.moves.push({ id: id(), session_id: m.id, from_day: addDays(mon, 3), from_time: "20:00", to_day: m.day, to_time: "19:00", reason: "Попросила перенести", created_at: new Date().toISOString() });
    S(5, "11:00", [[dinys, 350]]); S(5, "12:00", [[tanya, 400]]);
    // минулий тиждень для статистики
    for (let w = 1; w <= 3; w++) {
      S(-7 * w, "10:00", [[ira, 350]]); S(-7 * w + 1, "15:00", [[vova, 350]]); S(-7 * w + 1, "17:30", [[tanya, 400]]);
      S(-7 * w + 2, "13:00", [[mariaN, 400]]); S(-7 * w + 3, "18:30", [], { kind: "group", title: "Група", extra_amount: 800 });
      S(-7 * w + 4, "19:00", [[dasha, 400]]); S(-7 * w + 5, "12:00", [[masha, 400]]);
      if (w === 2) S(-7 * w + 2, "16:00", [[alla, 400]], { status: "cancelled" });
    }
    db.expenses = [{ id: id(), day: addDays(today(), -3), amount: 4000, cat: "rent", note: "Оренда залу" }, { id: id(), day: addDays(today(), -1), amount: 650, cat: "gear", note: "Резинки" }];
    db.measures = [{ id: id(), client_id: ira, day: addDays(today(), -42), weight: 68.4, waist: 74, hips: 99, chest: null, fat: 27, note: null }, { id: id(), client_id: ira, day: addDays(today(), -21), weight: 67.1, waist: 72, hips: 98, chest: null, fat: 26, note: null }, { id: id(), client_id: ira, day: addDays(today(), -2), weight: 66.2, waist: 70.5, hips: 97, chest: null, fat: 25, note: null }];
    db.clients.find((c) => c.id === ira).program = JSON.stringify([{ day: "День 1: ноги", name: "Розгинання колін з резинкою", sets: "3", reps: "15", weight: "", note: "" }, { name: "Місток з мʼячем", sets: "4", reps: "12", weight: "", note: "пауза вгорі 2 с" }, { name: "Болгарські присідання", sets: "3", reps: "10", weight: "2×8 кг", note: "" }, { name: "Румунська тяга", sets: "4", reps: "10", weight: "30 кг", note: "" }]);
    db.settings.month_goal = 40000; db.settings.gym_address = "Зал «Сила», вул. Сирецька 5";
    db.plans = [
      { id: id(), day: today(), time: "13:00", duration_min: 60, title: "Перукар", place: "Салон на Липках", note: null, cat: "beauty", remind_min: 60, reminded: false, done: false },
      { id: id(), day: today(), time: null, duration_min: 0, title: "Купити протеїн і резинки", place: null, note: null, cat: "errand", remind_min: 0, reminded: false, done: false },
      { id: id(), day: addDays(today(), 2), time: "08:30", duration_min: 30, title: "Стоматолог", place: null, note: "Взяти виписку", cat: "health", remind_min: 120, reminded: false, done: false },
    ];
    return db;
  }

  const load = () => { try { const j = localStorage.getItem(KEY); if (j) return JSON.parse(j); } catch {} return seed(); };
  let db = load();
  db.plans ||= []; db.expenses ||= []; db.measures ||= []; db.notes ||= [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const nid = () => db.seq++;
  const fail = (m) => { throw Object.assign(new Error(m), { api: true }); };
  const used = (pkId, exSess = -1) => db.participants.filter((x) => x.package_id === pkId && x.session_id !== exSess && (db.sessions.find((s) => s.id === x.session_id) || {}).status !== "cancelled").length;
  const withUse = (p) => ({ ...p, used: used(p.id), used_done: db.participants.filter((x) => x.package_id === p.id && (db.sessions.find((s) => s.id === x.session_id) || {}).status !== "cancelled" && (db.sessions.find((s) => s.id === x.session_id) || {}).day <= today()).length });
  const pickPackage = (cid, exSess) => db.packages.filter((p) => p.client_id === cid && (!p.expires_on || p.expires_on >= today()))
    .sort((a, b) => (a.bought_on < b.bought_on ? -1 : 1)).find((p) => used(p.id, exSess) < p.sessions_total);
  // нотатка з попереднього тренування клієнта (як на сервері)
  const withPrev = (s) => {
    if (s.participants.length !== 1) return s;
    const cid = s.participants[0].client_id, key = s.day + " " + s.start_time;
    const prev = db.sessions.filter((x) => x.note && x.day + " " + x.start_time < key && db.participants.some((p) => p.session_id === x.id && p.client_id === cid))
      .sort((a, b) => (b.day + b.start_time).localeCompare(a.day + a.start_time))[0];
    return prev ? { ...s, prev_note: prev.note, prev_day: prev.day } : s;
  };
  const fullSession = (s) => ({
    ...s,
    participants: db.participants.filter((p) => p.session_id === s.id).map((p) => ({ ...p, name: (db.clients.find((c) => c.id === p.client_id) || {}).name })),
    moves: db.moves.filter((m) => m.session_id === s.id),
  });

  const A = {
    status: () => ({ needs_setup: false, trainer_name: db.settings.trainer_name }),
    login: () => ({ token: "demo" }),
    register: () => ({ token: "demo" }),
    setup_pin: () => ({ token: "demo" }),
    bootstrap() {
      const t = today();
      return {
        clients: db.clients.map((c) => {
          const ps = db.participants.filter((p) => p.client_id === c.id).map((p) => ({ p, s: db.sessions.find((s) => s.id === p.session_id) })).filter((x) => x.s && x.s.status !== "cancelled");
          const past = ps.filter((x) => x.s.day <= t).map((x) => x.s.day).sort();
          return { ...c, visits: ps.length, last_visit: past[past.length - 1] || null, debt: ps.filter((x) => x.p.pay === "debt" && x.s.day <= t).reduce((a, x) => a + Number(x.p.price), 0) };
        }).sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name, "uk")),
        packages: db.packages.map(withUse),
        settings: { ...db.settings, bot_username: "", tg_linked: false, bot_ready: false, phone_hint: "", backup_weekly: true },
        subscription: { state: "trial", plan: "basic", pro: true, writable: true, days_left: 14, until: addDays(today(), 14), price_basic: 199, price_pro: 349, mono_url: "", pay_info: "", paid_claim: "" },
      };
    },
    plans_range: (b) => ({ plans: db.plans.filter((p) => p.day >= b.from && p.day <= b.to).sort((a, c) => (a.day + (a.time || "")).localeCompare(c.day + (c.time || ""))) }),
    plan_save(b) {
      const p = b.plan || {}; const title = String(p.title || "").trim(); if (!title) fail("Напишіть, що заплановано");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.day || "")) fail("Вкажіть дату");
      const vals = { day: p.day, time: p.time ? p.time.padStart(5, "0") : null, duration_min: p.time ? Number(p.duration_min) || 0 : 0, title, place: p.place || null, note: p.note || null, cat: p.cat || "personal", remind_min: p.time ? Number(p.remind_min) || 0 : 0 };
      let row; if (p.id) { row = db.plans.find((x) => x.id === p.id); Object.assign(row, vals, { reminded: false }); return { plan: row }; }
      const weeks = Number(b.repeat_weeks) || 0; row = { id: nid(), ...vals, reminded: false, done: false, series: null }; db.plans.push(row);
      if (weeks) { row.series = String(row.id); for (let w = 1; w <= weeks; w++) db.plans.push({ ...row, id: nid(), day: addDays(row.day, 7 * w) }); }
      return { plan: row, created: weeks + 1 };
    },
    notes_list: () => ({ notes: [...db.notes].sort((a, c) => (c.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(c.updated || "").localeCompare(String(a.updated || ""))) }),
    note_save(b) {
      const n = b.note || {}; const title = String(n.title || "").trim(), body = String(n.body || "").trim(); if (!title && !body) fail("Напишіть текст нотатки");
      const vals = { title: title || null, body: body || null, pinned: !!n.pinned, updated: new Date().toISOString() };
      if (n.id) { const row = db.notes.find((x) => x.id === n.id); Object.assign(row, vals); return { note: row }; }
      const row = { id: nid(), ...vals }; db.notes.push(row); return { note: row };
    },
    note_delete(b) { db.notes = db.notes.filter((x) => x.id !== b.id); return {}; },
    plan_done(b) { const p = db.plans.find((x) => x.id === b.id); if (p) p.done = !!b.done; return {}; },
    plan_delete(b) {
      const p0 = db.plans.find((p) => p.id === b.id); if (!p0) return {};
      const ids = new Set(b.scope === "future" && p0.series ? db.plans.filter((p) => p.series === p0.series && p.day >= p0.day).map((p) => p.id) : [p0.id]);
      db.plans = db.plans.filter((p) => !ids.has(p.id)); return { deleted: ids.size };
    },
    range: (b) => ({ plans: db.plans.filter((p) => p.day >= b.from && p.day <= b.to), sessions: db.sessions.filter((s) => s.day >= b.from && s.day <= b.to).sort((a, c) => (a.day + a.start_time).localeCompare(c.day + c.start_time)).map(fullSession).map(withPrev) }),
    client_save(b) {
      const c = b.client || {}; const name = String(c.name || "").trim(); if (!name) fail("Вкажіть ім'я клієнта");
      const vals = { name, phone: c.phone ? String(c.phone).trim() : null, price: c.price === "" || c.price == null ? null : Number(c.price), notes: c.notes || null, remind: c.remind !== false };
      let row; if (c.id) { row = db.clients.find((x) => x.id === c.id); Object.assign(row, vals); } else { row = { id: nid(), ...vals, archived: false, tg_chat_id: null }; db.clients.push(row); }
      return { client: row };
    },
    client_archive(b) { const c = db.clients.find((x) => x.id === b.id); if (c) c.archived = !!b.archived; return {}; },
    client_history(b) {
      const h = db.participants.filter((p) => p.client_id === b.id).map((p) => { const s = db.sessions.find((x) => x.id === p.session_id); return { id: s.id, day: s.day, start_time: s.start_time, kind: s.kind, title: s.title, status: s.status, price: p.price, pay: p.pay, package_id: p.package_id, part_id: p.id }; })
        .sort((a, c) => (c.day + c.start_time).localeCompare(a.day + a.start_time));
      const sids = new Set(h.map((x) => x.id));
      const debts = h.filter((x) => x.pay === "debt" && x.status !== "cancelled" && x.day <= today()).map((x) => ({ part_id: x.part_id, day: x.day, time: x.start_time, price: x.price }));
      return { history: h, packages: db.packages.filter((p) => p.client_id === b.id).map(withUse), moves: db.moves.filter((m) => sids.has(m.session_id)).length, measures: db.measures.filter((m) => m.client_id === b.id).sort((a, c) => a.day.localeCompare(c.day)), debts };
    },
    session_save(b) {
      const s = b.session || {}; const parts = b.participants || [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.day || "") || !/^\d{1,2}:\d{2}$/.test(s.start_time || "")) fail("Вкажіть дату й час");
      if (!parts.length && !(s.kind === "group" || Number(s.extra_amount) > 0)) fail("Додайте клієнта");
      const vals = { day: s.day, start_time: s.start_time.padStart(5, "0"), duration_min: Number(s.duration_min) || 60, kind: s.kind || "personal", title: s.title || null, extra_amount: Number(s.extra_amount) || 0, note: s.note || null, online: !!s.online };
      let row = s.id ? db.sessions.find((x) => x.id === s.id) : null;
      const prepared = parts.map((p) => {
        let pay = p.pay || "paid", price = Number(p.price) || 0, pkg = null;
        if (pay === "package") {
          const cur = row && db.participants.find((x) => x.session_id === row.id && x.client_id === p.client_id);
          pkg = p.package_id || (cur && cur.package_id) || (pickPackage(p.client_id, row ? row.id : -1) || {}).id;
          if (!pkg) fail(`У клієнта ${(db.clients.find((c) => c.id === p.client_id) || {}).name || ""} немає активного абонемента`);
          const pk = db.packages.find((x) => x.id === pkg); price = Math.round((pk.price / pk.sessions_total) * 100) / 100;
        }
        return { client_id: p.client_id, price, pay, package_id: pkg };
      });
      const isNew = !row;
      if (row) Object.assign(row, vals); else { row = { id: nid(), status: "planned", ...vals }; db.sessions.push(row); }
      db.participants = db.participants.filter((x) => x.session_id !== row.id).concat(prepared.map((p) => ({ id: nid(), session_id: row.id, ...p })));
      const weeks = isNew ? Number(b.repeat_weeks) || 0 : 0; let noPkg = 0;
      if (weeks) {
        row.series = String(row.id);
        for (let w = 1; w <= weeks; w++) {
          const c = { ...row, id: nid(), day: addDays(row.day, 7 * w) }; db.sessions.push(c);
          for (const p of prepared) {
            let q = { ...p };
            if (q.pay === "package") { const pk = pickPackage(q.client_id, -1); if (pk) { q.package_id = pk.id; } else { q.pay = "debt"; q.package_id = null; noPkg++; } }
            db.participants.push({ id: nid(), session_id: c.id, ...q });
          }
        }
      }
      return { id: row.id, created: weeks + 1, no_package: noPkg };
    },
    session_status(b) { const s = db.sessions.find((x) => x.id === b.id); if (s) s.status = b.status; return {}; },
    session_move(b) {
      const s = db.sessions.find((x) => x.id === b.id); if (!s) fail("Тренування не знайдено");
      db.moves.push({ id: nid(), session_id: s.id, from_day: s.day, from_time: s.start_time, to_day: b.day, to_time: b.start_time.padStart(5, "0"), reason: b.reason || null, created_at: new Date().toISOString() });
      s.day = b.day; s.start_time = b.start_time.padStart(5, "0"); s.status = "planned"; return {};
    },
    session_delete(b) {
      const s0 = db.sessions.find((s) => s.id === b.id); if (!s0) return {};
      const ids = new Set(b.scope === "future" && s0.series ? db.sessions.filter((s) => s.series === s0.series && s.day >= s0.day).map((s) => s.id) : [s0.id]);
      db.sessions = db.sessions.filter((s) => !ids.has(s.id)); db.participants = db.participants.filter((p) => !ids.has(p.session_id)); db.moves = db.moves.filter((m) => !ids.has(m.session_id)); return { deleted: ids.size };
    },
    participant_pay(b) { const p = db.participants.find((x) => x.id === b.id); if (p && p.pay !== "package") p.pay = b.pay; return {}; },
    package_save(b) {
      const p = b.package || {}; if (!p.client_id || !(Number(p.sessions_total) > 0)) fail("Вкажіть клієнта й кількість тренувань");
      const vals = { client_id: p.client_id, title: p.title || null, sessions_total: Number(p.sessions_total), price: Number(p.price) || 0, paid: p.paid !== false, bought_on: p.bought_on || today(), expires_on: p.expires_on || null };
      let row; if (p.id) { row = db.packages.find((x) => x.id === p.id); Object.assign(row, vals); db.participants.filter((x) => x.package_id === row.id).forEach((x) => (x.price = Math.round((vals.price / vals.sessions_total) * 100) / 100)); }
      else { row = { id: nid(), ...vals }; db.packages.push(row); }
      return { package: row };
    },
    package_delete(b) { db.participants.filter((x) => x.package_id === b.id).forEach((x) => { x.pay = "debt"; x.package_id = null; }); db.packages = db.packages.filter((p) => p.id !== b.id); return {}; },
    settings_save(b) { Object.assign(db.settings, b.settings || {}); return {}; },
    client_program(b) { const c = db.clients.find((x) => x.id === b.id); if (c) c.program = JSON.stringify((b.program || []).filter((r) => r.name)); return { client: c }; },
    debt_remind(b) {
      const c = db.clients.find((x) => x.id === b.client_id) || {};
      const ds = db.participants.filter((p) => p.client_id === b.client_id && p.pay === "debt").map((p) => ({ p, s: db.sessions.find((x) => x.id === p.session_id) })).filter((x) => x.s && x.s.status !== "cancelled" && x.s.day <= today());
      if (!ds.length) fail("У клієнта немає боргу");
      const total = ds.reduce((a, x) => a + Number(x.p.price), 0);
      return { sent: false, total, text: `Привіт, ${c.name}! Нагадую про оплату тренувань:\n${ds.map((x) => `• ${x.s.day}, ${x.s.start_time} — ${x.p.price} грн`).join("\n")}\nРазом: ${total} грн. Дякую! 💪` };
    },
    expenses_range: (b) => ({ expenses: db.expenses.filter((e) => e.day >= b.from && e.day <= b.to).sort((a, c) => c.day.localeCompare(a.day)) }),
    expense_save(b) { const e = b.expense || {}; if (!(Number(e.amount) > 0)) fail("Вкажіть суму"); const vals = { day: e.day, amount: Number(e.amount), cat: e.cat || "other", note: e.note || null }; let row; if (e.id) { row = db.expenses.find((x) => x.id === e.id); Object.assign(row, vals); } else { row = { id: nid(), ...vals }; db.expenses.push(row); } return { expense: row }; },
    expense_delete(b) { db.expenses = db.expenses.filter((e) => e.id !== b.id); return {}; },
    measure_save(b) { const m = b.measure || {}; const n = (x) => (x === "" || x == null ? null : Number(x)); const vals = { client_id: m.client_id, day: m.day, weight: n(m.weight), waist: n(m.waist), hips: n(m.hips), chest: n(m.chest), fat: n(m.fat), note: m.note || null }; if (["weight", "waist", "hips", "chest", "fat"].every((k) => vals[k] == null) && !vals.note) fail("Заповніть хоча б один замір"); let row; if (m.id) { row = db.measures.find((x) => x.id === m.id); Object.assign(row, vals); } else { row = { id: nid(), ...vals }; db.measures.push(row); } return { measure: row }; },
    measure_delete(b) { db.measures = db.measures.filter((m) => m.id !== b.id); return {}; },
    backup_now: () => fail("Резервна копія працює в робочій версії"),
    change_pin: () => ({ token: "demo" }),
    tg_link_trainer: () => fail("У демо-режимі Telegram недоступний"),
    tg_link_client: () => fail("У демо-режимі Telegram недоступний"),
    export: () => ({ clients: db.clients, packages: db.packages, sessions: db.sessions, participants: db.participants, moves: db.moves }),
  };

  window.DemoBackend = {
    async call(action, body) {
      const fn = A[action];
      if (!fn) return { ok: false, error: "Невідома дія" };
      try { const r = fn(body || {}); save(); return { ok: true, ...JSON.parse(JSON.stringify(r)) }; }
      catch (e) { if (e.api) return { ok: false, error: e.message }; console.error(e); return { ok: false, error: "Помилка" }; }
    },
    reset() { db = seed(); save(); },
  };
})();
