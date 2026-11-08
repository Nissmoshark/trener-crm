// CRM персонального тренера — логіка сервера (не залежить від сховища).
//   POST {action,...}  — API для додатку (Authorization: Bearer <token>)
//   Telegram webhook   — бот тренера й нагадування клієнтам
//   tick()             — щохвилини: нагадування, ранковий план і вечірній підсумок
import { AsyncLocalStorage } from "node:async_hooks";
const TZ = "Europe/Kyiv";
const DATA_TABLES = ["clients", "packages", "sessions", "parts", "moves", "plans", "expenses", "measures"];
// Службові ключі kv, які не є глобальними налаштуваннями
const KV_PRIVATE = ["f_", "p_", "tc_", "rs_", "ac_"];
const isPriv = (k) => KV_PRIVATE.some((x) => String(k).startsWith(x));
// Одноразовий код для створення входу розробника (у коді — лише його хеш)
const ADMIN_SETUP_HASH = "FiHtdyLO5HXp1XEg2o-wZfo4aAqOgvmOOhp0HmybZ7E";
const BOT_CFG = "2"; // версія налаштувань бота (кнопки «Буду / Не зможу»)
const EXP_CATS = ["rent", "gear", "transport", "education", "ads", "food", "other"];
export class ApiError extends Error {}
export const LANDING_DEFAULT = {
  hero_title: "Журнал персонального тренера",
  hero_sub: "Розклад, клієнти, абонементи й оплати в телефоні. Бот сам нагадує клієнтам про тренування, а вам — про борги.",
  cta: "Спробувати безкоштовно",
  plates: ["Розклад", "Абонементи", "Борги", "Нагадування"],
  features: [
    ["Розклад на день, тиждень і місяць", "Персональні, спліт і групові тренування. Повтор щотижня одним натиском, переноси з історією."],
    ["Абонементи без зошита", "Видно, скільки проведено, заплановано й лишилось. Коли лишається 1–2 тренування — нагадування продати новий."],
    ["Оплати й борги", "Хто заплатив, хто винен і скільки. Нагадування боржнику — одним натиском у Telegram або Viber."],
    ["Бот для вас і клієнтів", "Зранку план дня, ввечері підсумок. Клієнти отримують нагадування з кнопками «Буду» і «Не зможу»."],
    ["Програма й прогрес", "Вправи з підходами й вагою, заміри тіла й графік ваги в картці кожного клієнта."],
    ["Гроші під контролем", "Дохід, витрати на зал і інвентар, чистий прибуток і ціль на місяць."],
  ],
  steps: [["Зареєструйтесь", "Номер телефону й пароль — і журнал готовий."], ["Додайте клієнтів", "Імʼя, телефон, ціна тренування."], ["Записуйте тренування", "Решту бот і журнал зроблять самі."]],
  faq: [
    ["Чи бачать інші тренери моїх клієнтів?", "Ні. Кожен тренер бачить лише свої дані."],
    ["Що буде, коли закінчиться пробний період?", "Журнал залишиться доступним для перегляду. Щоб записувати далі, оберіть тариф."],
    ["Чи працює на iPhone і Android?", "Так. Відкрийте сайт у браузері й додайте іконку на головний екран."],
    ["Як оплатити?", "Карткою через monobank. Підписка продовжується після підтвердження оплати."],
  ],
  contact_telegram: "",
  contact_phone: "",
  footer: "Журнал тренувань",
};

