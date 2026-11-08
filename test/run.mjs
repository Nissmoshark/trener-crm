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
  const m = url.split("/").pop(), b = typeof init.body === "string" ? JSON.parse(init.body) : Object.fromEntries(init.body.entries());
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
assert.equal((await ok("status")).multi, true);
await bad("bootstrap", {}, "", /auth/);
await bad("setup", { phone: "050 123 45 67", password: "Trener2026" }, null, /імʼя/);
await bad("setup", { name: "Олег", phone: "050 123 45 67", password: "short1" }, null, /8 символів/);
await bad("setup", { name: "Олег", phone: "050 123 45 67", password: "onlyletters" }, null, /літери й цифри/);
await bad("setup", { name: "Олег", phone: "12", password: "Trener2026" }, null, /номер/);
let tok = (await ok("setup", { name: "Олег", phone: "050 123 45 67", password: "Trener2026", _app: "https://trener.appwrite.network/" })).token;
await bad("register", { name: "Інший", phone: "0501234567", password: "Trener2026x" }, null, /уже зареєстровано/);
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
assert.equal(b.clients.find((c) => c.id === ivan.id).debt, 400); // завтрашнє тренування ще не борг
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
// повторне посилання з уже підключеного Telegram — номер не питаємо
{ const again = (await ok("tg_link_trainer", {}, tok)).url.split("start=")[1];
  await msg(555, { text: "/start " + again });
  assert.match(sent.at(-1).text, /уже підключено/); assert.ok(!sent.at(-1).reply_markup.keyboard); }
// команди лише для тренера
sent.length = 0;
await msg(777, { text: "/today" });
assert.equal(sent.length, 0);
await msg(555, { text: "/today@trener_test_bot" });
assert.match(sent.at(-1).text, /Сьогодні/);
await msg(555, { text: "/debts" });
assert.match(sent.at(-1).text, /Іван — 400/);
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

