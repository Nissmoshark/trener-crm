// CRM персонального тренера — логіка сервера (не залежить від сховища).
//   POST {action,...}  — API для додатку (Authorization: Bearer <token>)
//   Telegram webhook   — бот тренера й нагадування клієнтам
//   tick()             — щохвилини: нагадування, ранковий план і вечірній підсумок
const TZ = "Europe/Kyiv";
export class ApiError extends Error {}

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
      S = Object.fromEntries(rows.filter((r) => !String(r.id).startsWith("f_") && !String(r.id).startsWith("p_")).map((r) => [String(r.id), r.value ?? ""]));
      sAt = Date.now();
      let changed = false;
      for (const k of ["secret", "token_secret"]) if (!S[k]) { S[k] = randCode(24); await kvSet(k, S[k]); changed = true; }
      for (const [k, v] of [["remind_before_min", "120"], ["digest_morning", "08:00"], ["digest_evening", "21:00"]]) if (S[k] == null) { S[k] = v; await kvSet(k, v); changed = true; }
      if (changed) log("settings initialised");
    }
    return S;
  }
  async function kvGet(k) { return (await st.get("kv", k))?.value ?? null; }
  async function kvSet(k, v) {
    v = String(v ?? "");
    try { await st.update("kv", k, { value: v }); }
    catch (e) { if (e.status !== 404) throw e; try { await st.create("kv", { value: v }, k); } catch (e2) { if (e2.status === 409) await st.update("kv", k, { value: v }); else throw e2; } }
    if (!k.startsWith("f_") && !k.startsWith("p_")) S[k] = v;
  }
  const kvDel = (k) => st.remove("kv", k);

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
  async function makeToken() {
    const s = await settings();
    const payload = b64u(enc.encode(JSON.stringify({ exp: nowMs() + 180 * 86400_000, v: s.pass_ver || "1" })));
    return `${payload}.${await hmac(s.token_secret, payload)}`;
  }
  async function checkToken(tok) {
    if (!tok) return false;
    const [payload, sig] = tok.split(".");
    if (!payload || !sig) return false;
    const s = await settings();
    if (!s.pass_hash || (await hmac(s.token_secret, payload)) !== sig) return false;
    try {
      const p = JSON.parse(Buffer.from(payload, "base64url").toString());
      return p.exp > nowMs() && String(p.v) === String(s.pass_ver || "1");
    } catch { return false; }
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
  const all = (c, f = []) => st.list(c, f);
  async function partsFor(filters) { return await all("parts", filters); }
  function withUse(pkgs, parts, excludeSession) {
    return pkgs.map((p) => ({ ...p, used: parts.filter((x) => x.package_id === p.id && x.status !== "cancelled" && x.session_id !== excludeSession).length }))
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
  const isDay = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x ?? "");
  const isTime = (x) => /^\d{1,2}:\d{2}$/.test(x ?? "");
  async function syncParts(sessionId, patch) {
    for (const p of await partsFor([["session_id", "eq", sessionId]])) await st.update("parts", p.id, patch);
  }

  // Підключити бота: webhook, команди, імʼя. Токен лише на сервері.
  async function connectBot(tok, base) {
    if (!/^\d{5,}:[\w-]{30,}$/.test(tok)) throw new ApiError("Це не схоже на токен бота від @BotFather");
    const me = await tg("getMe", {}, tok);
    if (!me?.ok) throw new ApiError("Telegram не прийняв токен — перевірте його");
    const s = await settings(true);
    if (!base) throw new ApiError("Невідома адреса сервера");
    const wh = await tg("setWebhook", { url: `${base}/?tg=1`, secret_token: s.secret, drop_pending_updates: true, allowed_updates: ["message"] }, tok);
    if (!wh?.ok) throw new ApiError("Не вдалося підключити бота: " + (wh?.description ?? ""));
    await tg("setMyCommands", { commands: [
      { command: "today", description: "План на сьогодні" }, { command: "tomorrow", description: "План на завтра" },
      { command: "week", description: "Тиждень" }, { command: "debts", description: "Борги клієнтів" }] }, tok);
    await kvSet("bot_token", tok);
    await kvSet("bot_username", me.result.username);
    if (s.bot_username && s.bot_username !== me.result.username) await kvSet("trainer_chat_id", "");
    return { bot_username: me.result.username };
  }
  // Вбудований бот (змінна оточення): підключається сам при першому запуску
  let botChecked = false;
  async function ensureBot() {
    if (botChecked || !opts.botToken || !opts.publicUrl) return;
    botChecked = true;
    const s = await settings(true);
    if (s.bot_token === opts.botToken && s.bot_username && s.bot_url === opts.publicUrl) return;
    try { await connectBot(opts.botToken, opts.publicUrl); await kvSet("bot_url", opts.publicUrl); log("bot connected"); }
    catch (e) { botChecked = false; log("bot connect failed: " + e.message); }
  }

  // ───────── API ─────────
  const actions = {
    async bootstrap() {
      const s = await settings(true);
      const today = local().day;
      const [clients, parts, pkgs] = await Promise.all([all("clients"), all("parts"), all("packages")]);
      for (const c of clients) {
        const mine = parts.filter((x) => x.client_id === c.id && x.status !== "cancelled");
        c.visits = mine.length;
        c.last_visit = mine.filter((x) => x.day <= today).reduce((m, x) => (x.day > m ? x.day : m), "") || null;
        c.debt = round2(mine.filter((x) => x.pay === "debt").reduce((a, x) => a + Number(x.price), 0));
        c.tg_linked = !!c.tg_chat_id; delete c.tg_code;
      }
      clients.sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "uk"));
      return {
        clients, packages: withUse(pkgs, parts),
        settings: {
          remind_before_min: +(s.remind_before_min || 0), digest_morning: s.digest_morning || "", digest_evening: s.digest_evening || "",
          trainer_name: s.trainer_name || "", bot_username: s.bot_username || "", tg_linked: !!s.trainer_chat_id,
          phone_hint: maskPhone(s.trainer_phone), tg_phone_hint: maskPhone(s.trainer_tg_phone), bot_ready: !!s.bot_token, bot_managed: !!opts.botToken,
        },
      };
    },
    async range(b) {
      if (!isDay(b.from) || !isDay(b.to)) throw new ApiError("Невірні дати");
      return { sessions: await sessionsRange(b.from, b.to) };
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
      if (c.id) {
        const old = await st.get("clients", c.id);
        if (!old) throw new ApiError("Клієнта не знайдено");
        // номер змінився — Telegram треба підтвердити заново
        if (old.tg_chat_id && normPhone(old.phone) !== normPhone(vals.phone)) vals.tg_chat_id = null;
        return { client: await st.update("clients", c.id, vals) };
      }
      return { client: await st.create("clients", { ...vals, archived: false }, newId()) };
    },
    async client_archive(b) { await st.update("clients", b.id, { archived: !!b.archived }); return {}; },
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
      return { history, packages: withUse(pk, pparts), moves };
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
        const pay = ["paid", "debt", "package"].includes(p.pay) ? p.pay : "paid";
        let price = Number(p.price) || 0, pkg = null;
        if (pay === "package") {
          const cur = existing.find((x) => x.client_id === cid);
          pkg = Number(p.package_id) || cur?.package_id || null;
          if (!pkg) {
            const found = await pickPackage(cid, id || -1);
            if (!found) { const c = await st.get("clients", cid); throw new ApiError(`У клієнта ${c?.name ?? ""} немає активного абонемента`); }
            pkg = found.id;
          }
          const pk = await st.get("packages", pkg);
          if (!pk) throw new ApiError("Абонемент не знайдено");
          price = round2(Number(pk.price) / pk.sessions_total);
        }
        prepared.push({ client_id: cid, price, pay, package_id: pkg });
      }
      if (id) {
        const old = await st.get("sessions", id);
        if (!old) throw new ApiError("Тренування не знайдено");
        status = old.status;
        const timeChanged = old.day !== vals.day || old.start_time !== vals.start_time;
        await st.update("sessions", id, { ...vals, ...(timeChanged ? { reminded: false } : {}) });
      } else {
        id = newId();
        await st.create("sessions", { ...vals, status: "planned", reminded: false }, id);
      }
      const keep = new Set(prepared.map((p) => p.client_id));
      for (const x of existing) if (!keep.has(x.client_id)) await st.remove("parts", x.id);
      for (const p of prepared) {
        const cur = existing.find((x) => x.client_id === p.client_id);
        const data = { ...p, session_id: id, day: vals.day, status };
        if (cur) await st.update("parts", cur.id, data); else await st.create("parts", data, newId());
      }
      return { id };
    },
    async session_status(b) {
      if (!["planned", "cancelled", "no_show"].includes(b.status)) throw new ApiError("Невірний статус");
      await st.update("sessions", b.id, { status: b.status });
      await syncParts(b.id, { status: b.status });
      return {};
    },
    async session_move(b) {
      if (!isDay(b.day) || !isTime(b.start_time)) throw new ApiError("Вкажіть нову дату й час");
      const s = await st.get("sessions", b.id);
      if (!s) throw new ApiError("Тренування не знайдено");
      const t = hhmm(b.start_time);
      await st.create("moves", { session_id: b.id, from_day: s.day, from_time: s.start_time, to_day: b.day, to_time: t, reason: b.reason ? String(b.reason).slice(0, 500) : null, created_day: local().day }, newId());
      await st.update("sessions", b.id, { day: b.day, start_time: t, status: "planned", reminded: false });
      await syncParts(b.id, { day: b.day, status: "planned" });
      if (b.notify) await notifyMoved(b.id);
      return {};
    },
    async session_delete(b) {
      for (const p of await partsFor([["session_id", "eq", b.id]])) await st.remove("parts", p.id);
      for (const m of await all("moves", [["session_id", "eq", b.id]])) await st.remove("moves", m.id);
      await st.remove("sessions", b.id);
      return {};
    },
    async participant_pay(b) {
      if (!["paid", "debt"].includes(b.pay)) throw new ApiError("Невірний статус оплати");
      const p = await st.get("parts", b.id);
      if (p && p.pay !== "package") await st.update("parts", b.id, { pay: b.pay });
      return {};
    },
    async package_save(b) {
      const p = b.package ?? {};
      if (!p.client_id || !(Number(p.sessions_total) > 0)) throw new ApiError("Вкажіть клієнта й кількість тренувань");
      const vals = {
        client_id: Number(p.client_id), title: p.title ? String(p.title).slice(0, 200) : null, sessions_total: Math.round(Number(p.sessions_total)),
        price: Number(p.price) || 0, paid: p.paid !== false, bought_on: isDay(p.bought_on) ? p.bought_on : local().day, expires_on: isDay(p.expires_on) ? p.expires_on : null,
      };
      if (p.id) {
        const row = await st.update("packages", p.id, vals);
        const unit = round2(vals.price / vals.sessions_total);
        for (const x of await partsFor([["package_id", "eq", p.id]])) await st.update("parts", x.id, { price: unit });
        return { package: row };
      }
      return { package: await st.create("packages", vals, newId()) };
    },
    async package_delete(b) {
      for (const x of await partsFor([["package_id", "eq", b.id]])) await st.update("parts", x.id, { pay: "debt", package_id: null });
      await st.remove("packages", b.id);
      return {};
    },
    async settings_save(b) {
      const v = b.settings ?? {};
      if (v.remind_before_min != null) await kvSet("remind_before_min", String(Math.max(0, Math.min(1440, Number(v.remind_before_min) || 0))));
      if (/^\d{2}:\d{2}$/.test(v.digest_morning ?? "") || v.digest_morning === "") await kvSet("digest_morning", v.digest_morning);
      if (/^\d{2}:\d{2}$/.test(v.digest_evening ?? "") || v.digest_evening === "") await kvSet("digest_evening", v.digest_evening);
      if (v.trainer_name != null) await kvSet("trainer_name", String(v.trainer_name).slice(0, 60));
      await settings(true);
      return {};
    },
    async credentials_save(b) {
      const s = await settings(true);
      const t = await throttleCheck("pw", "trainer", 5, 15);
      if (!(await passOk(b.old, s.pass_salt, s.pass_hash))) { await throttleFail(t); throw new ApiError("Невірний поточний пароль"); }
      await throttleClear(t);
      if (b.phone != null && b.phone !== "") {
        const ph = normPhone(b.phone);
        if (!ph) throw new ApiError("Невірний номер телефону");
        if (ph !== s.trainer_phone) { await kvSet("trainer_phone", ph); await kvSet("trainer_chat_id", ""); }
      }
      // окремий номер Telegram (якщо Telegram зареєстровано на інший номер); "-" — прибрати
      if (b.tg_phone === "-") await kvSet("trainer_tg_phone", "");
      else if (b.tg_phone != null && b.tg_phone !== "") {
        const tp = normPhone(b.tg_phone);
        if (!tp) throw new ApiError("Невірний номер Telegram");
        if (tp !== s.trainer_tg_phone) { await kvSet("trainer_tg_phone", tp); }
      }
      if (b.new) {
        const p = checkPassword(b.new);
        const salt = randCode(12);
        await kvSet("pass_salt", salt);
        await kvSet("pass_hash", await passHash(p, salt));
      }
      await kvSet("pass_ver", String(Number(s.pass_ver || 1) + 1)); // інші пристрої вийдуть
      await settings(true);
      return { token: await makeToken() };
    },
    async bot_connect(b, ctx) {
      if (opts.botToken) throw new ApiError("Бот уже вбудовано в додаток");
      return await connectBot(String(b.token ?? "").trim(), opts.publicUrl || ctx.baseUrl);
    },
    async tg_link_trainer() {
      const s = await settings(true);
      if (!s.bot_username) throw new ApiError("Спершу підключіть бота в налаштуваннях");
      const code = randCode();
      await kvSet("trainer_code", code);
      await kvSet("trainer_code_at", String(nowMs()));
      return { url: `https://t.me/${s.bot_username}?start=t_${code}` };
    },
    async tg_unlink_trainer() { await kvSet("trainer_chat_id", ""); return {}; },
    async tg_link_client(b) {
      const s = await settings(true);
      if (!s.bot_username) throw new ApiError("Спершу підключіть бота в налаштуваннях");
      const c = await st.get("clients", b.id);
      if (!c) throw new ApiError("Клієнта не знайдено");
      if (!normPhone(c.phone)) throw new ApiError("Вкажіть номер телефону клієнта — бот підключиться лише з цим номером");
      let code = c.tg_code;
      if (!code) { code = randCode(); await st.update("clients", c.id, { tg_code: code }); }
      return { url: `https://t.me/${s.bot_username}?start=c_${code}` };
    },
    async tg_unlink_client(b) { await st.update("clients", b.id, { tg_chat_id: null, tg_code: null }); return {}; },
    async export() {
      const [clients, packages, sessions, participants, moves] = await Promise.all(["clients", "packages", "sessions", "parts", "moves"].map((c) => all(c)));
      for (const c of clients) delete c.tg_code;
      return { clients, packages, sessions: sessions.sort((a, b) => a.day.localeCompare(b.day) || a.start_time.localeCompare(b.start_time)), participants, moves };
    },
  };

  // Публічні дії (без токена)
  async function publicAction(action, b, ctx) {
    if (!["status", "setup", "login", "forgot", "reset"].includes(action)) return undefined;
    const s = await settings(true);
    if (action === "status") return { needs_setup: !s.pass_hash, trainer_name: s.trainer_name || "" };
    const ipT = await throttleCheck("ip", ctx.ip || "?", 20, 15);
    if (b._app && /^https:\/\/[\w.-]+(:\d+)?\/[\w./-]*$/.test(b._app)) await kvSet("app_url", b._app.split("#")[0]);
    if (action === "setup") {
      if (s.pass_hash) throw new ApiError("Обліковий запис уже створено");
      const phone = normPhone(b.phone);
      if (!phone) throw new ApiError("Вкажіть номер телефону");
      const p = checkPassword(b.password);
      const salt = randCode(12);
      await kvSet("trainer_phone", phone);
      if (b.name) await kvSet("trainer_name", String(b.name).trim().slice(0, 60));
      await kvSet("pass_salt", salt);
      await kvSet("pass_hash", await passHash(p, salt));
      await kvSet("pass_ver", "1");
      await settings(true);
      return { token: await makeToken() };
    }
    if (action === "login") {
      const phone = normPhone(b.phone);
      const pt = await throttleCheck("ph", phone || "-", 5, 15);
      if (phone && phone === s.trainer_phone && (await passOk(b.password, s.pass_salt, s.pass_hash))) {
        await throttleClear(pt);
        return { token: await makeToken() };
      }
      await throttleFail(pt); await throttleFail(ipT);
      throw new ApiError("Невірний номер або пароль");
    }
    if (action === "forgot") {
      const phone = normPhone(b.phone);
      const pt = await throttleCheck("fg", phone || "-", 3, 60);
      await throttleFail(pt);
      if (phone && phone === s.trainer_phone && s.trainer_chat_id && s.bot_token) {
        const code = randCode(18);
        await kvSet("reset_hash", await sha(code));
        await kvSet("reset_at", String(nowMs()));
        const url = `${s.app_url || ""}#reset=${code}`;
        await send(s.trainer_chat_id, `🔑 Посилання для нового пароля (діє 30 хв):\n${url}\n\nЯкщо це не ви — просто проігноруйте.`);
      }
      return { sent: true }; // однакова відповідь, щоб не підбирали номери
    }
    if (action === "reset") {
      const ok = s.reset_hash && (await sha(String(b.code ?? ""))) === s.reset_hash && nowMs() - Number(s.reset_at || 0) < 30 * 60000;
      if (!ok) { await throttleFail(ipT); throw new ApiError("Посилання недійсне або застаріло"); }
      const p = checkPassword(b.password);
      const salt = randCode(12);
      await kvSet("pass_salt", salt);
      await kvSet("pass_hash", await passHash(p, salt));
      await kvSet("pass_ver", String(Number(s.pass_ver || 1) + 1));
      await kvSet("reset_hash", "");
      await settings(true);
      return { token: await makeToken() };
    }
  }

  async function api(body, headers, ctx = {}) {
    const action = String(body?.action ?? "");
    try {
      const pub = await publicAction(action, body, ctx);
      if (pub !== undefined) return [200, { ok: true, ...pub }];
      const tok = String(headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!(await checkToken(tok))) return [401, { ok: false, error: "auth" }];
      const fn = actions[action];
      if (!fn) return [400, { ok: false, error: "Невідома дія" }];
      return [200, { ok: true, ...(await fn(body, ctx)) }];
    } catch (e) {
      if (e instanceof ApiError) return [400, { ok: false, error: e.message }];
      log("api error " + action + ": " + (e?.stack || e));
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
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  async function send(chat, text, extra = {}) {
    const j = await tg("sendMessage", { chat_id: Number(chat), text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
    return !!j?.ok;
  }
  const PHONE_KB = { keyboard: [[{ text: "📱 Надіслати мій номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  const NO_KB = { remove_keyboard: true };

  async function dayPlan(day, title) {
    const ss = (await sessionsRange(day, day)).filter((s) => s.status !== "cancelled");
    if (!ss.length) return `${title}\n\nТренувань немає 🙂`;
    const lines = ss.map((s) => `${s.start_time} ${esc(sessLabel(s))} — ${Math.round(sessTotal(s))}`);
    return `${title}\n\n${lines.join("\n")}\n\n💰 Разом: <b>${money(ss.reduce((a, s) => a + sessTotal(s), 0))}</b> · ${ss.length} трен.`;
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
  async function clientChats(sessionId) {
    const ps = await partsFor([["session_id", "eq", sessionId]]);
    const cs = await all("clients", [["id", "in", ps.map((p) => p.client_id)]]);
    return cs.filter((c) => c.tg_chat_id && c.remind).map((c) => c.tg_chat_id);
  }
  async function notifyMoved(id) {
    await settings();
    const s = await st.get("sessions", id);
    for (const chat of await clientChats(id)) await send(chat, `🔁 Ваше тренування перенесено на <b>${fmtDay(s.day)}, ${s.start_time}</b>`);
  }

  async function onUpdate(u) {
    const s = await settings(true);
    const m = u?.message;
    if (!m?.chat) return;
    const chat = m.chat.id, isTrainer = !!s.trainer_chat_id && String(chat) === String(s.trainer_chat_id);
    if (m.chat.type !== "private") return; // бот працює лише в особистих повідомленнях
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
        const fresh = s.trainer_code && code === s.trainer_code && nowMs() - Number(s.trainer_code_at || 0) < 30 * 60000;
        if (!fresh) return send(chat, "Посилання застаріло — створіть нове в додатку.", { reply_markup: NO_KB });
        if (phone !== s.trainer_phone && !(s.trainer_tg_phone && phone === s.trainer_tg_phone)) {
          await throttleFail(lt);
          return send(chat, `❌ Номер не збігається.\n\nУ вашому Telegram: <b>${maskPhone(phone) || "невідомий"}</b>\nУ журналі: <b>${maskPhone(s.trainer_phone)}</b>\n\nЯкщо Telegram на іншому номері — у додатку відкрийте «Налаштування» → «Мій вхід», вкажіть його в полі «Номер Telegram», і отримайте нове посилання.`, { reply_markup: NO_KB });
        }
        await kvSet("trainer_chat_id", String(chat));
        await kvSet("trainer_code", "");
        return send(chat, "✅ Бот підключено до вашого журналу.\n\nЩоранку надсилатиму план дня, увечері — підсумок.\nКоманди: /today /tomorrow /week /debts", { reply_markup: NO_KB });
      }
      if (kind === "c") {
        const [c] = await all("clients", [["tg_code", "eq", code]]);
        if (!c) return send(chat, "Посилання недійсне — попросіть тренера надіслати нове.", { reply_markup: NO_KB });
        if (!normPhone(c.phone) || normPhone(c.phone) !== phone) { await throttleFail(lt); return send(chat, `❌ Номер вашого Telegram (<b>${maskPhone(phone) || "невідомий"}</b>) не збігається з номером, який вказав тренер. Попросіть тренера виправити ваш номер у журналі й надіслати нове посилання.`, { reply_markup: NO_KB }); }
        await st.update("clients", c.id, { tg_chat_id: String(chat) });
        if (s.trainer_chat_id) await send(s.trainer_chat_id, `🔔 ${esc(c.name)} підключив(ла) нагадування про тренування`);
        const coach = s.trainer_name ? ` від тренера ${esc(s.trainer_name)}` : "";
        return send(chat, `👋 Вітаю, ${esc(c.name)}!\nТепер ви отримуватимете нагадування про тренування${coach}.`, { reply_markup: NO_KB });
      }
      return;
    }
    const text = String(m.text ?? "").trim();
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.replace(/@\w+$/, "");
    const arg = rest.join(" ");
    if (cmd === "/start") {
      if (/^[tc]_[\w-]{6,40}$/.test(arg)) {
        await kvSet(pendKey, `${arg[0]}:${arg.slice(2)}`);
        return send(chat, "Щоб підтвердити, що це ви, натисніть кнопку нижче — бот перевірить номер телефону.", { reply_markup: PHONE_KB });
      }
      if (isTrainer) return send(chat, "Команди: /today — план на сьогодні, /tomorrow — на завтра, /week — тиждень, /debts — борги");
      return send(chat, "Це бот для нагадувань про тренування. Відкрийте посилання, яке надіслав вам тренер.");
    }
    if (!isTrainer) return;
    const d = local().day;
    if (cmd === "/today") return send(chat, await dayPlan(d, `📅 <b>Сьогодні</b> · ${fmtDay(d)}`));
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
      const ps = (await partsFor([["pay", "eq", "debt"]])).filter((p) => p.status !== "cancelled");
      if (!ps.length) return send(chat, "Боргів немає 🎉");
      const cl = new Map((await all("clients", [["id", "in", [...new Set(ps.map((p) => p.client_id))]]])).map((c) => [c.id, c.name]));
      const by = {};
      for (const p of ps) { const n = cl.get(p.client_id) ?? "?"; by[n] ??= { s: 0, n: 0 }; by[n].s += Number(p.price); by[n].n++; }
      const rows = Object.entries(by).sort((a, z) => z[1].s - a[1].s);
      return send(chat, ["💸 <b>Борги</b>", "", ...rows.map(([n, r]) => `${esc(n)} — ${money(r.s)} (${r.n})`)].join("\n"));
    }
  }

  // ───────── Щохвилини ─────────
  async function tick() {
    const s = await settings(true);
    const L = local(), out = [];
    const before = Number(s.remind_before_min || 0);
    if (before > 0 && s.bot_token) {
      for (const day of [L.day, addDays(L.day, 1)]) {
        const ss = await all("sessions", [["day", "eq", day]]);
        for (const x of ss) {
          if (x.status !== "planned" || x.reminded) continue;
          const diff = toMin(x.start_time) + (day === L.day ? 0 : 1440) - L.min;
          if (diff <= 0 || diff > before) continue;
          await st.update("sessions", x.id, { reminded: true });
          const when = day === L.day ? "сьогодні" : "завтра";
          const coach = s.trainer_name ? ` у ${esc(s.trainer_name)}` : "";
          for (const chat of await clientChats(x.id)) await send(chat, `⏰ Нагадування: тренування${coach} <b>${when} о ${x.start_time}</b> 💪`);
          out.push(`remind ${x.id}`);
        }
      }
    }
    if (s.trainer_chat_id && s.bot_token) {
      if (s.digest_morning && L.hm >= s.digest_morning && s.last_morning !== L.day) {
        await kvSet("last_morning", L.day);
        await send(s.trainer_chat_id, await dayPlan(L.day, `☀️ <b>Доброго ранку!</b> План на ${fmtDay(L.day)}`));
        out.push("morning");
      }
      if (s.digest_evening && L.hm >= s.digest_evening && s.last_evening !== L.day) {
        await kvSet("last_evening", L.day);
        await send(s.trainer_chat_id, await daySummary(L.day));
        out.push("evening");
      }
    }
    return out;
  }

  return { api, onUpdate, tick, settings, ensureBot, setClock: (f) => { nowMs = f; }, swapStore: (x) => { st = x; }, normPhone, local, sleep };
}