export function createCore(st, opts = {}) {
  let nowMs = opts.now ?? (() => Date.now());
  const tgFetch = opts.tgFetch ?? ((url, init) => fetch(url, init));
  const log = opts.log ?? (() => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastId = 0;
  const newId = () => { let id = nowMs() * 100 + Math.floor(Math.random() * 100); if (id <= lastId) id = lastId + 1; lastId = id; return id; };

  // ───────── Налаштування (колекція kv) ─────────
  let S = {}, sAt = 0;
  async function settings(force = false) {
    if (force || Date.now() - sAt > 15_000) {
      const rows = await st.list("kv");
      S = Object.fromEntries(rows.filter((r) => !isPriv(r.id)).map((r) => [String(r.id), r.value ?? ""]));
      sAt = Date.now();
      for (const k of ["secret", "token_secret"]) if (!S[k]) { S[k] = randCode(24); await kvSet(k, S[k]); }
      if (S.mt_migrated !== "1") await migrateToTenants();
      // перший тренер (ініціатор) — безстроковий доступ, один раз
      if (S.t1_lifetime !== "1") { const T1 = await loadTenant("t1"); if (T1) { T1.data.lifetime = "1"; await saveTenant(T1); } await kvSet("t1_lifetime", "1"); }
    }
    return S;
  }
  async function kvGet(k) { return (await st.get("kv", k))?.value ?? null; }
  async function kvSet(k, v) {
    v = String(v ?? "");
    try { await st.update("kv", k, { value: v }); }
    catch (e) { if (e.status !== 404) throw e; try { await st.create("kv", { value: v }, k); } catch (e2) { if (e2.status === 409) await st.update("kv", k, { value: v }); else throw e2; } }
    if (!isPriv(k)) S[k] = v;
  }
  const kvDel = (k) => st.remove("kv", k);

  // ───────── Кабінети тренерів ─────────
  // Кожен запит виконується в контексті одного кабінету; всі читання/записи даних — лише в ньому.
  const als = new AsyncLocalStorage();
  const cur = () => { const c = als.getStore(); if (!c?.T) throw new Error("no tenant context"); return c; };
  const inTenant = (T, fn) => als.run({ T }, fn);
  const D = {
    list: (c, f = []) => st.list(c, [["tid", "eq", cur().T.id], ...f]),
    async get(c, id) { const r = await st.get(c, id); return r && r.tid === cur().T.id ? r : null; },
    create: (c, data, id) => st.create(c, { ...data, tid: cur().T.id }, id),
    async update(c, id, data) { if (!(await D.get(c, id))) throw new ApiError("Запис не знайдено"); return st.update(c, id, data); },
    async remove(c, id) { if (await D.get(c, id)) await st.remove(c, id); },
  };
  const TENANT_DEFAULTS = { remind_before_min: "120", digest_morning: "08:00", digest_evening: "21:00", backup_weekly: "1" };
  function parseTenant(r) {
    if (!r) return null;
    let data = {}; try { data = JSON.parse(r.data || "{}"); } catch { /* */ }
    return { id: String(r.id), data: { ...TENANT_DEFAULTS, ...data } };
  }
  async function loadTenant(id) { return parseTenant(await st.get("tenants", id)); }
  async function saveTenant(T) {
    const d = T.data;
    await st.update("tenants", T.id, { data: JSON.stringify(d), phone: d.trainer_phone || null, chat: d.trainer_chat_id || null, tg_phone: d.trainer_tg_phone || null });
  }
  // Налаштування поточного кабінету разом із глобальними (бот, секрети)
  async function TS(force = false) {
    const c = cur();
    if (force) { const fresh = await loadTenant(c.T.id); if (fresh) c.T.data = fresh.data; }
    const g = await settings(force);
    return { ...g, ...c.T.data, tid: c.T.id };
  }
  async function tSet(k, v) { const c = cur(); c.T.data[k] = v == null ? "" : String(v); await saveTenant(c.T); }
  async function tSetMany(obj) { const c = cur(); for (const [k, v] of Object.entries(obj)) c.T.data[k] = v == null ? "" : String(v); await saveTenant(c.T); }
  async function tenantByPhone(phone) { if (!phone) return null; const [r] = await st.list("tenants", [["phone", "eq", phone]]); return parseTenant(r); }
  async function tenantByChat(chat) { const [r] = await st.list("tenants", [["chat", "eq", String(chat)]]); return parseTenant(r); }
  async function newTenant({ name, phone, password }) {
    const g = await settings();
    const salt = randCode(12), id = "t" + newId();
    const trialDays = Math.max(0, Number(g.trial_days || 14));
    const data = { ...TENANT_DEFAULTS, trainer_name: name || "", trainer_phone: phone, pass_salt: salt, pass_hash: await passHash(password, salt), pass_ver: "1",
      created_at: new Date(nowMs()).toISOString(), trial_until: addDays(local().day, trialDays) };
    await st.create("tenants", { data: JSON.stringify(data), phone, chat: null, tg_phone: null }, id);
    return { id, data };
  }
  // Підписка: пробний період / оплачено / закінчилась / заблоковано
  function subInfo(d) {
    // безстроковий доступ (ініціатор проєкту): усе Pro, без дати й нагадувань про оплату
    if (d.lifetime === "1" && d.blocked !== "1") return { state: "active", until: "", days_left: 99999, writable: true, plan: "pro", pro: true, lifetime: true };
    const today = local().day;
    const until = [d.trial_until, d.paid_until].filter(Boolean).sort().pop() || "";
    const paid = !!d.paid_until && d.paid_until >= today;
    const state = d.blocked === "1" ? "blocked" : until && until >= today ? (paid ? "active" : "trial") : "expired";
    const days = until ? Math.round((Date.parse(until + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000) : -1;
    const plan = d.plan === "pro" ? "pro" : "basic";
    // Pro: пробний період або оплачений Pro
    const pro = state === "trial" || (state === "active" && plan === "pro");
    return { state, until, days_left: Math.max(0, days), writable: state === "trial" || state === "active", plan, pro };
  }
  const PRO_MSG = "Це можливість тарифу Pro: Telegram-бот, нагадування клієнтам і форма запису. Змінити тариф — «Ще» → «Підписка».";
  // Перенесення одного тренера (старої версії) у перший кабінет
  async function migrateToTenants() {
    const keys = ["remind_before_min", "digest_morning", "digest_evening", "trainer_name", "trainer_phone", "trainer_tg_phone", "pass_salt", "pass_hash", "pass_ver",
      "trainer_chat_id", "gym_address", "month_goal", "backup_weekly", "last_backup", "last_backup_day", "last_morning", "last_evening"];
    if (S.pass_hash) {
      const data = { ...TENANT_DEFAULTS };
      for (const k of keys) if (S[k] != null && S[k] !== "") data[k] = S[k];
      data.created_at = new Date(nowMs()).toISOString();
      data.paid_until = addDays(local().day, 365); // перший тренер — рік без оплати
      try { await st.create("tenants", { data: JSON.stringify(data), phone: data.trainer_phone || null, chat: data.trainer_chat_id || null, tg_phone: data.trainer_tg_phone || null }, "t1"); }
      catch (e) { if (e.status !== 409) throw e; }
      for (const c of DATA_TABLES) for (const r of await st.list(c)) if (!r.tid) await st.update(c, r.id, { tid: "t1" });
      for (const k of ["pass_hash", "pass_salt"]) await kvSet(k, "");
      log("migrated single trainer to tenant t1");
    }
    await kvSet("mt_migrated", "1");
  }

  // ───────── Час (Київ) ─────────
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  function local(ms = nowMs()) {
    const o = {};
    for (const p of dtf.formatToParts(new Date(ms))) o[p.type] = p.value;
    const h = +o.hour % 24, m = +o.minute;
    return { day: `${o.year}-${o.month}-${o.day}`, hm: `${String(h).padStart(2, "0")}:${o.minute}`, min: h * 60 + m };
  }
  const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const hhmm = (t) => { const [h, m] = String(t).split(":"); return `${String(+h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
  const WD = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const MON = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
  const fmtDay = (day) => { const d = new Date(day + "T12:00:00Z"); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const money = (x) => `${Math.round(x).toLocaleString("uk-UA").replace(/\s/g, " ")} грн`;
  const round2 = (x) => Math.round(x * 100) / 100;

  // ───────── Безпека ─────────
  const enc = new TextEncoder();
  const b64u = (b) => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString("base64url");
  function randCode(n = 9) { return b64u(crypto.getRandomValues(new Uint8Array(n))); }
  async function sha(s) { return b64u(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
  async function hmac(secret, data) {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  }
  const ITER = opts.iterations ?? 120_000;
  async function passHash(pass, salt, iter = ITER) {
    const k = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, k, 256);
    return `p2$${iter}$${b64u(bits)}`;
  }
  async function passOk(pass, salt, stored) {
    if (!stored || !salt) return false;
    const [, it] = stored.split("$");
    const h = await passHash(String(pass ?? ""), salt, Number(it) || ITER);
    if (h.length !== stored.length) return false;
    let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ stored.charCodeAt(i);
    return d === 0;
  }
  function checkPassword(p) {
    p = String(p ?? "");
    if (p.length < 8) throw new ApiError("Пароль — щонайменше 8 символів");
    if (p.length > 100) throw new ApiError("Задовгий пароль");
    if (!/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(p) || !/\d/.test(p)) throw new ApiError("Пароль має містити літери й цифри");
    return p;
  }
  function normPhone(x) {
    let d = String(x ?? "").replace(/\D/g, "");
    if (d.length === 10 && d.startsWith("0")) d = "38" + d;
    if (d.length === 9) d = "380" + d;
    if (d.length === 11 && d.startsWith("80")) d = "3" + d;
    return d.length >= 11 && d.length <= 13 ? d : "";
  }
  const maskPhone = (p) => p ? `+${p.slice(0, 3)} •• ••• ${p.slice(-4, -2)} ${p.slice(-2)}` : "";
  async function makeToken(T = cur().T) {
    const s = await settings();
    const payload = b64u(enc.encode(JSON.stringify({ exp: nowMs() + 180 * 86400_000, t: T.id, v: T.data.pass_ver || "1" })));
    return `${payload}.${await hmac(s.token_secret, payload)}`;
  }
  // Повертає кабінет або null
  async function checkToken(tok) {
    if (!tok) return null;
    const [payload, sig] = tok.split(".");
    if (!payload || !sig) return null;
    const s = await settings();
    if ((await hmac(s.token_secret, payload)) !== sig) return null;
    try {
      const p = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (!(p.exp > nowMs())) return null;
      const T = await loadTenant(p.t || "t1"); // старі токени — перший кабінет
      return T && T.data.pass_hash && String(p.v) === String(T.data.pass_ver || "1") ? T : null;
    } catch { return null; }
  }
  async function makeAdminToken() {
    const s = await settings();
    const payload = b64u(enc.encode(JSON.stringify({ exp: nowMs() + 30 * 86400_000, a: 1, v: s.admin_ver || "1" })));
    return `${payload}.${await hmac(s.token_secret + ":admin", payload)}`;
  }
  async function checkAdmin(tok) {
    if (!tok) return false;
    const [payload, sig] = tok.split(".");
    if (!payload || !sig) return false;
    const s = await settings();
    if (!s.admin_hash || (await hmac(s.token_secret + ":admin", payload)) !== sig) return false;
    try { const p = JSON.parse(Buffer.from(payload, "base64url").toString()); return p.a === 1 && p.exp > nowMs() && String(p.v) === String(s.admin_ver || "1"); }
    catch { return false; }
  }
  // Журнал помилок для адмінки (останні 30)
  async function logError(where, e) {
    log(where + ": " + (e?.stack || e));
    try {
      let a = []; try { a = JSON.parse((await kvGet("errlog")) || "[]"); } catch { /* */ }
      a.unshift({ at: new Date(nowMs()).toISOString(), where, msg: String(e?.message || e).slice(0, 400) });
      await kvSet("errlog", JSON.stringify(a.slice(0, 30)));
    } catch { /* */ }
  }
  // Обмеження спроб: ключ → {n, from}
  async function throttleCheck(kind, id, max, winMin) {
    const k = "f_" + (await sha(kind + ":" + id)).slice(0, 30);
    let v = {}; try { v = JSON.parse((await kvGet(k)) || "{}"); } catch { /* */ }
    if (v.from && nowMs() - v.from < winMin * 60000 && v.n >= max)
      throw new ApiError(`Забагато спроб. Спробуйте через ${Math.ceil((v.from + winMin * 60000 - nowMs()) / 60000)} хв`);
    return { k, v, winMin };
  }
  async function throttleFail(t) {
    const fresh = !t.v.from || nowMs() - t.v.from >= t.winMin * 60000;
    await kvSet(t.k, JSON.stringify(fresh ? { n: 1, from: nowMs() } : { n: (t.v.n || 0) + 1, from: t.v.from }));
  }
  const throttleClear = (t) => kvDel(t.k);

  // ───────── Дані ─────────
  const all = (c, f = []) => D.list(c, f);
  async function partsFor(filters) { return await all("parts", filters); }
  // used — усі списані (проведені + заплановані), used_done — уже проведені (до сьогодні включно)
  function withUse(pkgs, parts, excludeSession) {
    const today = local().day;
    return pkgs.map((p) => {
      const mine = parts.filter((x) => x.package_id === p.id && x.status !== "cancelled" && x.session_id !== excludeSession);
      return { ...p, used: mine.length, used_done: mine.filter((x) => x.day <= today).length };
    })
      .sort((a, b) => (b.bought_on || "").localeCompare(a.bought_on || "") || b.id - a.id);
  }
  async function sessionsRange(from, to) {
    const ss = (await all("sessions", [["day", "gte", from], ["day", "lte", to]]))
      .sort((a, b) => a.day.localeCompare(b.day) || a.start_time.localeCompare(b.start_time) || a.id - b.id);
    if (!ss.length) return [];
    const ids = ss.map((s) => s.id);
    const ps = await partsFor([["session_id", "in", ids]]);
    const cl = new Map((await all("clients", [["id", "in", [...new Set(ps.map((p) => p.client_id))]]])).map((c) => [c.id, c]));
    const mv = await all("moves", [["session_id", "in", ids]]);
    for (const s of ss) {
      s.participants = ps.filter((p) => p.session_id === s.id).sort((a, b) => a.id - b.id).map((p) => ({ ...p, name: cl.get(p.client_id)?.name ?? "?" }));
      s.moves = mv.filter((m) => m.session_id === s.id).sort((a, b) => a.id - b.id);
      s.extra_amount = s.extra_amount || 0;
    }
    return ss;
  }
  const PLAN_CATS = ["personal", "beauty", "health", "errand", "work"];
  async function plansRange(from, to) {
    return (await all("plans", [["day", "gte", from], ["day", "lte", to]]))
      .sort((a, b) => a.day.localeCompare(b.day) || (a.time || "").localeCompare(b.time || "") || a.id - b.id);
  }
  const sessTotal = (s) => s.status === "cancelled" ? 0 : s.participants.reduce((a, p) => a + Number(p.price), 0) + Number(s.extra_amount || 0);
  function sessLabel(s) {
    if (s.kind === "group") return `${s.title || "Група"}${s.participants.length ? ` (${s.participants.length})` : ""}`;
    return s.participants.map((p) => p.name).join(", ") || s.title || "Тренування";
  }
  async function pickPackage(clientId, excludeSession) {
    const pk = (await all("packages", [["client_id", "eq", clientId]])).filter((p) => !p.expires_on || p.expires_on >= local().day);
    if (!pk.length) return null;
    const parts = await partsFor([["package_id", "in", pk.map((p) => p.id)]]);
    return withUse(pk, parts, excludeSession).sort((a, b) => (a.bought_on || "").localeCompare(b.bought_on || "") || a.id - b.id)
      .find((p) => p.used < p.sessions_total) ?? null;
  }
  // Абонементи, що закінчуються: лишилось 1–2 або спливає термін за 3 дні
  async function pkgAlerts() {
    const today = local().day, soon = addDays(today, 3);
    const [pk, parts, cl] = await Promise.all([all("packages"), all("parts", [["pay", "eq", "package"]]), all("clients")]);
    const names = new Map(cl.filter((c) => !c.archived).map((c) => [c.id, c.name]));
    // залишок рахуємо за проведеними тренуваннями (майбутні записи — окремо)
    const past = parts.filter((x) => x.day <= today);
    return withUse(pk, past).filter((p) => names.has(p.client_id) && (!p.expires_on || p.expires_on >= today)).map((p) => {
      const left = p.sessions_total - p.used;
      const booked = parts.filter((x) => x.package_id === p.id && x.day > today && x.status !== "cancelled").length;
      const tail = booked ? (booked >= left ? " · усі вже заплановані" : ` · заплановано ${booked}`) : "";
      if (left > 0 && left <= 2) return { client_id: p.client_id, name: names.get(p.client_id), text: `лишилось ${left} з ${p.sessions_total}${tail}` };
      if (left > 0 && p.expires_on && p.expires_on <= soon) return { client_id: p.client_id, name: names.get(p.client_id), text: `діє до ${fmtDay(p.expires_on)}, лишилось ${left}` };
      return null;
    }).filter(Boolean);
  }
  async function clientDebts(clientId) {
    const today = local().day;
    const ps = (await partsFor([["client_id", "eq", clientId], ["pay", "eq", "debt"]])).filter((p) => p.status !== "cancelled" && p.day <= today);
    const ss = new Map((await all("sessions", [["id", "in", ps.map((p) => p.session_id)]])).map((x) => [x.id, x]));
    return ps.map((p) => ({ part_id: p.id, day: p.day, time: ss.get(p.session_id)?.start_time ?? "", price: Number(p.price) })).sort((a, b) => a.day.localeCompare(b.day));
  }
  async function eligibleForPkg(pk) {
    return (await partsFor([["client_id", "eq", pk.client_id]]))
      .filter((x) => x.pay !== "package" && x.status !== "cancelled" && x.day >= (pk.bought_on || "") && (!pk.expires_on || x.day <= pk.expires_on))
      .sort((a, z) => a.day.localeCompare(z.day) || a.id - z.id);
  }
  const num0 = (x) => (x === "" || x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  function cleanProgram(x) {
    if (x == null || x === "") return null;
    const arr = (Array.isArray(x) ? x : (() => { try { return JSON.parse(x); } catch { return []; } })()).slice(0, 60)
      .map((r) => ({ name: String(r?.name ?? "").trim().slice(0, 120), sets: String(r?.sets ?? "").slice(0, 12), reps: String(r?.reps ?? "").slice(0, 20), weight: String(r?.weight ?? "").slice(0, 20), note: String(r?.note ?? "").slice(0, 200), day: String(r?.day ?? "").slice(0, 40) }))
      .filter((r) => r.name);
    const j = JSON.stringify(arr);
    if (j.length > 10000) throw new ApiError("Програма задовга — скоротіть кількість вправ");
    return arr.length ? j : null;
  }
  async function backupData() {
    const names = ["clients", "packages", "sessions", "parts", "moves", "plans", "expenses", "measures"];
    const data = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await all(n)])));
    for (const c of data.clients) delete c.tg_code;
    return { app: "trener-crm", at: new Date(nowMs()).toISOString(), ...data };
  }
  async function sendBackup() {
    const s = await TS(true);
    if (!s.trainer_chat_id || !s.bot_token) throw new ApiError("Спершу підключіть свій Telegram у налаштуваннях");
    const d = await backupData();
    const ok = await tgFile(s.trainer_chat_id, `trener-backup-${local().day}.json`, JSON.stringify(d), `💾 Резервна копія журналу · ${fmtDay(local().day)}\nКлієнтів: ${d.clients.length}, тренувань: ${d.sessions.length}`);
    if (!ok) throw new ApiError("Telegram не прийняв файл");
    await tSet("last_backup", new Date(nowMs()).toISOString());
    return { sent: true };
  }
  const isDay = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x ?? "");
  const isTime = (x) => /^\d{1,2}:\d{2}$/.test(x ?? "");
  async function syncParts(sessionId, patch) {
    for (const p of await partsFor([["session_id", "eq", sessionId]])) await D.update("parts", p.id, patch);
  }

  // Підключити бота: webhook, команди, імʼя. Токен лише на сервері.
  async function connectBot(tok, base) {
    if (!/^\d{5,}:[\w-]{30,}$/.test(tok)) throw new ApiError("Це не схоже на токен бота від @BotFather");
    const me = await tg("getMe", {}, tok);
    if (!me?.ok) throw new ApiError("Telegram не прийняв токен — перевірте його");
    const s = await settings(true);
    if (!base) throw new ApiError("Невідома адреса сервера");
    const wh = await tg("setWebhook", { url: `${base}/?tg=1`, secret_token: s.secret, drop_pending_updates: true, allowed_updates: ["message", "callback_query"] }, tok);
    if (!wh?.ok) throw new ApiError("Не вдалося підключити бота: " + (wh?.description ?? ""));
    await tg("setMyCommands", { commands: [
      { command: "today", description: "План на сьогодні" }, { command: "tomorrow", description: "План на завтра" },
      { command: "week", description: "Тиждень" }, { command: "debts", description: "Борги клієнтів" }] }, tok);
    await kvSet("bot_token", tok);
    await kvSet("bot_cfg", BOT_CFG);
    await kvSet("bot_username", me.result.username);
    return { bot_username: me.result.username };
  }
  // Вбудований бот (змінна оточення): підключається сам при першому запуску
  let botChecked = false;
  async function ensureBot() {
    if (botChecked || !opts.botToken || !opts.publicUrl) return;
    botChecked = true;
    const s = await settings(true);
    if (s.bot_token === opts.botToken && s.bot_username && s.bot_url === opts.publicUrl && s.bot_cfg === BOT_CFG) return;
    try { await connectBot(opts.botToken, opts.publicUrl); await kvSet("bot_url", opts.publicUrl); log("bot connected"); }
    catch (e) { botChecked = false; log("bot connect failed: " + e.message); }
  }

  // ───────── API ─────────
  const actions = {
    async bootstrap() {
      const s = await TS(true);
      const today = local().day;
      if (s.last_seen !== today) await tSet("last_seen", today);
      const [clients, parts, pkgs] = await Promise.all([all("clients"), all("parts"), all("packages")]);
      for (const c of clients) {
        const mine = parts.filter((x) => x.client_id === c.id && x.status !== "cancelled");
        c.visits = mine.length;
        c.last_visit = mine.filter((x) => x.day <= today).reduce((m, x) => (x.day > m ? x.day : m), "") || null;
        c.debt = round2(mine.filter((x) => x.pay === "debt" && x.day <= today).reduce((a, x) => a + Number(x.price), 0));
        c.tg_linked = !!c.tg_chat_id; delete c.tg_code;
      }
      clients.sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "uk"));
      return {
        clients, packages: withUse(pkgs, parts),
        settings: {
          remind_before_min: +(s.remind_before_min || 0), digest_morning: s.digest_morning || "", digest_evening: s.digest_evening || "",
          trainer_name: s.trainer_name || "", bot_username: s.bot_username || "", tg_linked: !!s.trainer_chat_id,
          phone_hint: maskPhone(s.trainer_phone), tg_phone_hint: maskPhone(s.trainer_tg_phone), bot_ready: !!s.bot_token, bot_managed: !!opts.botToken,
          gym_address: s.gym_address || "", month_goal: Number(s.month_goal) || 0, backup_weekly: s.backup_weekly !== "0", last_backup: s.last_backup || "",
        },
        subscription: { ...subInfo(s), price_basic: Number(s.price_basic) || 0, price_pro: Number(s.price_pro) || 0, mono_url: s.mono_url || "",
          pay_info: s.pay_info || "", price_text: s.price_text || "", paid_claim_at: s.paid_claim_at || "", paid_claim: s.paid_claim || "" },
      };
    },
    async range(b) {
      if (!isDay(b.from) || !isDay(b.to)) throw new ApiError("Невірні дати");
      return { sessions: await sessionsRange(b.from, b.to), plans: await plansRange(b.from, b.to) };
    },
    // ── Особисті плани (перукар, справи, тощо) ──
    async plans_range(b) {
      if (!isDay(b.from) || !isDay(b.to)) throw new ApiError("Невірні дати");
      return { plans: await plansRange(b.from, b.to) };
    },
    async plan_save(b) {
      const p = b.plan ?? {};
      const title = String(p.title ?? "").trim().slice(0, 200);
      if (!title) throw new ApiError("Напишіть, що заплановано");
      if (!isDay(p.day)) throw new ApiError("Вкажіть дату");
      if (p.time && !isTime(p.time)) throw new ApiError("Невірний час");
      const vals = {
        day: p.day, time: p.time ? hhmm(p.time) : null, duration_min: p.time ? Math.max(0, Math.min(1440, Number(p.duration_min) || 0)) : 0,
        title, place: p.place ? String(p.place).slice(0, 200) : null, note: p.note ? String(p.note).slice(0, 2000) : null,
        cat: PLAN_CATS.includes(p.cat) ? p.cat : "personal", remind_min: p.time ? Math.max(0, Math.min(1440, Number(p.remind_min) || 0)) : 0,
      };
      if (p.id) {
        const old = await D.get("plans", p.id);
        if (!old) throw new ApiError("План не знайдено");
        const again = old.day !== vals.day || old.time !== vals.time || old.remind_min !== vals.remind_min;
        return { plan: await D.update("plans", p.id, { ...vals, ...(again ? { reminded: false } : {}) }) };
      }
      const weeks = Math.max(0, Math.min(26, Math.round(Number(b.repeat_weeks) || 0)));
      const id = newId(), series = weeks ? String(id) : null;
      const plan = await D.create("plans", { ...vals, reminded: false, done: false, series }, id);
      for (let w = 1; w <= weeks; w++) await D.create("plans", { ...vals, day: addDays(vals.day, 7 * w), reminded: false, done: false, series }, newId());
      return { plan, created: weeks + 1 };
    },
    async plan_done(b) { await D.update("plans", b.id, { done: !!b.done }); return {}; },
    async plan_delete(b) {
      const p = await D.get("plans", b.id);
      if (!p) return {};
      if (b.scope === "future" && p.series) {
        const rest = (await all("plans", [["series", "eq", p.series]])).filter((x) => x.day >= p.day);
        for (const x of rest) await D.remove("plans", x.id);
        return { deleted: rest.length };
      }
      await D.remove("plans", b.id);
      return { deleted: 1 };
    },
    async client_save(b) {
      const c = b.client ?? {};
      const name = String(c.name ?? "").trim().slice(0, 200);
      if (!name) throw new ApiError("Вкажіть ім'я клієнта");
      const vals = {
        name, phone: c.phone ? String(c.phone).trim().slice(0, 32) : null,
        price: c.price === "" || c.price == null ? null : Number(c.price) || 0,
        notes: c.notes ? String(c.notes).slice(0, 5000) : null, remind: c.remind !== false,
      };
      if (c.program !== undefined) vals.program = cleanProgram(c.program);
      if (c.id) {
        const old = await D.get("clients", c.id);
        if (!old) throw new ApiError("Клієнта не знайдено");
        // номер змінився — Telegram треба підтвердити заново
        if (old.tg_chat_id && normPhone(old.phone) !== normPhone(vals.phone)) vals.tg_chat_id = null;
        return { client: await D.update("clients", c.id, vals) };
      }
      return { client: await D.create("clients", { ...vals, archived: false }, newId()) };
    },
    async client_program(b) {
      const c = await D.get("clients", b.id);
      if (!c) throw new ApiError("Клієнта не знайдено");
      return { client: await D.update("clients", b.id, { program: cleanProgram(b.program) }) };
    },
    async client_archive(b) { await D.update("clients", b.id, { archived: !!b.archived }); return {}; },
    async client_history(b) {
      const ps = await partsFor([["client_id", "eq", b.id]]);
      const ss = new Map((await all("sessions", [["id", "in", [...new Set(ps.map((p) => p.session_id))]]])).map((s) => [s.id, s]));
      const history = ps.filter((p) => ss.has(p.session_id)).map((p) => {
        const s = ss.get(p.session_id);
        return { id: s.id, day: s.day, start_time: s.start_time, kind: s.kind, title: s.title, status: s.status, price: p.price, pay: p.pay, package_id: p.package_id, part_id: p.id };
      }).sort((a, z) => z.day.localeCompare(a.day) || z.start_time.localeCompare(a.start_time)).slice(0, 300);
      const moves = (await all("moves", [["session_id", "in", [...ss.keys()]]])).length;
      const pk = await all("packages", [["client_id", "eq", b.id]]);
      const pparts = pk.length ? await partsFor([["package_id", "in", pk.map((p) => p.id)]]) : [];
      const measures = (await all("measures", [["client_id", "eq", b.id]])).sort((a, z) => a.day.localeCompare(z.day) || a.id - z.id);
      return { history, packages: withUse(pk, pparts), moves, measures, debts: await clientDebts(b.id) };
    },
    async session_save(b) {
      const s = b.session ?? {};
      if (!isDay(s.day) || !isTime(s.start_time)) throw new ApiError("Вкажіть дату й час");
      const parts = Array.isArray(b.participants) ? b.participants : [];
      if (!parts.length && !(s.kind === "group" || Number(s.extra_amount) > 0)) throw new ApiError("Додайте клієнта");
      const vals = {
        day: s.day, start_time: hhmm(s.start_time), duration_min: Number(s.duration_min) || 60,
        kind: ["personal", "split", "group"].includes(s.kind) ? s.kind : "personal",
        title: s.title ? String(s.title).slice(0, 200) : null, extra_amount: Number(s.extra_amount) || 0, note: s.note ? String(s.note).slice(0, 2000) : null,
      };
      let id = Number(s.id) || 0, status = "planned";
      // спершу перевіряємо абонементи, щоб не записати половину
      const prepared = [];
      const existing = id ? await partsFor([["session_id", "eq", id]]) : [];
      for (const p of parts) {
        const cid = Number(p.client_id);
        if (!(await D.get("clients", cid))) throw new ApiError("Клієнта не знайдено");
        const pay = ["paid", "debt", "package"].includes(p.pay) ? p.pay : "paid";
        let price = Number(p.price) || 0, pkg = null;
        if (pay === "package") {
          const cur = existing.find((x) => x.client_id === cid);
          pkg = Number(p.package_id) || cur?.package_id || null;
          if (!pkg) {
            const found = await pickPackage(cid, id || -1);
            if (!found) { const c = await D.get("clients", cid); throw new ApiError(`У клієнта ${c?.name ?? ""} немає активного абонемента`); }
            pkg = found.id;
          }
          const pk = await D.get("packages", pkg);
          if (!pk || pk.client_id !== cid) throw new ApiError("Абонемент не знайдено");
          price = round2(Number(pk.price) / pk.sessions_total);
        }
        prepared.push({ client_id: cid, price, pay, package_id: pkg });
      }
      if (id) {
        const old = await D.get("sessions", id);
        if (!old) throw new ApiError("Тренування не знайдено");
        status = old.status;
        const timeChanged = old.day !== vals.day || old.start_time !== vals.start_time;
        await D.update("sessions", id, { ...vals, ...(timeChanged ? { reminded: false } : {}) });
        if (timeChanged) for (const x of existing) x.confirm = null;
      } else {
        id = newId();
        await D.create("sessions", { ...vals, status: "planned", reminded: false }, id);
      }
      const keep = new Set(prepared.map((p) => p.client_id));
      for (const x of existing) if (!keep.has(x.client_id)) await D.remove("parts", x.id);
      for (const p of prepared) {
        const cur = existing.find((x) => x.client_id === p.client_id);
        const data = { ...p, session_id: id, day: vals.day, status, ...(cur ? { confirm: cur.confirm ?? null } : {}) };
        if (cur) await D.update("parts", cur.id, data); else await D.create("parts", data, newId());
      }
      // Повтор щотижня (лише для нового тренування): копії з тими ж клієнтами
      const weeks = !s.id ? Math.max(0, Math.min(26, Math.round(Number(b.repeat_weeks) || 0))) : 0;
      let noPkg = 0;
      if (weeks) {
        const series = String(id);
        await D.update("sessions", id, { series });
        for (let w = 1; w <= weeks; w++) {
          const sid = newId(), day = addDays(vals.day, 7 * w);
          await D.create("sessions", { ...vals, day, status: "planned", reminded: false, series }, sid);
          for (const [i, p] of prepared.entries()) {
            let { pay, price, package_id } = p;
            if (pay === "package") {
              const found = await pickPackage(p.client_id, -1);
              if (found) { package_id = found.id; price = round2(Number(found.price) / found.sessions_total); }
              else { pay = "debt"; package_id = null; price = Number(parts[i].price) || (await D.get("clients", p.client_id))?.price || 0; noPkg++; }
            }
            await D.create("parts", { client_id: p.client_id, price, pay, package_id, session_id: sid, day, status: "planned" }, newId());
          }
        }
      }
      return { id, created: weeks + 1, no_package: noPkg };
    },
    async session_status(b) {
      if (!["planned", "cancelled", "no_show"].includes(b.status)) throw new ApiError("Невірний статус");
      await D.update("sessions", b.id, { status: b.status });
      await syncParts(b.id, { status: b.status });
      return {};
    },
    async session_move(b) {
      if (!isDay(b.day) || !isTime(b.start_time)) throw new ApiError("Вкажіть нову дату й час");
      const s = await D.get("sessions", b.id);
      if (!s) throw new ApiError("Тренування не знайдено");
      const t = hhmm(b.start_time);
      await D.create("moves", { session_id: b.id, from_day: s.day, from_time: s.start_time, to_day: b.day, to_time: t, reason: b.reason ? String(b.reason).slice(0, 500) : null, created_day: local().day }, newId());
      await D.update("sessions", b.id, { day: b.day, start_time: t, status: "planned", reminded: false });
      await syncParts(b.id, { day: b.day, status: "planned", confirm: null });
      if (b.notify) await notifyMoved(b.id);
      return {};
    },
    async session_delete(b) {
      const s0 = await D.get("sessions", b.id);
      if (!s0) return {};
      const ids = b.scope === "future" && s0.series
        ? (await all("sessions", [["series", "eq", s0.series]])).filter((x) => x.day >= s0.day).map((x) => x.id) : [s0.id];
      for (const id of ids) {
        for (const p of await partsFor([["session_id", "eq", id]])) await D.remove("parts", p.id);
        for (const m of await all("moves", [["session_id", "eq", id]])) await D.remove("moves", m.id);
        await D.remove("sessions", id);
      }
      return { deleted: ids.length };
    },
    async participant_pay(b) {
      if (!["paid", "debt"].includes(b.pay)) throw new ApiError("Невірний статус оплати");
      const p = await D.get("parts", b.id);
      if (p && p.pay !== "package") await D.update("parts", b.id, { pay: b.pay });
      return {};
    },
    async package_save(b) {
      const p = b.package ?? {};
      if (!p.client_id || !(Number(p.sessions_total) > 0)) throw new ApiError("Вкажіть клієнта й кількість тренувань");
      if (!(await D.get("clients", Number(p.client_id)))) throw new ApiError("Клієнта не знайдено");
      const vals = {
        client_id: Number(p.client_id), title: p.title ? String(p.title).slice(0, 200) : null, sessions_total: Math.round(Number(p.sessions_total)),
        price: Number(p.price) || 0, paid: p.paid !== false, bought_on: isDay(p.bought_on) ? p.bought_on : local().day, expires_on: isDay(p.expires_on) ? p.expires_on : null,
      };
      if (p.id) {
        const row = await D.update("packages", p.id, vals);
        const unit = round2(vals.price / vals.sessions_total);
        for (const x of await partsFor([["package_id", "eq", p.id]])) await D.update("parts", x.id, { price: unit });
        return { package: row };
      }
      const row = await D.create("packages", vals, newId());
      return { package: row, eligible: (await eligibleForPkg(row)).length };
    },
    // Списати з абонемента тренування, проведені/заплановані від дати покупки без абонемента
    async package_attach(b) {
      const pk = await D.get("packages", b.id);
      if (!pk) throw new ApiError("Абонемент не знайдено");
      const used = (await partsFor([["package_id", "eq", pk.id]])).filter((x) => x.status !== "cancelled").length;
      let free = pk.sessions_total - used, n = 0;
      const unit = round2(Number(pk.price) / pk.sessions_total);
      for (const x of await eligibleForPkg(pk)) {
        if (free <= 0) break;
        await D.update("parts", x.id, { pay: "package", package_id: pk.id, price: unit });
        free--; n++;
      }
      return { attached: n };
    },
    async package_delete(b) {
      for (const x of await partsFor([["package_id", "eq", b.id]])) await D.update("parts", x.id, { pay: "debt", package_id: null });
      await D.remove("packages", b.id);
      return {};
    },
    async settings_save(b) {
      const v = b.settings ?? {};
      if (v.remind_before_min != null) await tSet("remind_before_min", String(Math.max(0, Math.min(1440, Number(v.remind_before_min) || 0))));
      if (/^\d{2}:\d{2}$/.test(v.digest_morning ?? "") || v.digest_morning === "") await tSet("digest_morning", v.digest_morning);
      if (/^\d{2}:\d{2}$/.test(v.digest_evening ?? "") || v.digest_evening === "") await tSet("digest_evening", v.digest_evening);
      if (v.trainer_name != null) await tSet("trainer_name", String(v.trainer_name).slice(0, 60));
      if (v.gym_address != null) await tSet("gym_address", String(v.gym_address).trim().slice(0, 200));
      if (v.month_goal != null) await tSet("month_goal", String(Math.max(0, Math.round(Number(v.month_goal) || 0))));
      if (v.backup_weekly != null) await tSet("backup_weekly", v.backup_weekly ? "1" : "0");
      await TS(true);
      return {};
    },
    async credentials_save(b) {
      const s = await TS(true);
      const t = await throttleCheck("pw", s.tid, 5, 15);
      if (!(await passOk(b.old, s.pass_salt, s.pass_hash))) { await throttleFail(t); throw new ApiError("Невірний поточний пароль"); }
      await throttleClear(t);
      // спершу перевіряємо все, щоб не зберегти половину
      const ph = b.phone != null && b.phone !== "" ? normPhone(b.phone) : null;
      if (ph === "") throw new ApiError("Невірний номер телефону");
      const tp = b.tg_phone === "-" ? "" : b.tg_phone != null && b.tg_phone !== "" ? normPhone(b.tg_phone) : null;
      if (tp === "" && b.tg_phone !== "-") throw new ApiError("Невірний номер Telegram");
      const np = b.new ? checkPassword(b.new) : null;
      let logoutOthers = false;
      if (ph && ph !== s.trainer_phone && (await tenantByPhone(ph))) throw new ApiError("Цей номер уже зареєстровано іншим тренером");
      if (ph && ph !== s.trainer_phone) { await tSet("trainer_phone", ph); await tSet("trainer_chat_id", ""); logoutOthers = true; }
      if (tp != null && tp !== (s.trainer_tg_phone || "")) await tSet("trainer_tg_phone", tp);
      if (np) {
        const salt = randCode(12);
        await tSet("pass_salt", salt);
        await tSet("pass_hash", await passHash(np, salt));
        logoutOthers = true;
      }
      if (logoutOthers) await tSet("pass_ver", String(Number(s.pass_ver || 1) + 1)); // інші пристрої вийдуть
      await TS(true);
      return { token: await makeToken() };
    },
    async bot_connect(b, ctx) {
      if (opts.botToken || (await settings(true)).bot_token) throw new ApiError("Бот уже вбудовано в додаток");
      return await connectBot(String(b.token ?? "").trim(), opts.publicUrl || ctx.baseUrl);
    },
    async tg_link_trainer() {
      const s = await TS(true);
      if (!s.bot_username) throw new ApiError("Спершу підключіть бота в налаштуваннях");
      const code = randCode();
      await kvSet("tc_" + code, JSON.stringify({ t: s.tid, at: nowMs() }));
      return { url: `https://t.me/${s.bot_username}?start=t_${code}` };
    },
    async tg_unlink_trainer() { await tSet("trainer_chat_id", ""); return {}; },
    async tg_link_client(b) {
      const s = await TS(true);
      if (!s.bot_username) throw new ApiError("Спершу підключіть бота в налаштуваннях");
      const c = await D.get("clients", b.id);
      if (!c) throw new ApiError("Клієнта не знайдено");
      if (!normPhone(c.phone)) throw new ApiError("Вкажіть номер телефону клієнта — бот підключиться лише з цим номером");
      let code = c.tg_code;
      if (!code) { code = randCode(); await D.update("clients", c.id, { tg_code: code }); }
      return { url: `https://t.me/${s.bot_username}?start=c_${code}` };
    },
    async tg_unlink_client(b) { await D.update("clients", b.id, { tg_chat_id: null, tg_code: null }); return {}; },
    async debt_remind(b) {
      const s = await TS(true);
      const c = await D.get("clients", b.client_id);
      if (!c) throw new ApiError("Клієнта не знайдено");
      const ds = await clientDebts(c.id);
      if (!ds.length) throw new ApiError("У клієнта немає боргу");
      const total = ds.reduce((a, d) => a + d.price, 0);
      const lines = ds.map((d) => `• ${fmtDay(d.day)}${d.time ? ", " + d.time : ""} — ${money(d.price)}`);
      const who = s.trainer_name ? `Ваш тренер ${s.trainer_name}` : "Ваш тренер";
      const plain = `Привіт, ${c.name}! ${who} нагадує про оплату тренувань:\n${lines.join("\n")}\nРазом: ${money(total)}. Дякую! 💪`;
      if (subInfo(s).pro && c.tg_chat_id && s.bot_token && (await send(c.tg_chat_id, esc(plain).replace(`Разом: ${money(total)}`, `<b>Разом: ${money(total)}</b>`)))) {
        await tSet("debt_reminded_" + c.id, String(nowMs()));
        return { sent: true, total };
      }
      return { sent: false, text: plain, total };
    },
    async expenses_range(b) {
      if (!isDay(b.from) || !isDay(b.to)) throw new ApiError("Невірні дати");
      return { expenses: (await all("expenses", [["day", "gte", b.from], ["day", "lte", b.to]])).sort((a, z) => z.day.localeCompare(a.day) || z.id - a.id) };
    },
    async expense_save(b) {
      const e = b.expense ?? {};
      const amount = round2(Number(e.amount));
      if (!(amount > 0)) throw new ApiError("Вкажіть суму");
      if (!isDay(e.day)) throw new ApiError("Вкажіть дату");
      const vals = { day: e.day, amount, cat: EXP_CATS.includes(e.cat) ? e.cat : "other", note: e.note ? String(e.note).slice(0, 300) : null };
      return { expense: e.id ? await D.update("expenses", e.id, vals) : await D.create("expenses", vals, newId()) };
    },
    async expense_delete(b) { await D.remove("expenses", b.id); return {}; },
    async measure_save(b) {
      const m = b.measure ?? {};
      if (!m.client_id || !isDay(m.day)) throw new ApiError("Вкажіть клієнта й дату");
      if (!(await D.get("clients", Number(m.client_id)))) throw new ApiError("Клієнта не знайдено");
      const vals = { client_id: Number(m.client_id), day: m.day, weight: num0(m.weight), waist: num0(m.waist), hips: num0(m.hips), chest: num0(m.chest), fat: num0(m.fat), note: m.note ? String(m.note).slice(0, 500) : null };
      if ([vals.weight, vals.waist, vals.hips, vals.chest, vals.fat].every((x) => x == null) && !vals.note) throw new ApiError("Заповніть хоча б один замір");
      return { measure: m.id ? await D.update("measures", m.id, vals) : await D.create("measures", vals, newId()) };
    },
    async measure_delete(b) { await D.remove("measures", b.id); return {}; },
    async backup_now() { return await sendBackup(); },
    async sub_paid(b) {
      const s = await TS(true);
      const plan = b.plan === "pro" ? "pro" : "basic", months = [1, 3, 6, 12].includes(Number(b.months)) ? Number(b.months) : 1;
      const amount = Math.max(0, Math.round(Number(b.amount) || 0));
      const claim = JSON.stringify({ plan, months, amount, note: b.note ? String(b.note).slice(0, 300) : "" });
      await tSetMany({ paid_claim_at: new Date(nowMs()).toISOString(), paid_claim: claim });
      const g = await settings();
      if (g.admin_chat_id) await send(g.admin_chat_id, `💳 <b>${esc(s.trainer_name || "Тренер")}</b> (${maskPhone(s.trainer_phone)}) оплатив(ла): ${plan === "pro" ? "Pro" : "Звичайний"} на ${months} міс.${amount ? ` · ${amount} грн` : ""}${b.note ? `\n${esc(String(b.note).slice(0, 300))}` : ""}\nПідтвердіть в адмінці.`);
      return { notified: !!g.admin_chat_id };
    },
    async export() {
      const [clients, packages, sessions, participants, moves] = await Promise.all(["clients", "packages", "sessions", "parts", "moves"].map((c) => all(c)));
      for (const c of clients) delete c.tg_code;
      return { clients, packages, sessions: sessions.sort((a, b) => a.day.localeCompare(b.day) || a.start_time.localeCompare(b.start_time)), participants, moves,
        expenses: await all("expenses"), measures: await all("measures") };
    },
  };

  // ───────── Адмінка розробника ─────────
  const tenantsAll = async () => (await st.list("tenants")).map(parseTenant);
  const T_OF = async (b) => { const T = await loadTenant(String(b.tid || "")); if (!T) throw new ApiError("Кабінет не знайдено"); return T; };
  const adminActions = {
    async admin_status(b, ctx) {
      const s = await settings(true);
      const counts = Object.fromEntries(await Promise.all(DATA_TABLES.map(async (n) => [n, (await st.list(n)).length])));
      const ts = await tenantsAll();
      const wh = s.bot_token ? await tg("getWebhookInfo", {}) : null;
      let errors = []; try { errors = JSON.parse(s.errlog || "[]"); } catch { /* */ }
      const base = opts.publicUrl || ctx.baseUrl || "";
      const bySt = ts.reduce((m, T) => { const k = subInfo(T.data).state; m[k] = (m[k] || 0) + 1; return m; }, {});
      return {
        now: new Date(nowMs()).toISOString(), local: local(), counts, errors, tenants_total: ts.length, by_state: bySt,
        bot: { username: s.bot_username || "", managed: !!opts.botToken, cfg: s.bot_cfg || "", webhook: wh?.result ? { url: (wh.result.url || "").replace(/\?.*$/, "?…"), pending: wh.result.pending_update_count, last_error: wh.result.last_error_message || "", last_error_at: wh.result.last_error_date ? new Date(wh.result.last_error_date * 1000).toISOString() : "" } : null },
        ticks: { last: s.last_tick ? new Date(Number(s.last_tick)).toISOString() : "", slack_max: SLACK },
        tick_url: base && s.secret ? `${base}/?tick=${s.secret}` : "",
        billing: { price_basic: Number(s.price_basic) || 0, price_pro: Number(s.price_pro) || 0, mono_url: s.mono_url || "", pay_info: s.pay_info || "", trial_days: Number(s.trial_days || 14) },
        admin_tg: !!s.admin_chat_id,
      };
    },
    async admin_tenants() {
      const ts = await tenantsAll();
      const since = addDays(local().day, -30);
      const [cl, ss] = await Promise.all([st.list("clients"), st.list("sessions", [["day", "gte", since]])]);
      return { tenants: ts.map((T) => {
        const d = T.data, sub = subInfo(d);
        return { tid: T.id, name: d.trainer_name || "", phone: maskPhone(d.trainer_phone), tg_linked: !!d.trainer_chat_id, created_at: d.created_at || "", last_seen: d.last_seen || "",
          ...sub, trial_until: d.trial_until || "", paid_until: d.paid_until || "", paid_claim_at: d.paid_claim_at || "", paid_claim: (() => { try { return JSON.parse(d.paid_claim || "null"); } catch { return null; } })(), note: d.admin_note || "",
          clients: cl.filter((c) => c.tid === T.id && !c.archived).length, sessions_30d: ss.filter((x) => x.tid === T.id && x.status !== "cancelled").length };
      }).sort((a, z) => (z.created_at || "").localeCompare(a.created_at || "")) };
    },
    async admin_tenant_update(b) {
      const T = await T_OF(b);
      const d = T.data, today = local().day;
      if (b.extend_days) {
        const n = Math.max(1, Math.min(3660, Math.round(Number(b.extend_days))));
        const base = [d.paid_until, today].filter(Boolean).sort().pop();
        d.paid_until = addDays(base, n); d.paid_claim_at = ""; d.warned = "";
      }
      if (b.paid_until !== undefined) { if (b.paid_until && !isDay(b.paid_until)) throw new ApiError("Невірна дата"); d.paid_until = b.paid_until || ""; d.warned = ""; }
      if (b.trial_until !== undefined) { if (b.trial_until && !isDay(b.trial_until)) throw new ApiError("Невірна дата"); d.trial_until = b.trial_until || ""; d.warned = ""; }
      if (b.plan !== undefined) d.plan = b.plan === "pro" ? "pro" : "basic";
      if (b.lifetime !== undefined) d.lifetime = b.lifetime ? "1" : "";
      if (b.confirm_claim) {
        let c = {}; try { c = JSON.parse(d.paid_claim || "{}"); } catch { /* */ }
        if (!c.months) throw new ApiError("Немає заявки на оплату");
        d.plan = c.plan === "pro" ? "pro" : "basic";
        const base = [d.paid_until, today].filter(Boolean).sort().pop();
        d.paid_until = addDays(base, 30 * c.months); d.paid_claim = ""; d.paid_claim_at = ""; d.warned = "";
      }
      if (b.reject_claim) { d.paid_claim = ""; d.paid_claim_at = ""; }
      if (b.blocked !== undefined) d.blocked = b.blocked ? "1" : "";
      if (b.note !== undefined) d.admin_note = String(b.note).slice(0, 500);
      await saveTenant(T);
      if ((b.extend_days || b.confirm_claim) && d.trainer_chat_id) await send(d.trainer_chat_id, `✅ Оплату підтверджено. Тариф <b>${d.plan === "pro" ? "Pro" : "Звичайний"}</b> діє до <b>${fmtDay(d.paid_until)} ${d.paid_until.slice(0, 4)}</b>. Дякуємо!`);
      if (b.reject_claim && d.trainer_chat_id) await send(d.trainer_chat_id, "⚠️ Оплату поки не знайдено. Перевірте переказ або напишіть у підтримку.");
      return { tenant: { tid: T.id, ...subInfo(d), paid_until: d.paid_until || "", trial_until: d.trial_until || "" } };
    },
    async admin_impersonate(b) {
      const T = await T_OF(b.tid ? b : { tid: "t1" });
      if (!T.data.pass_hash) throw new ApiError("Тренер ще не створив вхід");
      T.data.admin_last_impersonate = new Date(nowMs()).toISOString(); await saveTenant(T);
      return { token: await makeToken(T) };
    },
    async admin_tick() { return { done: await tick() }; },
    async admin_test_message(b) {
      const T = await T_OF(b.tid ? b : { tid: "t1" });
      if (!T.data.trainer_chat_id) throw new ApiError("Тренер ще не підключив Telegram");
      await settings();
      const ok = await send(T.data.trainer_chat_id, `🛠 Повідомлення від розробника${b.text ? ":\n" + esc(String(b.text).slice(0, 500)) : ""}`);
      if (!ok) throw new ApiError("Telegram не доставив повідомлення");
      return { sent: true };
    },
    async admin_set_trainer_password(b) {
      const T = await T_OF(b.tid ? b : { tid: "t1" });
      const p = checkPassword(b.password);
      T.data.pass_salt = randCode(12);
      T.data.pass_hash = await passHash(p, T.data.pass_salt);
      T.data.pass_ver = String(Number(T.data.pass_ver || 1) + 1);
      await saveTenant(T);
      return {};
    },
    async admin_billing_save(b) {
      if (b.price_text != null) await kvSet("price_text", String(b.price_text).slice(0, 200));
      if (b.pay_info != null) await kvSet("pay_info", String(b.pay_info).slice(0, 1000));
      if (b.price_basic != null) await kvSet("price_basic", String(Math.max(0, Math.round(Number(b.price_basic) || 0))));
      if (b.price_pro != null) await kvSet("price_pro", String(Math.max(0, Math.round(Number(b.price_pro) || 0))));
      if (b.mono_url != null) { const u = String(b.mono_url).trim(); if (u && !/^https:\/\/(send\.monobank\.ua|monobank\.ua)\/[\w/-]+/.test(u)) throw new ApiError("Посилання має бути на send.monobank.ua"); await kvSet("mono_url", u); }
      if (b.trial_days != null) await kvSet("trial_days", String(Math.max(0, Math.min(90, Math.round(Number(b.trial_days) || 0)))));
      return {};
    },
    async admin_tg_link() {
      const s = await settings(true);
      if (!s.bot_username) throw new ApiError("Бот ще не підключений");
      const code = randCode();
      await kvSet("ac_" + code, String(nowMs()));
      return { url: `https://t.me/${s.bot_username}?start=a_${code}` };
    },
    async admin_landing_get() {
      const s = await settings(true);
      let leads = []; try { leads = JSON.parse(s.leads || "[]"); } catch { /* */ }
      return { content: landingContent(s), defaults: LANDING_DEFAULT, leads, landing_domain: s.landing_domain || "", app_domain: s.app_domain || "" };
    },
    async admin_landing_save(b) {
      const c = b.content ?? {};
      const out = {};
      for (const k of ["hero_title", "hero_sub", "cta", "contact_telegram", "contact_phone", "footer"]) if (c[k] != null) out[k] = String(c[k]).trim().slice(0, k === "hero_sub" ? 400 : 120);
      if (c.plates != null) out.plates = (Array.isArray(c.plates) ? c.plates : []).map((x) => String(x).trim().slice(0, 24)).filter(Boolean).slice(0, 6);
      if (c.features != null) out.features = cleanLines(c.features, 12);
      if (c.steps != null) out.steps = cleanLines(c.steps, 6);
      if (c.faq != null) out.faq = cleanLines(c.faq, 15);
      const cur = landingContent(await settings(true));
      await kvSet("landing_json", JSON.stringify({ ...cur, ...out }));
      return { content: { ...cur, ...out } };
    },
    async admin_landing_reset() { await kvSet("landing_json", "{}"); return {}; },
    async admin_leads_clear() { await kvSet("leads", "[]"); return {}; },
    async admin_domains_save(b) {
      const d = (x) => String(x ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const ld = d(b.landing_domain), ad = d(b.app_domain);
      for (const x of [ld, ad]) if (x && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x)) throw new ApiError("Невірний домен: " + x);
      await kvSet("landing_domain", ld); await kvSet("app_domain", ad);
      return { landing_domain: ld, app_domain: ad };
    },
    async admin_reset_throttles() {
      const rows = (await st.list("kv")).filter((r) => String(r.id).startsWith("f_"));
      for (const r of rows) await kvDel(r.id);
      return { cleared: rows.length };
    },
    async admin_clear_errors() { await kvSet("errlog", "[]"); return {}; },
    async admin_backup(b) { const T = await T_OF(b.tid ? b : { tid: "t1" }); return await inTenant(T, () => sendBackup()); },
    async admin_logout_all() { const s = await settings(true); await kvSet("admin_ver", String(Number(s.admin_ver || 1) + 1)); return {}; },
  };
  async function adminPublic(action, b, ctx) {
    const s = await settings(true);
    if (action === "admin_state") return { exists: !!s.admin_hash };
    const ipT = await throttleCheck("aip", ctx.ip || "?", 10, 30);
    if (action === "admin_setup") {
      if (s.admin_hash) throw new ApiError("Вхід розробника вже створено");
      if ((await sha(String(b.code ?? "").trim())) !== ADMIN_SETUP_HASH) { await throttleFail(ipT); throw new ApiError("Невірний код"); }
      const phone = normPhone(b.phone);
      if (!phone) throw new ApiError("Вкажіть номер телефону");
      const p = checkPassword(b.password);
      const salt = randCode(12);
      await kvSet("admin_phone", phone);
      await kvSet("admin_salt", salt);
      await kvSet("admin_hash", await passHash(p, salt));
      await kvSet("admin_ver", "1");
      await settings(true);
      return { token: await makeAdminToken() };
    }
    if (action === "admin_login") {
      const phone = normPhone(b.phone);
      if (phone && phone === s.admin_phone && (await passOk(b.password, s.admin_salt, s.admin_hash))) return { token: await makeAdminToken() };
      await throttleFail(ipT);
      throw new ApiError("Невірний номер або пароль");
    }
  }

  // ───────── Публічні дії (без токена) ─────────
  function landingContent(g) {
    let c = {}; try { c = JSON.parse(g.landing_json || "{}"); } catch { /* */ }
    return { ...LANDING_DEFAULT, ...c };
  }
  const cleanLines = (a, n) => (Array.isArray(a) ? a : []).slice(0, n).map((r) => (Array.isArray(r) ? r : [r]).map((x) => String(x ?? "").trim().slice(0, 400))).filter((r) => r[0]);
  async function publicAction(action, b, ctx) {
    if (!["status", "setup", "register", "login", "forgot", "reset", "landing", "landing_lead"].includes(action)) return undefined;
    const g = await settings(true);
    if (action === "landing") return { content: landingContent(g), price_basic: Number(g.price_basic) || 0, price_pro: Number(g.price_pro) || 0, trial_days: Number(g.trial_days || 14), app_domain: g.app_domain || "" };
    if (action === "landing_lead") {
      const lt = await throttleCheck("lead", ctx.ip || "?", 3, 60);
      const name = String(b.name ?? "").trim().slice(0, 80), phone = String(b.phone ?? "").trim().slice(0, 40), msg = String(b.msg ?? "").trim().slice(0, 600);
      if (!name || !(normPhone(phone) || /^@?\w{4,}$/.test(phone))) throw new ApiError("Вкажіть імʼя й телефон або нік у Telegram");
      await throttleFail(lt);
      let leads = []; try { leads = JSON.parse(g.leads || "[]"); } catch { /* */ }
      leads.unshift({ at: new Date(nowMs()).toISOString(), name, phone, msg });
      await kvSet("leads", JSON.stringify(leads.slice(0, 100)));
      if (g.admin_chat_id) await send(g.admin_chat_id, `📩 Заявка з сайту: <b>${esc(name)}</b>, ${esc(phone)}${msg ? `\n${esc(msg)}` : ""}`);
      return { sent: true };
    }
    if (action === "status") return { needs_setup: false, multi: true, trainer_name: "", price_basic: Number(g.price_basic) || 0, price_pro: Number(g.price_pro) || 0, trial_days: Number(g.trial_days || 14) };
    const ipT = await throttleCheck("ip", ctx.ip || "?", 20, 15);
    const appUrl = b._app && /^https:\/\/[\w.-]+(:\d+)?\/[\w./-]*$/.test(b._app) ? b._app.split("#")[0] : "";
    if (action === "setup" || action === "register") {
      const rt = await throttleCheck("reg", ctx.ip || "?", 5, 60);
      const phone = normPhone(b.phone);
      if (!phone) throw new ApiError("Вкажіть номер телефону");
      const name = String(b.name ?? "").trim().slice(0, 60);
      if (!name) throw new ApiError("Вкажіть ваше імʼя");
      const p = checkPassword(b.password);
      if (await tenantByPhone(phone)) throw new ApiError("Цей номер уже зареєстровано — увійдіть або відновіть пароль");
      await throttleFail(rt);
      const T = await newTenant({ name, phone, password: p });
      if (appUrl && !opts.appUrl) { T.data.app_url = appUrl; await saveTenant(T); }
      if (g.admin_chat_id) await send(g.admin_chat_id, `🆕 Новий тренер: <b>${esc(name)}</b> (${maskPhone(phone)})\nПробний період до ${fmtDay(T.data.trial_until)}`);
      return { token: await makeToken(T) };
    }
    if (action === "login") {
      const phone = normPhone(b.phone);
      const pt = await throttleCheck("ph", phone || "-", 5, 15);
      const T = await tenantByPhone(phone);
      if (T && (await passOk(b.password, T.data.pass_salt, T.data.pass_hash))) {
        await throttleClear(pt);
        if (appUrl && !opts.appUrl && T.data.app_url !== appUrl) { T.data.app_url = appUrl; await saveTenant(T); }
        return { token: await makeToken(T) };
      }
      await throttleFail(pt); await throttleFail(ipT);
      throw new ApiError("Невірний номер або пароль");
    }
    if (action === "forgot") {
      const phone = normPhone(b.phone);
      const pt = await throttleCheck("fg", phone || "-", 3, 60);
      await throttleFail(pt);
      const T = await tenantByPhone(phone);
      if (T && T.data.trainer_chat_id && g.bot_token) {
        const code = randCode(18);
        await kvSet("rs_" + (await sha(code)).slice(0, 30), JSON.stringify({ t: T.id, at: nowMs() }));
        const url = `${opts.appUrl || T.data.app_url || g.app_url || ""}#reset=${code}`;
        await send(T.data.trainer_chat_id, `🔑 Посилання для нового пароля (діє 30 хв):\n${url}\n\nЯкщо це не ви — просто проігноруйте.`);
      }
      return { sent: true }; // однакова відповідь, щоб не підбирали номери
    }
    if (action === "reset") {
      const key = "rs_" + (await sha(String(b.code ?? ""))).slice(0, 30);
      let v = null; try { v = JSON.parse((await kvGet(key)) || "null"); } catch { /* */ }
      const T = v && nowMs() - v.at < 30 * 60000 ? await loadTenant(v.t) : null;
      if (!T) { await throttleFail(ipT); throw new ApiError("Посилання недійсне або застаріло"); }
      const p = checkPassword(b.password);
      T.data.pass_salt = randCode(12);
      T.data.pass_hash = await passHash(p, T.data.pass_salt);
      T.data.pass_ver = String(Number(T.data.pass_ver || 1) + 1);
      await saveTenant(T);
      await kvDel(key);
      return { token: await makeToken(T) };
    }
  }

  // Дії, дозволені, коли підписка закінчилась (лише перегляд і обслуговування)
  const PRO_ONLY = new Set(["tg_link_client", "backup_now"]);
  const READ_OK = new Set(["bootstrap", "range", "plans_range", "client_history", "expenses_range", "export", "backup_now", "settings_save", "credentials_save",
    "tg_link_trainer", "tg_unlink_trainer", "sub_paid", "bot_connect"]);
  async function api(body, headers, ctx = {}) {
    const action = String(body?.action ?? "");
    try {
      if (["admin_state", "admin_setup", "admin_login"].includes(action)) return [200, { ok: true, ...(await adminPublic(action, body, ctx)) }];
      if (action.startsWith("admin_")) {
        if (!(await checkAdmin(String(headers.authorization ?? "").replace(/^Bearer\s+/i, "")))) return [401, { ok: false, error: "auth" }];
        const fn = adminActions[action];
        if (!fn) return [400, { ok: false, error: "Невідома дія" }];
        return [200, { ok: true, ...(await fn(body, ctx)) }];
      }
      const pub = await publicAction(action, body, ctx);
      if (pub !== undefined) return [200, { ok: true, ...pub }];
      const T = await checkToken(String(headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
      if (!T) return [401, { ok: false, error: "auth" }];
      const fn = actions[action];
      if (!fn) return [400, { ok: false, error: "Невідома дія" }];
      const sub = subInfo(T.data);
      if (!sub.writable && !READ_OK.has(action))
        return [402, { ok: false, error: sub.state === "blocked" ? "Кабінет призупинено. Звʼяжіться з підтримкою." : "Підписка закінчилась — дані доступні для перегляду. Продовжте її в «Ще» → «Підписка».", reason: "subscription" }];
      if (PRO_ONLY.has(action) && !sub.pro) return [402, { ok: false, error: PRO_MSG, reason: "pro" }];
      return [200, { ok: true, ...(await inTenant(T, () => fn(body, ctx))) }];
    } catch (e) {
      if (e instanceof ApiError) return [400, { ok: false, error: e.message }];
      await logError("api " + action, e);
      return [500, { ok: false, error: "Помилка сервера" }];
    }
  }

  // ───────── Telegram ─────────
  async function tg(method, payload, token) {
    const t = token ?? S.bot_token;
    if (!t) return null;
    try {
      const r = await tgFetch(`https://api.telegram.org/bot${t}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      return await r.json();
    } catch (e) { log("tg " + method + " failed " + e); return null; }
  }
  async function tgFile(chat, filename, content, caption) {
    const t = S.bot_token;
    if (!t) return false;
    try {
      const fd = new FormData();
      fd.append("chat_id", String(chat));
      fd.append("caption", caption);
      fd.append("document", new Blob([content], { type: "application/json" }), filename);
      const r = await tgFetch(`https://api.telegram.org/bot${t}/sendDocument`, { method: "POST", body: fd });
      return !!(await r.json())?.ok;
    } catch (e) { log("tg file failed " + e); return false; }
  }
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  async function send(chat, text, extra = {}) {
    const j = await tg("sendMessage", { chat_id: Number(chat), text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
    return !!j?.ok;
  }
  const PHONE_KB = { keyboard: [[{ text: "📱 Надіслати мій номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  const NO_KB = { remove_keyboard: true };

  async function dayPlan(day, title, withAlerts = false) {
    const ss = (await sessionsRange(day, day)).filter((s) => s.status !== "cancelled");
    const ps = (await plansRange(day, day)).filter((p) => !p.done);
    const own = ps.length ? `\n\n📝 <b>Особисті плани</b>\n${ps.map((p) => `${p.time || "протягом дня"} ${esc(p.title)}${p.place ? ` · ${esc(p.place)}` : ""}`).join("\n")}` : "";
    let extra = own;
    if (withAlerts) {
      const pa = await pkgAlerts();
      if (pa.length) extra += `\n\n🎫 <b>Абонементи закінчуються</b>\n${pa.map((a) => `${esc(a.name)} — ${a.text}`).join("\n")}`;
      const goal = Number((await TS()).month_goal) || 0;
      if (goal) {
        const m0 = day.slice(0, 8) + "01", inc = (await sessionsRange(m0, addDays(day, -1))).reduce((a, s) => a + sessTotal(s), 0);
        extra += `\n\n🎯 Ціль місяця: ${money(inc)} з ${money(goal)} (${Math.round((inc / goal) * 100)}%)`;
      }
    }
    if (!ss.length) return `${title}\n\nТренувань немає 🙂${extra}`;
    const lines = ss.map((s) => `${s.start_time} ${esc(sessLabel(s))}${s.participants.some((p) => p.confirm === "yes") ? " ✅" : ""}${s.participants.some((p) => p.confirm === "no") ? " ❌" : ""} — ${Math.round(sessTotal(s))}`);
    return `${title}\n\n${lines.join("\n")}\n\n💰 Разом: <b>${money(ss.reduce((a, s) => a + sessTotal(s), 0))}</b> · ${ss.length} трен.${extra}`;
  }
  async function daySummary(day) {
    const allS = await sessionsRange(day, day);
    const ok = allS.filter((s) => s.status !== "cancelled");
    const cancelled = allS.length - ok.length, noShow = allS.filter((s) => s.status === "no_show").length;
    const ps = ok.flatMap((s) => s.participants);
    const debt = ps.filter((p) => p.pay === "debt").reduce((a, p) => a + Number(p.price), 0);
    const pkg = ps.filter((p) => p.pay === "package").reduce((a, p) => a + Number(p.price), 0);
    const moves = (await all("moves", [["created_day", "eq", day]])).length;
    const L = [`📊 <b>Підсумок дня</b> · ${fmtDay(day)}`, "", `Тренувань: <b>${ok.length}</b>`, `Дохід: <b>${money(ok.reduce((a, s) => a + sessTotal(s), 0))}</b>`];
    if (pkg) L.push(`з них з абонементів: ${money(pkg)}`);
    if (debt) L.push(`⚠️ Борг за день: ${money(debt)}`);
    if (cancelled) L.push(`Скасовано: ${cancelled}`);
    if (noShow) L.push(`Не прийшли: ${noShow}`);
    if (moves) L.push(`Переносів: ${moves}`);
    const tm = (await sessionsRange(addDays(day, 1), addDays(day, 1))).filter((s) => s.status !== "cancelled");
    L.push("", tm.length ? `Завтра: ${tm.length} трен., перше о ${tm[0].start_time}` : "Завтра тренувань немає");
    return L.join("\n");
  }
  async function clientChats(sessionId, withParts = false) {
    const ps = await partsFor([["session_id", "eq", sessionId]]);
    const cs = await all("clients", [["id", "in", ps.map((p) => p.client_id)]]);
    const ok = cs.filter((c) => c.tg_chat_id && c.remind);
    return withParts ? ok.map((c) => ({ chat: c.tg_chat_id, part: ps.find((p) => p.client_id === c.id), name: c.name })) : ok.map((c) => c.tg_chat_id);
  }
  async function notifyMoved(id) {
    await settings();
    const s = await D.get("sessions", id);
    for (const chat of await clientChats(id)) await send(chat, `🔁 Ваше тренування перенесено на <b>${fmtDay(s.day)}, ${s.start_time}</b>`);
  }

  async function onCallback(q) {
    await settings(true);
    const [kind, partId, ans] = String(q.data || "").split(":");
    const answer = (text) => tg("answerCallbackQuery", { callback_query_id: q.id, text });
    if (kind !== "cf" || !/^\d+$/.test(partId || "") || !["y", "n"].includes(ans)) return answer("");
    const p0 = await st.get("parts", partId);
    const T = p0 ? await loadTenant(p0.tid) : null;
    if (!T) return answer("Це нагадування вже неактуальне");
    return inTenant(T, async () => {
      const s = await TS();
      const p = await D.get("parts", partId);
      const c = p ? await D.get("clients", p.client_id) : null;
      const chat = q.message?.chat?.id;
      if (!p || !c || String(c.tg_chat_id) !== String(chat)) return answer("Це нагадування вже неактуальне");
      const sess = await D.get("sessions", p.session_id);
      if (!sess || sess.status === "cancelled") return answer("Тренування скасовано");
      const yes = ans === "y";
      await D.update("parts", p.id, { confirm: yes ? "yes" : "no" });
      await answer(yes ? "Дякую! Чекаємо 💪" : "Дякую, що попередили");
      await tg("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
      await send(chat, yes ? "✅ Записала: ви будете. До зустрічі!" : "Добре, тренер отримає повідомлення й звʼяжеться щодо перенесення.");
      if (s.trainer_chat_id) await send(s.trainer_chat_id, yes
        ? `✅ ${esc(c.name)} підтвердив(ла): ${fmtDay(sess.day)}, ${sess.start_time}`
        : `❌ <b>${esc(c.name)} не зможе</b>: ${fmtDay(sess.day)}, ${sess.start_time}\nПеренесіть або скасуйте тренування в журналі.`);
    });
  }

  async function onUpdate(u) {
    if (u?.callback_query) return onCallback(u.callback_query);
    const g = await settings(true);
    const m = u?.message;
    if (!m?.chat) return;
    if (m.chat.type !== "private") return; // бот працює лише в особистих повідомленнях
    const chat = m.chat.id;
    const pendKey = "p_" + String(chat).replace(/\D/g, "");
    if (m.contact) {
      const pend = await kvGet(pendKey);
      if (!pend) return send(chat, "Відкрийте посилання з додатку, щоб підключитися.", { reply_markup: NO_KB });
      if (String(m.contact.user_id) !== String(m.from?.id)) return send(chat, "Надішліть, будь ласка, саме свій номер — кнопкою нижче.", { reply_markup: PHONE_KB });
      const phone = normPhone(m.contact.phone_number);
      const lt = await throttleCheck("tc", String(chat), 5, 60).catch((e) => e);
      if (lt instanceof Error) return send(chat, lt.message, { reply_markup: NO_KB });
      await kvDel(pendKey);
      const [kind, code] = pend.split(":");
      if (kind === "t") {
        let v = null; try { v = JSON.parse((await kvGet("tc_" + code)) || "null"); } catch { /* */ }
        const T = v && nowMs() - v.at < 30 * 60000 ? await loadTenant(v.t) : null;
        if (!T) return send(chat, "Посилання застаріло — створіть нове в додатку.", { reply_markup: NO_KB });
        if (phone !== T.data.trainer_phone && !(T.data.trainer_tg_phone && phone === T.data.trainer_tg_phone)) {
          await throttleFail(lt);
          return send(chat, `❌ Номер не збігається.\n\nУ вашому Telegram: <b>${maskPhone(phone) || "невідомий"}</b>\nУ журналі: <b>${maskPhone(T.data.trainer_phone)}</b>\n\nЯкщо Telegram на іншому номері — у додатку відкрийте «Налаштування» → «Мій вхід», вкажіть його в полі «Номер Telegram», і отримайте нове посилання.`, { reply_markup: NO_KB });
        }
        // цей Telegram може бути привʼязаний лише до одного кабінету
        const other = await tenantByChat(chat);
        if (other && other.id !== T.id) { other.data.trainer_chat_id = ""; await saveTenant(other); }
        T.data.trainer_chat_id = String(chat); await saveTenant(T);
        await kvDel("tc_" + code);
        return send(chat, "✅ Бот підключено до вашого журналу.\n\nЩоранку надсилатиму план дня, увечері — підсумок.\nКоманди: /today /tomorrow /week /debts", { reply_markup: NO_KB });
      }
      if (kind === "a") {
        const at = Number(await kvGet("ac_" + code));
        if (!at || nowMs() - at > 30 * 60000) return send(chat, "Посилання застаріло — створіть нове в адмінці.", { reply_markup: NO_KB });
        if (phone !== g.admin_phone) { await throttleFail(lt); return send(chat, "❌ Номер не збігається з номером розробника.", { reply_markup: NO_KB }); }
        await kvSet("admin_chat_id", String(chat)); await kvDel("ac_" + code);
        return send(chat, "🛠 Сповіщення адмінки підключено: нові тренери та повідомлення про оплату приходитимуть сюди.", { reply_markup: NO_KB });
      }
      if (kind === "c") {
        const [c0] = await st.list("clients", [["tg_code", "eq", code]]);
        const T = c0 ? await loadTenant(c0.tid) : null;
        if (!c0 || !T) return send(chat, "Посилання недійсне — попросіть тренера надіслати нове.", { reply_markup: NO_KB });
        if (!normPhone(c0.phone) || normPhone(c0.phone) !== phone) { await throttleFail(lt); return send(chat, `❌ Номер вашого Telegram (<b>${maskPhone(phone) || "невідомий"}</b>) не збігається з номером, який вказав тренер. Попросіть тренера виправити ваш номер у журналі й надіслати нове посилання.`, { reply_markup: NO_KB }); }
        await st.update("clients", c0.id, { tg_chat_id: String(chat) });
        if (T.data.trainer_chat_id) await send(T.data.trainer_chat_id, `🔔 ${esc(c0.name)} підключив(ла) нагадування про тренування`);
        const coach = T.data.trainer_name ? ` від тренера ${esc(T.data.trainer_name)}` : "";
        return send(chat, `👋 Вітаю, ${esc(c0.name)}!\nТепер ви отримуватимете нагадування про тренування${coach}.`, { reply_markup: NO_KB });
      }
      return;
    }
    const text = String(m.text ?? "").trim();
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.replace(/@\w+$/, "");
    const arg = rest.join(" ");
    const T = await tenantByChat(chat);
    if (cmd === "/start") {
      // цей Telegram уже підключений як тренер — номер вдруге не питаємо
      if (T && arg.startsWith("t_")) {
        await kvDel("tc_" + arg.slice(2));
        return send(chat, "✅ Цей Telegram уже підключено до вашого журналу — нічого робити не треба.\n\nКоманди: /today /tomorrow /week /debts", { reply_markup: NO_KB });
      }
      if (/^[tca]_[\w-]{6,40}$/.test(arg)) {
        await kvSet(pendKey, `${arg[0]}:${arg.slice(2)}`);
        return send(chat, "Щоб підтвердити, що це ви, натисніть кнопку нижче — бот перевірить номер телефону.", { reply_markup: PHONE_KB });
      }
      if (T) return send(chat, "Команди: /today — план на сьогодні, /tomorrow — на завтра, /week — тиждень, /debts — борги");
      return send(chat, "Це бот для нагадувань про тренування. Відкрийте посилання, яке надіслав вам тренер.");
    }
    if (!T) return;
    return inTenant(T, async () => {
      const d = local().day;
      if (cmd === "/today") return send(chat, await dayPlan(d, `📅 <b>Сьогодні</b> · ${fmtDay(d)}`, true));
      if (cmd === "/tomorrow") { const t = addDays(d, 1); return send(chat, await dayPlan(t, `📅 <b>Завтра</b> · ${fmtDay(t)}`)); }
      if (cmd === "/week") {
        const wd = (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7, from = addDays(d, -wd), to = addDays(from, 6);
        const ss = (await sessionsRange(from, to)).filter((x) => x.status !== "cancelled");
        const L = [`🗓 <b>Тиждень</b> · ${fmtDay(from)} – ${fmtDay(to)}`, ""];
        for (let i = 0; i < 7; i++) {
          const day = addDays(from, i), ds = ss.filter((x) => x.day === day);
          L.push(`${fmtDay(day)}: ${ds.length ? `${ds.length} трен. · ${money(ds.reduce((a, x) => a + sessTotal(x), 0))}` : "—"}`);
        }
        L.push("", `💰 Разом: <b>${money(ss.reduce((a, x) => a + sessTotal(x), 0))}</b> · ${ss.length} трен.`);
        return send(chat, L.join("\n"));
      }
      if (cmd === "/debts") {
        const ps = (await partsFor([["pay", "eq", "debt"]])).filter((p) => p.status !== "cancelled" && p.day <= d);
        if (!ps.length) return send(chat, "Боргів немає 🎉");
        const cl = new Map((await all("clients", [["id", "in", [...new Set(ps.map((p) => p.client_id))]]])).map((c) => [c.id, c.name]));
        const by = {};
        for (const p of ps) { const n = cl.get(p.client_id) ?? "?"; by[n] ??= { s: 0, n: 0 }; by[n].s += Number(p.price); by[n].n++; }
        const rows = Object.entries(by).sort((a, z) => z[1].s - a[1].s);
        return send(chat, ["💸 <b>Борги</b>", "", ...rows.map(([n, r]) => `${esc(n)} — ${money(r.s)} (${r.n})`)].join("\n"));
      }
    });
  }

  // ───────── Щохвилини ─────────
  // Сервер «прокидається» раз на годину (безкоштовний тариф), тож беремо події наперед, щоб не пропустити
  const SLACK = Number(opts.tickSlackMin ?? 0);
  async function tick() {
    try { return await tickInner(); } catch (e) { await logError("tick", e); return ["error"]; }
  }
  async function tickInner() {
    const g = await settings(true);
    const L = local(), out = [];
    // запас = скільки минуло з попереднього запуску (щохвилини → 1 хв, щогодини → до 59 хв)
    const gap = g.last_tick ? Math.ceil((nowMs() - Number(g.last_tick)) / 60000) : SLACK;
    const SL = Math.max(0, Math.min(SLACK, gap));
    await kvSet("last_tick", String(nowMs()));
    if (!g.bot_token) return out;
    for (const T of await tenantsAll()) {
      try { await inTenant(T, () => tickTenant(T, L, SL, out)); } catch (e) { await logError("tick " + T.id, e); }
    }
    return out;
  }
  async function tickTenant(T, L, SL, out) {
    const s = await TS();
    const sub = subInfo(s);
    // попередження про підписку: за 3 дні й у день закінчення
    if (s.trainer_chat_id && sub.state !== "blocked") {
      const g = await settings();
      const pay = g.pay_info ? `\n\n${esc(g.pay_info)}` : "";
      if (sub.writable && sub.days_left <= 3 && s.warned !== "3:" + sub.until) {
        await tSet("warned", "3:" + sub.until);
        await send(s.trainer_chat_id, `⏳ ${sub.state === "trial" ? "Пробний період" : "Підписка"} діє до <b>${fmtDay(sub.until)}</b> (${sub.days_left === 0 ? "останній день" : `ще ${sub.days_left} дн.`}).${g.price_basic || g.price_pro ? `\nЗвичайний — ${g.price_basic} грн/міс, Pro — ${g.price_pro} грн/міс.` : ""}\n\nОплатити: у додатку «Ще» → «Підписка».`);
        out.push(`warn ${T.id}`);
      }
      if (sub.state === "expired" && s.warned !== "0:" + sub.until) {
        await tSet("warned", "0:" + sub.until);
        await send(s.trainer_chat_id, `🔒 Підписка закінчилась. Журнал доступний для перегляду, а нагадування клієнтам і записи призупинено.${pay}`);
        out.push(`expired ${T.id}`);
      }
    }
    if (!sub.pro) return; // нагадування, дайджести й бекап — тариф Pro (і пробний період)
    const before = Number(s.remind_before_min || 0);
    if (before > 0) {
      for (const day of [L.day, addDays(L.day, 1)]) {
        const ss = await all("sessions", [["day", "eq", day]]);
        for (const x of ss) {
          if (x.status !== "planned" || x.reminded) continue;
          const diff = toMin(x.start_time) + (day === L.day ? 0 : 1440) - L.min;
          if (diff <= 0 || diff > before + SL) continue;
          await D.update("sessions", x.id, { reminded: true });
          const when = day === L.day ? "сьогодні" : "завтра";
          const coach = s.trainer_name ? ` у ${esc(s.trainer_name)}` : "";
          const addr = s.gym_address ? `\n📍 ${esc(s.gym_address)}` : "";
          for (const r of await clientChats(x.id, true))
            await send(r.chat, `⏰ Нагадування: тренування${coach} <b>${when} о ${x.start_time}</b> 💪${addr}`,
              { reply_markup: { inline_keyboard: [[{ text: "✅ Буду", callback_data: `cf:${r.part.id}:y` }, { text: "❌ Не зможу", callback_data: `cf:${r.part.id}:n` }]] } });
          out.push(`remind ${x.id}`);
        }
      }
    }
    if (!s.trainer_chat_id) return;
    // нагадування тренеру про особисті плани
    for (const day of [L.day, addDays(L.day, 1)]) {
      for (const p of await all("plans", [["day", "eq", day]])) {
        if (!p.time || p.done || p.reminded || !(p.remind_min > 0)) continue;
        const diff = toMin(p.time) + (day === L.day ? 0 : 1440) - L.min;
        if (diff <= 0 || diff > p.remind_min + SL) continue;
        await D.update("plans", p.id, { reminded: true });
        await send(s.trainer_chat_id, `🔔 <b>${day === L.day ? "Сьогодні" : "Завтра"} о ${p.time}</b> — ${esc(p.title)}${p.place ? `\n📍 ${esc(p.place)}` : ""}${p.note ? `\n${esc(p.note)}` : ""}`);
        out.push(`plan ${p.id}`);
      }
    }
    if (s.digest_morning && L.hm >= s.digest_morning && s.last_morning !== L.day) {
      await tSet("last_morning", L.day);
      await send(s.trainer_chat_id, await dayPlan(L.day, `☀️ <b>Доброго ранку!</b> План на ${fmtDay(L.day)}`, true));
      out.push("morning");
    }
    if (s.digest_evening && L.hm >= s.digest_evening && s.last_evening !== L.day) {
      await tSet("last_evening", L.day);
      await send(s.trainer_chat_id, await daySummary(L.day));
      out.push("evening");
    }
    // щонеділі ввечері — резервна копія в Telegram
    const sunday = new Date(L.day + "T12:00:00Z").getUTCDay() === 0;
    if (sunday && s.backup_weekly !== "0" && L.hm >= (s.digest_evening || "21:00") && s.last_backup_day !== L.day) {
      await tSet("last_backup_day", L.day);
      try { await sendBackup(); out.push("backup"); } catch (e) { await logError("backup", e); }
    }
  }

  return { api, onUpdate, tick, settings, ensureBot, logError, setClock: (f) => { nowMs = f; }, swapStore: (x) => { st = x; }, normPhone, local, sleep };
}
