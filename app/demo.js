// Демо-сервер у браузері: та сама логіка, що й на бекенді, дані — в localStorage.
(function () {
  const KEY = "trainer-demo-v1";
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
    S(0, "10:00", [[ira, 350]]); S(0, "17:30", [[masha, 400]]); S(0, "18:30", [[yulia, 400]]); S(0, "19:30", [[nadia, 0, "package"]]);
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
    return db;
  }

  const load = () => { try { const j = localStorage.getItem(KEY); if (j) return JSON.parse(j); } catch {} return seed(); };
  let db = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const nid = () => db.seq++;
  const fail = (m) => { throw Object.assign(new Error(m), { api: true }); };
  const used = (pkId, exSess = -1) => db.participants.filter((x) => x.package_id === pkId && x.session_id !== exSess && (db.sessions.find((s) => s.id === x.session_id) || {}).status !== "cancelled").length;
  const withUse = (p) => ({ ...p, used: used(p.id) });
  const pickPackage = (cid, exSess) => db.packages.filter((p) => p.client_id === cid && (!p.expires_on || p.expires_on >= today()))
    .sort((a, b) => (a.bought_on < b.bought_on ? -1 : 1)).find((p) => used(p.id, exSess) < p.sessions_total);
  const fullSession = (s) => ({
    ...s,
    participants: db.participants.filter((p) => p.session_id === s.id).map((p) => ({ ...p, name: (db.clients.find((c) => c.id === p.client_id) || {}).name })),
    moves: db.moves.filter((m) => m.session_id === s.id),
  });

  const A = {
    status: () => ({ needs_setup: false, trainer_name: db.settings.trainer_name }),
    login: () => ({ token: "demo" }),
    setup_pin: () => ({ token: "demo" }),
    bootstrap() {
      const t = today();
      return {
        clients: db.clients.map((c) => {
          const ps = db.participants.filter((p) => p.client_id === c.id).map((p) => ({ p, s: db.sessions.find((s) => s.id === p.session_id) })).filter((x) => x.s && x.s.status !== "cancelled");
          const past = ps.filter((x) => x.s.day <= t).map((x) => x.s.day).sort();
          return { ...c, visits: ps.length, last_visit: past[past.length - 1] || null, debt: ps.filter((x) => x.p.pay === "debt").reduce((a, x) => a + Number(x.p.price), 0) };
        }).sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name, "uk")),
        packages: db.packages.map(withUse),
        settings: { ...db.settings, bot_username: "", tg_linked: false, bot_ready: false, phone_hint: "" },
      };
    },
    range: (b) => ({ sessions: db.sessions.filter((s) => s.day >= b.from && s.day <= b.to).sort((a, c) => (a.day + a.start_time).localeCompare(c.day + c.start_time)).map(fullSession) }),
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
      return { history: h, packages: db.packages.filter((p) => p.client_id === b.id).map(withUse), moves: db.moves.filter((m) => sids.has(m.session_id)).length };
    },
    session_save(b) {
      const s = b.session || {}; const parts = b.participants || [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.day || "") || !/^\d{1,2}:\d{2}$/.test(s.start_time || "")) fail("Вкажіть дату й час");
      if (!parts.length && !(s.kind === "group" || Number(s.extra_amount) > 0)) fail("Додайте клієнта");
      const vals = { day: s.day, start_time: s.start_time.padStart(5, "0"), duration_min: Number(s.duration_min) || 60, kind: s.kind || "personal", title: s.title || null, extra_amount: Number(s.extra_amount) || 0, note: s.note || null };
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
      if (row) Object.assign(row, vals); else { row = { id: nid(), status: "planned", ...vals }; db.sessions.push(row); }
      db.participants = db.participants.filter((x) => x.session_id !== row.id).concat(prepared.map((p) => ({ id: nid(), session_id: row.id, ...p })));
      return { id: row.id };
    },
    session_status(b) { const s = db.sessions.find((x) => x.id === b.id); if (s) s.status = b.status; return {}; },
    session_move(b) {
      const s = db.sessions.find((x) => x.id === b.id); if (!s) fail("Тренування не знайдено");
      db.moves.push({ id: nid(), session_id: s.id, from_day: s.day, from_time: s.start_time, to_day: b.day, to_time: b.start_time.padStart(5, "0"), reason: b.reason || null, created_at: new Date().toISOString() });
      s.day = b.day; s.start_time = b.start_time.padStart(5, "0"); s.status = "planned"; return {};
    },
    session_delete(b) { db.sessions = db.sessions.filter((s) => s.id !== b.id); db.participants = db.participants.filter((p) => p.session_id !== b.id); db.moves = db.moves.filter((m) => m.session_id !== b.id); return {}; },
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