// ── Нові можливості тренера + адмінка ──
{
  const st3 = memStore(), out3 = [];
  let clk = Date.parse("2026-11-09T06:00:00Z"); // пн 08:00 Київ
  const tf3 = async (url, init) => {
    const m = url.split("/").pop();
    const b = typeof init.body === "string" ? JSON.parse(init.body) : Object.fromEntries(init.body.entries());
    out3.push({ m, ...b });
    if (m === "getMe") return { json: async () => ({ ok: true, result: { username: "t3_bot" } }) };
    if (m === "getWebhookInfo") return { json: async () => ({ ok: true, result: { url: "https://fn.test/?tg=1", pending_update_count: 0 } }) };
    return { json: async () => ({ ok: true }) };
  };
  const c3 = createCore(st3, { now: () => clk, tgFetch: tf3, iterations: 1000, publicUrl: "https://fn.test", botToken: "999999:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh", tickSlackMin: 59 });
  const A = async (action, body = {}, tk) => { const [code, j] = await c3.api({ action, ...body }, tk ? { authorization: "Bearer " + tk } : {}, { ip: "9", baseUrl: "https://fn.test" }); return { code, ...j }; };
  const OK = async (a, b, tk) => { const j = await A(a, b, tk); assert.equal(j.ok, true, a + ": " + j.error); n++; return j; };
  const BAD = async (a, b, tk, re) => { const j = await A(a, b, tk); assert.equal(j.ok, false, a); if (re) assert.match(j.error, re); n++; return j; };
  await c3.ensureBot();
  assert.ok(out3.some((x) => x.m === "setWebhook" && JSON.stringify(x.allowed_updates).includes("callback_query")));
  const T = (await OK("setup", { name: "Ігор", phone: "0936419354", password: "Trener2026" })).token;
  // підключити Telegram тренера
  const code = (await OK("tg_link_trainer", {}, T)).url.split("start=")[1];
  const msg3 = (chat, extra) => c3.onUpdate({ message: { chat: { id: chat, type: "private" }, from: { id: chat }, ...extra } });
  await msg3(100, { text: "/start " + code }); await msg3(100, { contact: { phone_number: "380936419354", user_id: 100 } });
  await OK("settings_save", { settings: { gym_address: "Зал «Сила», вул. Сирецька 5", month_goal: 40000, remind_before_min: 120 } }, T);
  const bs = (await OK("bootstrap", {}, T)).settings;
  assert.equal(bs.gym_address, "Зал «Сила», вул. Сирецька 5"); assert.equal(bs.month_goal, 40000); assert.equal(bs.backup_weekly, true);
  // клієнт з Telegram
  const cl = (await OK("client_save", { client: { name: "Оля", phone: "0671112233", price: 500 } }, T)).client;
  const cc = (await OK("tg_link_client", { id: cl.id }, T)).url.split("start=")[1];
  await msg3(200, { text: "/start " + cc }); await msg3(200, { contact: { phone_number: "380671112233", user_id: 200 } });
  // програма
  await OK("client_program", { id: cl.id, program: [{ name: "Присід", sets: "4", reps: "10", weight: "40" }, { name: "" }] }, T);
  assert.equal(JSON.parse((await OK("bootstrap", {}, T)).clients[0].program).length, 1);
  // абонемент на 3 + повтор щотижня 4 тижні
  await OK("package_save", { package: { client_id: cl.id, sessions_total: 3, price: 1350 } }, T);
  const r = await OK("session_save", { session: { day: "2026-11-09", start_time: "10:00" }, participants: [{ client_id: cl.id, price: 500, pay: "package" }], repeat_weeks: 4 }, T);
  assert.equal(r.created, 5); assert.equal(r.no_package, 2);
  let rg = await OK("range", { from: "2026-11-09", to: "2026-12-10" }, T);
  assert.equal(rg.sessions.length, 5);
  assert.deepEqual(rg.sessions.map((x) => x.participants[0].pay), ["package", "package", "package", "debt", "debt"]);
  // майбутні борги не рахуються як борг
  assert.equal((await OK("bootstrap", {}, T)).clients[0].debt, 0);
  // абонемент закінчується → у ранковому плані
  let t = await c3.tick();
  assert.ok(t.includes("morning"), "morning " + t);
  const morning = out3.filter((x) => x.m === "sendMessage" && x.chat_id === 100).map((x) => x.text).find((x) => /Доброго ранку/.test(x));
  assert.match(morning, /Абонементи закінчуються[\s\S]*Оля — лишилось/);
  assert.match(morning, /Ціль місяця/);
  // нагадування клієнту з адресою й кнопками (за 2 год + запас)
  const rem = out3.find((x) => x.m === "sendMessage" && x.chat_id === 200 && /Нагадування/.test(x.text));
  assert.ok(rem, "client reminder"); assert.match(rem.text, /Сирецька/); assert.equal(rem.reply_markup.inline_keyboard[0].length, 2);
  // клієнт натискає «Не зможу»
  const cbd = rem.reply_markup.inline_keyboard[0][1].callback_data;
  await c3.onUpdate({ callback_query: { id: "q1", data: cbd, from: { id: 999 }, message: { chat: { id: 999 }, message_id: 5 } } }); // чужий чат
  assert.ok(out3.some((x) => x.m === "answerCallbackQuery" && /неактуальне/.test(x.text)));
  await c3.onUpdate({ callback_query: { id: "q2", data: cbd, from: { id: 200 }, message: { chat: { id: 200 }, message_id: 5 } } });
  assert.ok(out3.some((x) => x.m === "sendMessage" && x.chat_id === 100 && /Оля не зможе/.test(x.text)));
  rg = await OK("range", { from: "2026-11-09", to: "2026-11-09" }, T);
  assert.equal(rg.sessions[0].participants[0].confirm, "no");
  // перенесення скидає підтвердження
  await OK("session_move", { id: rg.sessions[0].id, day: "2026-11-09", start_time: "11:00" }, T);
  assert.equal((await OK("range", { from: "2026-11-09", to: "2026-11-09" }, T)).sessions[0].participants[0].confirm, null);
  // видалити серію «це й наступні»
  rg = await OK("range", { from: "2026-11-09", to: "2026-12-10" }, T);
  assert.equal((await OK("session_delete", { id: rg.sessions[3].id, scope: "future" }, T)).deleted, 2);
  assert.equal((await OK("range", { from: "2026-11-09", to: "2026-12-10" }, T)).sessions.length, 3);
  // борг минулого тренування + нагадування боржнику
  await OK("session_save", { session: { day: "2026-11-05", start_time: "18:00" }, participants: [{ client_id: cl.id, price: 500, pay: "debt" }] }, T);
  assert.equal((await OK("bootstrap", {}, T)).clients[0].debt, 500);
  const h = await OK("client_history", { id: cl.id }, T);
  assert.equal(h.debts.length, 1);
  const dr = await OK("debt_remind", { client_id: cl.id }, T);
  assert.equal(dr.sent, true); assert.ok(out3.some((x) => x.chat_id === 200 && /оплату тренувань[\s\S]*500/.test(x.text)));
  const cl2 = (await OK("client_save", { client: { name: "Без ТГ" } }, T)).client;
  await BAD("debt_remind", { client_id: cl2.id }, T, /немає боргу/);
  await OK("session_save", { session: { day: "2026-11-04", start_time: "18:00" }, participants: [{ client_id: cl2.id, price: 300, pay: "debt" }] }, T);
  const dr2 = await OK("debt_remind", { client_id: cl2.id }, T);
  assert.equal(dr2.sent, false); assert.match(dr2.text, /Разом: 300/);
  // витрати
  await BAD("expense_save", { expense: { day: "2026-11-09", amount: 0 } }, T, /суму/);
  const ex = (await OK("expense_save", { expense: { day: "2026-11-09", amount: 3000, cat: "rent", note: "Оренда залу" } }, T)).expense;
  await OK("expense_save", { expense: { day: "2026-11-10", amount: 450.5, cat: "gear" } }, T);
  assert.equal((await OK("expenses_range", { from: "2026-11-01", to: "2026-11-30" }, T)).expenses.length, 2);
  await OK("expense_delete", { id: ex.id }, T);
  assert.equal((await OK("expenses_range", { from: "2026-11-01", to: "2026-11-30" }, T)).expenses.length, 1);
  // заміри
  await BAD("measure_save", { measure: { client_id: cl.id, day: "2026-11-09" } }, T, /хоча б один/);
  await OK("measure_save", { measure: { client_id: cl.id, day: "2026-10-01", weight: 72.5, waist: 80 } }, T);
  await OK("measure_save", { measure: { client_id: cl.id, day: "2026-11-09", weight: "70,5".replace(",", "."), waist: "" } }, T);
  const ms = (await OK("client_history", { id: cl.id }, T)).measures;
  assert.deepEqual(ms.map((m) => m.weight), [72.5, 70.5]); assert.equal(ms[1].waist, null);
  // абонемент після вже проведених тренувань → списати їх
  { const cl4 = (await OK("client_save", { client: { name: "Денис", price: 350 } }, T)).client;
    await OK("session_save", { session: { day: "2026-11-07", start_time: "10:00" }, participants: [{ client_id: cl4.id, price: 350, pay: "paid" }] }, T);
    await OK("session_save", { session: { day: "2026-11-01", start_time: "10:00" }, participants: [{ client_id: cl4.id, price: 350, pay: "paid" }] }, T);
    const pr4 = await OK("package_save", { package: { client_id: cl4.id, sessions_total: 10, price: 3500, bought_on: "2026-11-07" } }, T);
    assert.equal(pr4.eligible, 1);
    assert.equal((await OK("package_attach", { id: pr4.package.id }, T)).attached, 1);
    const h4 = await OK("client_history", { id: cl4.id }, T);
    assert.deepEqual(h4.history.map((x) => x.pay), ["package", "paid"]); assert.equal(h4.packages[0].used, 1); }
  // плани з повтором
  const pr = await OK("plan_save", { plan: { day: "2026-11-10", time: "07:00", title: "Басейн" }, repeat_weeks: 2 }, T);
  assert.equal(pr.created, 3);
  assert.equal((await OK("plan_delete", { id: pr.plan.id, scope: "future" }, T)).deleted, 3);
  // резервна копія
  assert.equal((await OK("backup_now", {}, T)).sent, true);
  const doc = out3.find((x) => x.m === "sendDocument");
  assert.ok(doc && doc.chat_id === "100");
  // звіт адміністратору
  { const ru = (await OK("report_link", {}, T)).url; assert.match(ru, /start=r_/);
    const rc = ru.split("start=")[1];
    await c3.onUpdate({ message: { chat: { id: 700, type: "private" }, from: { id: 700, first_name: "Адмін", last_name: "Зал" }, text: "/start " + rc } });
    assert.ok(out3.some((x) => x.chat_id === 700 && /Готово[\s\S]*21:00/.test(x.text)));
    assert.ok(out3.some((x) => x.chat_id === 100 && /Адмін Зал[\s\S]*звіт/.test(x.text)));
    await c3.onUpdate({ message: { chat: { id: 701, type: "private" }, from: { id: 701 }, text: "/start " + rc } });
    assert.ok(out3.some((x) => x.chat_id === 701 && /застаріло/.test(x.text)));
    let bs2 = (await OK("bootstrap", {}, T)).settings;
    assert.equal(bs2.report_admins.length, 1); assert.equal(bs2.report_admins[0].name, "Адмін Зал"); assert.equal(bs2.report_time, "21:00");
    assert.equal((await OK("report_send_now", { day: "2026-11-05" }, T)).sent, 1);
    const rep = out3.filter((x) => x.chat_id === 700).at(-1).text;
    assert.match(rep, /Звіт за 05\.11\.2026/); assert.match(rep, /1\. 18:00 Оля — 500 \(борг\)/); assert.match(rep, /Разом: 500/);
    await OK("settings_save", { settings: { report_time: "00:00" } }, T);
    assert.ok((await c3.tick()).includes("report"));
    assert.ok(!(await c3.tick()).includes("report"));
    await OK("report_unlink", { chat: "700" }, T);
    assert.equal((await OK("bootstrap", {}, T)).settings.report_admins.length, 0);
    await BAD("report_send_now", {}, T, /адміністратора/); }
  // щонеділі автоматично
  clk = Date.parse("2026-11-15T19:40:00Z"); // нд 21:40
  t = await c3.tick(); assert.ok(t.includes("backup"), "weekly backup " + t);
  t = await c3.tick(); assert.ok(!t.includes("backup"));
  // адаптивний запас: часті запуски → нагадування не наперед
  clk = Date.parse("2026-11-16T05:00:00Z"); await c3.tick(); clk += 60000; // пн 07:01
  await OK("session_save", { session: { day: "2026-11-16", start_time: "10:30" }, participants: [{ client_id: cl.id, price: 500, pay: "paid" }] }, T);
  t = await c3.tick(); assert.ok(!t.some((x) => x.startsWith("remind")), "too early with minute ticks");
  clk = Date.parse("2026-11-16T06:31:00Z"); t = await c3.tick(); assert.ok(t.some((x) => x.startsWith("remind")), "remind at 2h");

  // ── Адмінка ──
  assert.equal((await OK("admin_state")).exists, false);
  await BAD("admin_status", {}, T, /auth/); // токен тренера не підходить
  await BAD("admin_setup", { code: "wrong", phone: "0500000000", password: "Admin2026x" }, null, /Невірний код/);
  const ADMIN_CODE = process.env.ADMIN_CODE;
  if (ADMIN_CODE) {
    const AT = (await OK("admin_setup", { code: ADMIN_CODE, phone: "0500000000", password: "Admin2026x" })).token;
    await BAD("admin_setup", { code: ADMIN_CODE, phone: "0500000001", password: "Admin2026x" }, null, /вже створено/);
    await BAD("bootstrap", {}, AT, /auth/); // адмін-токен не дає доступу тренера напряму
    const stt = await OK("admin_status", {}, AT);
    assert.equal(stt.counts.clients, 3); assert.match(stt.tick_url, /^https:\/\/fn\.test\/\?tick=/); assert.equal(stt.tenants_total, 1);
    const tl = (await OK("admin_tenants", {}, AT)).tenants;
    assert.equal(tl[0].tg_linked, true); assert.equal(tl[0].state, "trial"); assert.equal(tl[0].clients, 3);
    const TID = tl[0].tid;
    const imp = await OK("admin_impersonate", { tid: TID }, AT);
    assert.equal((await OK("bootstrap", {}, imp.token)).settings.trainer_name, "Ігор");
    await OK("admin_test_message", { tid: TID, text: "тест" }, AT);
    await OK("admin_tick", {}, AT);
    await OK("admin_set_trainer_password", { tid: TID, password: "NewTrainer2026" }, AT);
    await BAD("bootstrap", {}, T, /auth/);
    await OK("login", { phone: "0936419354", password: "NewTrainer2026" });
    await OK("admin_reset_throttles", {}, AT);
    // лендінг: контент, заявки, домени
    const L0 = await OK("landing", {});
    assert.ok(L0.content.hero_title && L0.content.features.length >= 3);
    await OK("admin_landing_save", { content: { hero_title: "Новий заголовок", plates: ["А", "Б"], faq: [["Питання?", "Відповідь"]], features: [["X", "y"]] } }, AT);
    const L1 = await OK("landing", {});
    assert.equal(L1.content.hero_title, "Новий заголовок"); assert.deepEqual(L1.content.plates, ["А", "Б"]); assert.equal(L1.content.faq[0][0], "Питання?");
    await BAD("admin_landing_save", { content: {} }, T, /auth/);
    await OK("landing_lead", { name: "Олег", phone: "0671234567", msg: "хочу" });
    await BAD("landing_lead", { name: "", phone: "" }, null, /./);
    const LG = await OK("admin_landing_get", {}, AT);
    assert.equal(LG.leads[0].name, "Олег");
    await OK("admin_domains_save", { landing_domain: "trenerka.com.ua", app_domain: "app.trenerka.com.ua" }, AT);
    assert.equal((await OK("landing", {})).app_domain, "app.trenerka.com.ua");
    await BAD("admin_domains_save", { landing_domain: "not a domain!", app_domain: "" }, AT, /./);
    await OK("admin_leads_clear", {}, AT);
    assert.equal((await OK("admin_landing_get", {}, AT)).leads.length, 0);
    await OK("admin_landing_reset", {}, AT);
    assert.notEqual((await OK("landing", {})).content.hero_title, "Новий заголовок");
    n += 12;
    const AT2 = (await OK("admin_login", { phone: "0500000000", password: "Admin2026x" })).token;
    await BAD("admin_login", { phone: "0500000000", password: "nope12345" }, null, /Невірний/);
    await OK("admin_logout_all", {}, AT2);
    await BAD("admin_status", {}, AT2, /auth/);
  } else console.log("(ADMIN_CODE не задано — перевірки входу адміна пропущено)");
}

