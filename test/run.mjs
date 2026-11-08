// Тести логіки сервера на сховищі в пам'яті (та ж поведінка, що й в Appwrite: 404/409, рядкові id).
import assert from "node:assert/strict";
import { createCore } from "../functions/trainer/src/core.js";

function memStore() {
  const db = {};
  const err = (status) => Object.assign(new Error("e" + status), { status });
  const col = (c) => (db[c] ??= new Map());
  const val = (d, f) => (f === "id" ? d.id : d[f]);
  const match = (d, [f, op, v]) => {
    const x = val(d, f);
    if (op === "eq") return x === v;
    if (op === "in") return v.includes(x);
    if (op === "ne") return x !== v;
    if (op === "gte") return x != null && x >= v;
    if (op === "lte") return x != null && x <= v;
    if (op === "null") return x == null;
  };
  const norm = (id) => (/^\d+$/.test(String(id)) ? Number(id) : String(id));
  return {
    db,
    async get(c, id) { const d = col(c).get(norm(id)); return d ? structuredClone(d) : null; },
    async list(c, f = []) { return [...col(c).values()].filter((d) => f.every((x) => match(d, x))).map((d) => structuredClone(d)); },
    async create(c, data, id) {
      const k = norm(id ?? data.id);
      if (col(c).has(k)) throw err(409);
      const d = { ...structuredClone(data), id: k, created_at: new Date().toISOString() };
      col(c).set(k, d); return structuredClone(d);
    },
    async update(c, id, data) {
      const d = col(c).get(norm(id)); if (!d) throw err(404);
      Object.assign(d, structuredClone(data)); return structuredClone(d);
    },
    async remove(c, id) { col(c).delete(norm(id)); },
  };
}

let clock = Date.parse("2026-11-09T06:00:00Z"); // 08:00 Київ, понеділок
const sent = [];
const tgFetch = async (url, init) => {
  const m = url.split("/").pop(), b = JSON.parse(init.body);
  if (m === "getMe") return { json: async () => (url.includes("bad") ? { ok: false } : { ok: true, result: { username: "trener_test_bot" } }) };
  if (m === "sendMessage") sent.push(b);
  return { json: async () => ({ ok: true }) };
};
const st = memStore();
const core = createCore(st, { now: () => clock, tgFetch, iterations: 1000, publicUrl: "https://fn.test" });
const H = (tok) => (tok ? { authorization: "Bearer " + tok } : {});
let n = 0;
async function call(action, body = {}, tok, ctx = { ip: "1.1.1.1" }) { const [code, j] = await core.api({ action, ...body }, H(tok), ctx); return { code, ...j }; }
async function ok(action, body, tok) { const j = await call(action, body, tok); assert.equal(j.ok, true, `${action}: ${j.error}`); n++; return j; }
async function bad(action, body, tok, msg) { const j = await call(action, body, tok); assert.equal(j.ok, false, action); if (msg) assert.match(j.error, msg); n++; return j; }

// ── Вхід ──
assert.equal((await ok("status")).needs_setup, true);
await bad("bootstrap", {}, "", /auth/);
await bad("setup", { phone: "050 123 45 67", password: "short1" }, null, /8 символів/);
await bad("setup", { phone: "050 123 45 67", password: "onlyletters" }, null, /літери й цифри/);
await bad("setup", { phone: "12", password: "Trener2026" }, null, /номер/);
let tok = (await ok("setup", { name: "Олег", phone: "050 123 45 67", password: "Trener2026", _app: "https://trener.appwrite.network/" })).token;
await bad("setup", { phone: "0501234567", password: "Trener2026x" }, null, /уже створено/);
assert.equal((await ok("status")).needs_setup, false);
await bad("login", { phone: "0501234567", password: "wrong12345" }, null, /Невірний/);
await bad("login", { phone: "0991234567", password: "Trener2026" }, null, /Невірний/);
tok = (await ok("login", { phone: "+38 (050) 123-45-67", password: "Trener2026" })).token;
const b0 = await ok("bootstrap", {}, tok);
assert.equal(b0.settings.trainer_name, "Олег");
assert.match(b0.settings.phone_hint, /45 67$/);
await bad("bootstrap", {}, tok.slice(0, -2) + "xx", /auth/);
// блокування після 5 невдалих спроб
for (let i = 0; i < 5; i++) await call("login", { phone: "0501234567", password: "nope12345" });
await bad("login", { phone: "0501234567", password: "Trener2026" }, null, /Забагато спроб/);
clock += 16 * 60000;
await ok("login", { phone: "0501234567", password: "Trener2026" });