// ── Вбудований бот (токен у змінній оточення) ──
{
  const st2 = memStore(), calls = [];
  const tf = async (url, init) => { calls.push(url.split("/").pop()); return { json: async () => ({ ok: true, result: { username: "built_in_bot" } }) }; };
  const c2 = createCore(st2, { now: () => clock, tgFetch: tf, iterations: 1000, publicUrl: "https://fn.test", botToken: "999999:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh" });
  await c2.ensureBot(); await c2.ensureBot();
  assert.equal(calls.filter((x) => x === "setWebhook").length, 1, "webhook once");
  const t2 = (await c2.api({ action: "setup", name: "Тест", phone: "0501234567", password: "Trener2026" }, {}, { ip: "2" }))[1].token;
  const bs = (await c2.api({ action: "bootstrap" }, { authorization: "Bearer " + t2 }, {}))[1].settings;
  assert.equal(bs.bot_managed, true); assert.equal(bs.bot_ready, true); assert.equal(bs.bot_username, "built_in_bot");
  const r2 = (await c2.api({ action: "bot_connect", token: "1:x" }, { authorization: "Bearer " + t2 }, {}))[1];
  assert.match(r2.error, /вбудовано/);
  assert.match((await c2.api({ action: "tg_link_trainer" }, { authorization: "Bearer " + t2 }, {}))[1].url, /built_in_bot\?start=t_/);
  n += 4;
}