// ── Клієнти, тренування ──
const ira = (await ok("client_save", { client: { name: "Іра", phone: "0671112233", price: 350 } }, tok)).client;
const ivan = (await ok("client_save", { client: { name: "Іван", price: "400" } }, tok)).client;
assert.equal(typeof ira.id, "number");
const day = core.local().day;
const s1 = await ok("session_save", { session: { day, start_time: "10:00", kind: "personal" }, participants: [{ client_id: ira.id, price: 350, pay: "paid" }] }, tok);
await bad("session_save", { session: { day, start_time: "11:00" }, participants: [] }, tok, /Додайте клієнта/);
await bad("session_save", { session: { day, start_time: "11:00" }, participants: [{ client_id: ivan.id, pay: "package" }] }, tok, /немає активного абонемента/);
// абонемент
const pk = (await ok("package_save", { package: { client_id: ivan.id, sessions_total: 2, price: 700 } }, tok)).package;
const s2 = await ok("session_save", { session: { day, start_time: "9:30", kind: "split" }, participants: [{ client_id: ivan.id, pay: "package" }, { client_id: ira.id, price: 300, pay: "debt" }] }, tok);
let r = await ok("range", { from: day, to: day }, tok);
assert.equal(r.sessions.length, 2);
assert.equal(r.sessions[0].start_time, "09:30");
const p2 = r.sessions[0].participants;
assert.deepEqual(p2.map((p) => [p.name, p.price, p.pay]), [["Іван", 350, "package"], ["Іра", 300, "debt"]]);
let b = await ok("bootstrap", {}, tok);
assert.equal(b.clients.find((c) => c.id === ira.id).debt, 300);
assert.equal(b.packages[0].used, 1);
// оплата боргу
await ok("participant_pay", { id: p2[1].id, pay: "paid" }, tok);
b = await ok("bootstrap", {}, tok);
assert.equal(b.clients.find((c) => c.id === ira.id).debt, 0);
// друге й третє тренування з абонемента
await ok("session_save", { session: { day: addD(day, 1), start_time: "10:00" }, participants: [{ client_id: ivan.id, pay: "package" }] }, tok);
await bad("session_save", { session: { day: addD(day, 2), start_time: "10:00" }, participants: [{ client_id: ivan.id, pay: "package" }] }, tok, /абонемента/);
// зміна ціни абонемента перераховує
await ok("package_save", { package: { id: pk.id, client_id: ivan.id, sessions_total: 2, price: 800 } }, tok);
r = await ok("range", { from: day, to: addD(day, 1) }, tok);
assert.ok(r.sessions.flatMap((s) => s.participants).filter((p) => p.pay === "package").every((p) => p.price === 400));
// скасування повертає тренування в абонемент
await ok("session_status", { id: s2.id, status: "cancelled" }, tok);
b = await ok("bootstrap", {}, tok);
assert.equal(b.packages[0].used, 1);
assert.equal(b.clients.find((c) => c.id === ira.id).visits, 1);
await ok("session_status", { id: s2.id, status: "planned" }, tok);
// редагування: прибрати Іру з тренування
await ok("session_save", { session: { id: s2.id, day, start_time: "09:30", kind: "personal" }, participants: [{ client_id: ivan.id, pay: "package" }] }, tok);
r = await ok("range", { from: day, to: day }, tok);
assert.equal(r.sessions[0].participants.length, 1);
// історія клієнта
const h = await ok("client_history", { id: ivan.id }, tok);
assert.equal(h.history.length, 2);
assert.equal(h.packages[0].used, 2);
// перенесення
await ok("session_move", { id: s1.id, day: addD(day, 3), start_time: "12:00", reason: "хворіє", notify: false }, tok);
r = await ok("range", { from: addD(day, 3), to: addD(day, 3) }, tok);
assert.equal(r.sessions[0].moves.length, 1);
assert.equal(r.sessions[0].participants[0].day, addD(day, 3));
assert.equal((await ok("client_history", { id: ira.id }, tok)).moves, 1);
// видалення абонемента → борг
await ok("package_delete", { id: pk.id }, tok);
b = await ok("bootstrap", {}, tok);
assert.equal(b.clients.find((c) => c.id === ivan.id).debt, 800);
// видалення тренування
await ok("session_delete", { id: s1.id }, tok);
assert.equal((await ok("range", { from: addD(day, 3), to: addD(day, 3) }, tok)).sessions.length, 0);
assert.equal([...st.db.moves.values()].length, 0);
// експорт
const ex = await ok("export", {}, tok);
assert.equal(ex.sessions.length, 2);
assert.ok(!("tg_code" in ex.clients[0]));