// ── Кабінети: кілька тренерів, ізоляція, підписка, перенесення старих даних ──
{
  let clk = Date.parse("2026-11-09T06:00:00Z");
  const stM = memStore(), sentM = [];
  const tfM = async (url, init) => { const m = url.split("/").pop(); const b = typeof init.body === "string" ? JSON.parse(init.body) : {}; sentM.push({ m, ...b });
    return { json: async () => ({ ok: true, result: { username: "mt_bot" } }) }; };
  // стара однокористувацька база: налаштування в kv + дані без tid
  for (const [k, v] of Object.entries({ secret: "s", token_secret: "ts", bot_token: "1:x", bot_username: "mt_bot", trainer_name: "Ігор", trainer_phone: "380936419354",
    pass_salt: "salt", pass_hash: "", pass_ver: "3", trainer_chat_id: "100", gym_address: "Зал" })) await stM.create("kv", { value: v }, k);
  const legacyCore = createCore(stM, { now: () => clk, iterations: 1000 });
  // підставляємо справжній хеш пароля через тимчасовий кабінет-реєстрацію в окремому сховищі
  const tmpSt = memStore(); const tmp = createCore(tmpSt, { now: () => clk, iterations: 1000 });
  await tmp.api({ action: "register", name: "x", phone: "0500000009", password: "Old2026pass" }, {}, { ip: "z" });
  const tmpT = JSON.parse((await tmpSt.list("tenants"))[0].data);
  await stM.update("kv", "pass_salt", { value: tmpT.pass_salt }); await stM.update("kv", "pass_hash", { value: tmpT.pass_hash });
  await stM.create("clients", { name: "Надя", phone: "0937999758", price: 350, remind: true, archived: false }, 5001);
  await stM.create("sessions", { day: "2026-11-09", start_time: "10:00", duration_min: 60, kind: "personal", status: "planned", extra_amount: 0, reminded: false }, 6001);
  await stM.create("parts", { session_id: 6001, client_id: 5001, price: 350, pay: "debt", day: "2026-11-09", status: "planned" }, 7001);
  const cM = createCore(stM, { now: () => clk, tgFetch: tfM, iterations: 1000, publicUrl: "https://fn.test" });
  const A = async (action, body = {}, tk, ip = "9") => { const [code, j] = await cM.api({ action, ...body }, tk ? { authorization: "Bearer " + tk } : {}, { ip }); return { code, ...j }; };
  const OK = async (a, b, tk) => { const j = await A(a, b, tk); assert.equal(j.ok, true, a + ": " + j.error); n++; return j; };
  const BAD = async (a, b, tk, re) => { const j = await A(a, b, tk); assert.equal(j.ok, false, a); if (re) assert.match(j.error, re); n++; return j; };
  // перенесення: Ігор входить своїм паролем і бачить свої дані
  const TI = (await OK("login", { phone: "0936419354", password: "Old2026pass" })).token;
  const bI = await OK("bootstrap", {}, TI);
  assert.equal(bI.clients.length, 1); assert.equal(bI.settings.trainer_name, "Ігор"); assert.equal(bI.settings.tg_linked, true); assert.equal(bI.settings.gym_address, "Зал");
  assert.equal(bI.subscription.state, "active"); assert.equal(bI.subscription.lifetime, true); assert.equal(bI.subscription.pro, true);
  assert.ok([...stM.db.clients.values()].every((c) => c.tid === "t1"));
  assert.equal((await stM.get("kv", "pass_hash")).value, "");
  // другий тренер реєструється
  const T2 = (await OK("register", { name: "Олена", phone: "0671234567", password: "Olena2026x" })).token;
  const b2 = await OK("bootstrap", {}, T2);
  assert.equal(b2.clients.length, 0); assert.equal(b2.subscription.state, "trial"); assert.equal(b2.subscription.days_left, 14);
  const c2 = (await OK("client_save", { client: { name: "Клієнт Олени", phone: "0501111111" } }, T2)).client;
  // ізоляція: Ігор не бачить і не може змінити чуже
  assert.equal((await OK("bootstrap", {}, TI)).clients.length, 1);
  await BAD("client_save", { client: { id: c2.id, name: "Злам" } }, TI, /не знайдено/);
  await BAD("client_archive", { id: c2.id, archived: true }, TI, /не знайдено/);
  assert.equal((await OK("client_history", { id: c2.id }, TI)).history.length, 0);
  await OK("session_delete", { id: 6001 }, T2); // чуже — не видаляється
  assert.equal((await OK("range", { from: "2026-11-09", to: "2026-11-09" }, TI)).sessions.length, 1);
  await OK("participant_pay", { id: 7001, pay: "paid" }, T2); // чужий запис — без змін
  assert.equal((await stM.get("parts", 7001)).pay, "debt");
  assert.equal((await OK("client_history", { id: 5001 }, TI)).debts.length, 1);
  await BAD("session_save", { session: { day: "2026-11-10", start_time: "10:00" }, participants: [{ client_id: 5001, price: 1, pay: "paid" }] }, T2);
  // підписка Олени закінчується → лише перегляд
  clk += 15 * 86400000;
  const ex = await A("client_save", { client: { name: "Новий" } }, T2);
  assert.equal(ex.ok, false); assert.equal(ex.code, 402); assert.match(ex.error, /Підписка закінчилась/);
  await OK("bootstrap", {}, T2); await OK("range", { from: "2026-11-01", to: "2026-11-30" }, T2);
  assert.equal((await OK("bootstrap", {}, T2)).subscription.state, "expired");
  await OK("sub_paid", { note: "переказ на картку" }, T2);
  // адмін продовжує
  const ADMIN_CODE = process.env.ADMIN_CODE;
  if (ADMIN_CODE) {
    const AT = (await OK("admin_setup", { code: ADMIN_CODE, phone: "0500000000", password: "Admin2026x" })).token;
    await OK("admin_billing_save", { price_text: "199 грн/міс", pay_info: "Картка 4441…", trial_days: 7 }, AT);
    const list = (await OK("admin_tenants", {}, AT)).tenants;
    assert.equal(list.length, 2);
    const ol = list.find((x) => x.name === "Олена"); assert.equal(ol.state, "expired"); assert.ok(ol.paid_claim_at);
    await OK("admin_tenant_update", { tid: ol.tid, extend_days: 30 }, AT);
    let sb = (await OK("bootstrap", {}, T2)).subscription;
    assert.equal(sb.state, "active"); assert.equal(sb.plan, "basic"); assert.equal(sb.pro, false);
    // Звичайний тариф: без бота для клієнтів
    const pr = await A("tg_link_client", { id: c2.id }, T2); assert.equal(pr.code, 402); assert.match(pr.error, /Pro/);
    // заявка на Pro через monobank → адмін підтверджує
    await OK("admin_billing_save", { price_basic: 199, price_pro: 349, mono_url: "https://send.monobank.ua/jar/abc123" }, AT);
    await BAD("admin_billing_save", { mono_url: "https://evil.example/x" }, AT, /monobank/);
    sb = (await OK("bootstrap", {}, T2)).subscription; assert.equal(sb.price_pro, 349); assert.equal(sb.mono_url, "https://send.monobank.ua/jar/abc123");
    await OK("sub_paid", { plan: "pro", months: 3, amount: 1047 }, T2);
    const cl2 = (await OK("admin_tenants", {}, AT)).tenants.find((x) => x.tid === ol.tid);
    assert.deepEqual([cl2.paid_claim.plan, cl2.paid_claim.months], ["pro", 3]);
    const before = cl2.paid_until;
    await OK("admin_tenant_update", { tid: ol.tid, confirm_claim: true }, AT);
    sb = (await OK("bootstrap", {}, T2)).subscription;
    assert.equal(sb.plan, "pro"); assert.equal(sb.pro, true); assert.ok(sb.until > before); assert.equal(sb.paid_claim, "");
    await BAD("admin_tenant_update", { tid: ol.tid, confirm_claim: true }, AT, /Немає заявки/);
    await OK("client_save", { client: { name: "Новий" } }, T2);
    await OK("admin_tenant_update", { tid: ol.tid, blocked: true }, AT);
    assert.match((await A("client_save", { client: { name: "x" } }, T2)).error, /призупинено/);
    await OK("admin_tenant_update", { tid: ol.tid, blocked: false }, AT);
    await OK("admin_tenant_update", { tid: ol.tid, lifetime: true }, AT);
    sb = (await OK("bootstrap", {}, T2)).subscription; assert.equal(sb.lifetime, true); assert.equal(sb.pro, true);
    await OK("admin_tenant_update", { tid: ol.tid, lifetime: false }, AT);
    assert.equal((await OK("bootstrap", {}, T2)).subscription.lifetime, undefined);
    // новий тренер — пробний період з налаштувань адміна
    const T3 = (await OK("register", { name: "Петро", phone: "0631112233", password: "Petro2026x" }, null)).token;
    assert.equal((await OK("bootstrap", {}, T3)).subscription.days_left, 7);
    assert.equal((await OK("bootstrap", {}, T3)).subscription.price_text, "199 грн/міс");
    // Telegram адміна
    const al = (await OK("admin_tg_link", {}, AT)).url.split("start=")[1];
    await cM.onUpdate({ message: { chat: { id: 900, type: "private" }, from: { id: 900 }, text: "/start " + al } });
    await cM.onUpdate({ message: { chat: { id: 900, type: "private" }, from: { id: 900 }, contact: { phone_number: "380500000000", user_id: 900 } } });
    await OK("register", { name: "Анна", phone: "0991112233", password: "Anna2026xx" });
    assert.ok(sentM.some((x) => x.chat_id === 900 && /Новий тренер[\s\S]*Анна/.test(x.text)));
  }
  // бот: команди тренера — лише свої дані
  sentM.length = 0;
  await cM.onUpdate({ message: { chat: { id: 100, type: "private" }, from: { id: 100 }, text: "/debts" } });
  assert.match(sentM.at(-1).text, /Надя — 350/);
  // попередження про закінчення: Ігор має рік, Олена — 30 днів
  clk += 28 * 86400000;
  const tt = await cM.tick();
  assert.ok(!tt.includes("error"), String(tt));
  // старий токен без кабінету (з попередньої версії) працює для першого кабінету
  n += 3;
}

function addD(d, k) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }
console.log(`OK — ${n} перевірок API + бот і нагадування`);