// ── Бот ──
await bad("tg_link_trainer", {}, tok, /підключіть бота/);
await bad("bot_connect", { token: "abc" }, tok, /токен/);
assert.equal((await ok("bot_connect", { token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh" }, tok)).bot_username, "trener_test_bot");
const link = (await ok("tg_link_trainer", {}, tok)).url;
const code = link.split("start=")[1];
const msg = (chat, extra) => core.onUpdate({ message: { chat: { id: chat, type: "private" }, from: { id: chat }, ...extra } });
// чужий номер
await msg(777, { text: "/start " + code });
assert.ok(sent.at(-1).reply_markup.keyboard);
await msg(777, { contact: { phone_number: "+380991112233", user_id: 777 } });
assert.match(sent.at(-1).text, /не збігається/);
assert.equal((await ok("bootstrap", {}, tok)).settings.tg_linked, false);
// чужий контакт (не свій user_id)
await msg(555, { text: "/start " + code });
await msg(555, { contact: { phone_number: "+380501234567", user_id: 1 } });
assert.match(sent.at(-1).text, /саме свій номер/);
// зміна лише номера Telegram не виводить інші пристрої
{ const before = tok; const j = await ok("credentials_save", { old: "Trener2026", tg_phone: "0991112233" }, tok); await ok("bootstrap", {}, before); tok = j.token;
  await ok("credentials_save", { old: "Trener2026", tg_phone: "-" }, tok);
  await bad("credentials_save", { old: "Trener2026", phone: "0631111111", new: "short" }, tok, /8 символів/);
  assert.match((await ok("bootstrap", {}, tok)).settings.phone_hint, /45 67/, "phone not changed on failed save"); }
// повідомлення показує обидва номери (замасковані)
await msg(777, { text: "/start " + code });
await msg(777, { contact: { phone_number: "+380991112233", user_id: 777 } });
assert.match(sent.at(-1).text, /22 33[\s\S]*45 67/);
// окремий номер Telegram
await ok("credentials_save", { old: "Trener2026", tg_phone: "099 111 22 33" }, tok).then((j) => { tok = j.token; });
await bad("credentials_save", { old: "Trener2026", tg_phone: "12" }, tok, /Telegram/);
const code2 = (await ok("tg_link_trainer", {}, tok)).url.split("start=")[1];
await msg(777, { text: "/start " + code2 });
await msg(777, { contact: { phone_number: "+380991112233", user_id: 777 } });
assert.match(sent.at(-1).text, /Бот підключено/);
assert.match((await ok("bootstrap", {}, tok)).settings.tg_phone_hint, /22 33/);
await ok("credentials_save", { old: "Trener2026", tg_phone: "-" }, tok).then((j) => { tok = j.token; });
assert.equal((await ok("bootstrap", {}, tok)).settings.tg_phone_hint, "");
const code3 = (await ok("tg_link_trainer", {}, tok)).url.split("start=")[1];
await msg(555, { text: "/start " + code3 });
// правильний
await msg(555, { contact: { phone_number: "+380501234567", user_id: 555 } });
assert.match(sent.at(-1).text, /Бот підключено/);
assert.equal((await ok("bootstrap", {}, tok)).settings.tg_linked, true);
// команди лише для тренера
sent.length = 0;
await msg(777, { text: "/today" });
assert.equal(sent.length, 0);
await msg(555, { text: "/today@trener_test_bot" });
assert.match(sent.at(-1).text, /Сьогодні/);
await msg(555, { text: "/debts" });
assert.match(sent.at(-1).text, /Іван — 800/);
await msg(555, { text: "/week" });
assert.match(sent.at(-1).text, /Тиждень/);
// групові чати ігноруються
sent.length = 0;
await core.onUpdate({ message: { chat: { id: -100, type: "group" }, from: { id: 555 }, text: "/today" } });
assert.equal(sent.length, 0);
// клієнт: без телефону не можна
await bad("tg_link_client", { id: ivan.id }, tok, /номер телефону клієнта/);
const cl = (await ok("tg_link_client", { id: ira.id }, tok)).url.split("start=")[1];
await msg(900, { text: "/start " + cl });
await msg(900, { contact: { phone_number: "380671112233", user_id: 900 } });
assert.match(sent.find((x) => x.chat_id === 900 && /Вітаю/.test(x.text)).text, /Олег/);
assert.ok(sent.some((x) => x.chat_id === 555 && /підключив/.test(x.text)));
assert.equal((await ok("bootstrap", {}, tok)).clients.find((c) => c.id === ira.id).tg_linked, true);
// зміна номера клієнта відʼєднує Telegram
await ok("client_save", { client: { id: ira.id, name: "Іра", phone: "0670000000" } }, tok);
assert.equal((await ok("bootstrap", {}, tok)).clients.find((c) => c.id === ira.id).tg_linked, false);
await ok("client_save", { client: { id: ira.id, name: "Іра", phone: "0671112233" } }, tok);
await msg(900, { text: "/start " + cl });
await msg(900, { contact: { phone_number: "380671112233", user_id: 900 } });

// ── Нагадування й дайджести ──
sent.length = 0;
const L0 = core.local();
await ok("session_save", { session: { day: L0.day, start_time: "09:30" }, participants: [{ client_id: ira.id, price: 350, pay: "paid" }] }, tok);
// ── Особисті плани ──
await bad("plan_save", { plan: { day: L0.day, title: "" } }, tok, /Напишіть/);
await bad("plan_save", { plan: { day: "x", title: "Перукар" } }, tok, /дату/);
const pl = (await ok("plan_save", { plan: { day: L0.day, time: "9:45", title: "Перукар", place: "вул. Хрещатик 1", cat: "beauty", remind_min: 120 } }, tok)).plan;
assert.equal(pl.time, "09:45");
await ok("plan_save", { plan: { day: L0.day, title: "Купити протеїн", cat: "errand" } }, tok);
let pr = await ok("plans_range", { from: L0.day, to: L0.day }, tok);
assert.deepEqual(pr.plans.map((x) => x.title), ["Купити протеїн", "Перукар"]);
assert.equal((await ok("range", { from: L0.day, to: L0.day }, tok)).plans.length, 2);
await ok("plan_done", { id: pr.plans[0].id, done: true }, tok);
let t = await core.tick();
assert.ok(t.includes(`plan ${pl.id}`), "plan remind " + t);
assert.ok(t.some((x) => x.startsWith("remind")), "remind " + t);
assert.ok(t.includes("morning") || L0.hm < "08:00");
assert.ok(sent.some((x) => x.chat_id === 900 && /Нагадування/.test(x.text)));
assert.ok(sent.some((x) => x.chat_id === 555 && /Перукар[\s\S]*Хрещатик/.test(x.text)));
assert.ok(sent.some((x) => /Особисті плани[\s\S]*Перукар/.test(x.text) && !/протеїн/.test(x.text)), "morning digest has plans");
await ok("plan_save", { plan: { id: pl.id, day: L0.day, time: "10:15", title: "Перукар", remind_min: 120 } }, tok);
assert.equal((await ok("plans_range", { from: L0.day, to: L0.day }, tok)).plans.find((x) => x.id === pl.id).reminded, false);
await ok("plan_delete", { id: pl.id }, tok);
assert.equal((await ok("plans_range", { from: L0.day, to: L0.day }, tok)).plans.length, 1);
t = await core.tick();
assert.ok(!t.some((x) => x.startsWith("remind")), "no double remind");
clock += 14 * 3600000; // ввечері
t = await core.tick();
assert.ok(t.includes("evening"));
assert.match(sent.at(-1).text, /Підсумок дня/);

// ── Забув пароль ──
sent.length = 0;
await ok("forgot", { phone: "0501234567", _app: "https://evil.example/" }); // підміна адреси не спрацює
const rl = sent.at(-1).text.match(/#reset=([\w-]+)/);
assert.ok(rl && sent.at(-1).text.includes("https://trener.appwrite.network/#reset="));
await bad("reset", { code: "nope", password: "NewPass2026" }, null, /недійсне/);
const tok2 = (await ok("reset", { code: rl[1], password: "NewPass2026" })).token;
await bad("bootstrap", {}, tok, /auth/); // старий токен більше не діє
await ok("bootstrap", {}, tok2);
await bad("reset", { code: rl[1], password: "NewPass2027" }, null, /недійсне/); // одноразове
sent.length = 0;
await ok("forgot", { phone: "0990000000" }); // чужий номер — та ж відповідь, без повідомлення
assert.equal(sent.length, 0);
// зміна пароля
await bad("credentials_save", { old: "bad", new: "Another2026" }, tok2, /поточний пароль/);
const tok3 = (await ok("credentials_save", { old: "NewPass2026", new: "Another2026" }, tok2)).token;
await bad("bootstrap", {}, tok2, /auth/);
await ok("login", { phone: "0501234567", password: "Another2026" });
// зміна номера тренера відʼєднує Telegram
await ok("credentials_save", { old: "Another2026", phone: "0631234567" }, tok3).then(async (j) => {
  const bb = await ok("bootstrap", {}, j.token);
  assert.equal(bb.settings.tg_linked, false);
  assert.match(bb.settings.phone_hint, /45 67/);
});
await ok("settings_save", { settings: { trainer_name: "Олег К.", remind_before_min: 60, digest_morning: "07:30", digest_evening: "" } }, (await ok("login", { phone: "0631234567", password: "Another2026" })).token);

// ── Вбудований бот (токен у змінній оточення) ──
{
  const st2 = memStore(), calls = [];
  const tf = async (url, init) => { calls.push(url.split("/").pop()); return { json: async () => ({ ok: true, result: { username: "built_in_bot" } }) }; };
  const c2 = createCore(st2, { now: () => clock, tgFetch: tf, iterations: 1000, publicUrl: "https://fn.test", botToken: "999999:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh" });
  await c2.ensureBot(); await c2.ensureBot();
  assert.equal(calls.filter((x) => x === "setWebhook").length, 1, "webhook once");
  const t2 = (await c2.api({ action: "setup", phone: "0501234567", password: "Trener2026" }, {}, { ip: "2" }))[1].token;
  const bs = (await c2.api({ action: "bootstrap" }, { authorization: "Bearer " + t2 }, {}))[1].settings;
  assert.equal(bs.bot_managed, true); assert.equal(bs.bot_ready, true); assert.equal(bs.bot_username, "built_in_bot");
  const r2 = (await c2.api({ action: "bot_connect", token: "1:x" }, { authorization: "Bearer " + t2 }, {}))[1];
  assert.match(r2.error, /вбудовано/);
  assert.match((await c2.api({ action: "tg_link_trainer" }, { authorization: "Bearer " + t2 }, {}))[1].url, /built_in_bot\?start=t_/);
  n += 4;
}

function addD(d, k) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }
console.log(`OK — ${n} перевірок API + бот і нагадування`);
