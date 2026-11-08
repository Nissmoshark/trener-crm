// «Світлиця» · графік відключень ДТЕК (Yasno), попередження перед відключенням, прогноз АКБ
//   POST {action:"dtek"|"dtek_save"} (Authorization: Bearer <токен «Світлиці»>)
//   POST ?tick=<secret>  — cron щохвилини: оновити графік, надіслати попередження
import postgres from "npm:postgres@3.4.5";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const TZ = "Europe/Kyiv";
export const sql = postgres(env("SUPABASE_DB_URL"), {
  prepare: false, max: 2,
  types: { bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
});
export let nowMs = () => Date.now();
export function setClock(f: () => number) { nowMs = f; }
let S: Record<string, string> = {}, sAt = 0;
async function settings(force = false) {
  if (force || Date.now() - sAt > 15_000) {
    S = Object.fromEntries((await sql`select key, value from energy.settings`).map((r) => [r.key, r.value ?? ""]));
    sAt = Date.now();
  }
  return S;
}
async function setSetting(k: string, v: string) {
  await sql`insert into energy.settings(key,value) values(${k},${v}) on conflict(key) do update set value=excluded.value`;
  S[k] = v;
}
const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export function local(ms = nowMs()) {
  const o: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(ms))) o[p.type] = p.value;
  const h = +o.hour % 24;
  return { day: `${o.year}-${o.month}-${o.day}`, hm: `${String(h).padStart(2, "0")}:${o.minute}`, min: h * 60 + +o.minute };
}
function fmtDur(min: number) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} год${m ? ` ${m} хв` : ""}` : `${m} хв`;
}
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const numDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
function localToMs(day: string, hm: string) {
  const want = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5));
  let g = want;
  for (let i = 0; i < 3; i++) {
    const l = local(g);
    const got = Date.UTC(+l.day.slice(0, 4), +l.day.slice(5, 7) - 1, +l.day.slice(8, 10), Math.floor(l.min / 60), l.min % 60);
    if (got === want) break;
    g += want - got;
  }
  return g;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Telegram: у сімейну групу (той самий бот, що й основна функція)
export let tgCall = async (token: string, method: string, body: Record<string, unknown>): Promise<any> => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  return await r.json();
};
export function setTgCall(f: (t: string, m: string, b: Record<string, unknown>) => Promise<any>) { tgCall = f; }
// Нове повідомлення замінює попереднє такого ж типу — у групі лише актуальне
async function notify(text: string, kind = "dtek_sched") {
  const token = env("ENERGY_BOT_TOKEN") || S.bot_token;
  if (!S.chat_id || !token) return;
  const old = Number(S["tgm_" + kind] || 0);
  if (old) { try { await tgCall(token, "deleteMessage", { chat_id: Number(S.chat_id), message_id: old }); } catch { /* */ } }
  try {
    const j = await tgCall(token, "sendMessage", { chat_id: Number(S.chat_id), text, parse_mode: "HTML", disable_web_page_preview: true });
    await setSetting("tgm_" + kind, j?.result?.message_id ? String(j.result.message_id) : "");
  } catch (e) { console.warn("notify failed", String(e)); }
}
// Вхід — той самий токен, що й в основному додатку
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function checkToken(tok: string) {
  const [payload, sig] = tok.split(".");
  if (!payload || !sig) return null;
  const s = await settings();
  if ((await hmac(s.token_secret, payload)) !== sig) return null;
  try {
    const p = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!(p.exp > nowMs()) || !p.m) return null;
    const [m] = await sql`select id, name, role, pin_ver, pass_hash is not null has_pass from energy.members where id=${p.m} and active`;
    return m && m.pin_ver === p.v && m.has_pass ? m : null;
  } catch { return null; }
}

// ───────────── Графік відключень ДТЕК (Yasno) ─────────────
// Основне джерело — офіційний API Yasno (ДТЕК, Київ); запасне — дзеркало сайту ДТЕК на GitHub.
export type Slot = { s: number; e: number; t: "off" | "maybe" };
export type DaySched = { date: string; status: string; slots: Slot[] };
export type Sched = { group: string; groups: string[]; days: DaySched[]; updated: string; src: string; area?: string };
// Регіони: Київ — Yasno (ДТЕК Київські електромережі) + дзеркало; інші — дзеркало сайтів ДТЕК
export const AREAS: Record<string, string> = { kyiv: "Київ", "kyiv-region": "Київська область", dnipro: "Дніпро й область", odesa: "Одеса й область" };
const area = () => (AREAS[S.dtek_area] ? S.dtek_area : "kyiv");
const YASNO_URL = (r: string, d: string) => `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/${r}/dsos/${d}/planned-outages`;
const MIRROR_URL = (a: string) => `https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/${a}.json`;
export let schedFetch = async (url: string): Promise<any> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
};
export function setSchedFetch(f: (url: string) => Promise<any>) { schedFetch = f; }
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function mergeSlots(a: Slot[]) {
  const o: Slot[] = [];
  for (const x of [...a].sort((p, q) => p.s - q.s)) {
    const l = o[o.length - 1];
    if (l && l.t === x.t && l.e >= x.s) l.e = Math.max(l.e, x.e); else o.push({ ...x });
  }
  return o;
}
export function parseYasno(j: any, group: string): Sched {
  const groups = Object.keys(j || {}).filter((k) => /^\d+\.\d+$/.test(k)).sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
  const g = j?.[group];
  const days: DaySched[] = [];
  for (const k of ["today", "tomorrow"]) {
    const d = g?.[k]; if (!d?.date) continue;
    const slots = (d.slots || []).filter((x: any) => x.type !== "NotPlanned")
      .map((x: any) => ({ s: +x.start, e: +x.end, t: x.type === "Definite" ? "off" : "maybe" } as Slot));
    days.push({ date: String(d.date).slice(0, 10), status: String(d.status || ""), slots: mergeSlots(slots) });
  }
  return { group, groups, days, updated: g?.updatedOn || "", src: "yasno" };
}
// Дзеркало сайту ДТЕК: по годинах "yes"/"no"/"first"/"second"/"maybe"/"mfirst"/"msecond"
export function parseMirror(j: any, group: string): Sched {
  const data = j?.fact?.data || {};
  const key = "GPV" + group;
  const groups = new Set<string>();
  const days: DaySched[] = [];
  for (const ts of Object.keys(data).sort()) {
    for (const k of Object.keys(data[ts] || {})) if (k.startsWith("GPV")) groups.add(k.slice(3));
    const h = data[ts]?.[key]; if (!h) continue;
    const slots: Slot[] = [];
    for (let i = 1; i <= 24; i++) {
      const v = h[String(i)], a = (i - 1) * 60;
      if (v === "no") slots.push({ s: a, e: a + 60, t: "off" });
      else if (v === "first") slots.push({ s: a, e: a + 30, t: "off" });
      else if (v === "second") slots.push({ s: a + 30, e: a + 60, t: "off" });
      else if (v === "maybe") slots.push({ s: a, e: a + 60, t: "maybe" });
      else if (v === "mfirst") slots.push({ s: a, e: a + 30, t: "maybe" });
      else if (v === "msecond") slots.push({ s: a + 30, e: a + 60, t: "maybe" });
    }
    days.push({ date: local(+ts * 1000).day, status: "ScheduleApplies", slots: mergeSlots(slots) });
  }
  const today = local().day;
  return { group, groups: [...groups].sort((a, b) => parseFloat(a) - parseFloat(b)), days: days.filter((d) => d.date >= today).slice(0, 2), updated: j?.lastUpdated || "", src: "mirror" };
}
export async function loadSched(group: string): Promise<Sched> {
  const a = area();
  if (a === "kyiv") {
    try { return { ...parseYasno(await schedFetch(YASNO_URL(S.dtek_region || "25", S.dtek_dso || "902")), group), area: a }; }
    catch (e) { console.warn("yasno failed", String(e)); }
  }
  return { ...parseMirror(await schedFetch(MIRROR_URL(a)), group), area: a };
}
export const STATUS_UA: Record<string, string> = {
  ScheduleApplies: "діє графік", WaitingForSchedule: "графік ще не опубліковано", EmergencyShutdowns: "екстрені відключення — графік не діє",
};
const dayLbl = (d: string) => d === local().day ? "сьогодні" : d === local(nowMs() + 86400000).day ? "завтра" : `${d.slice(8)}.${d.slice(5, 7)}`;
export function slotsText(d: DaySched) {
  const off = d.slots.filter((x) => x.t === "off"), maybe = d.slots.filter((x) => x.t === "maybe");
  if (d.status !== "ScheduleApplies" && !d.slots.length) return STATUS_UA[d.status] ?? d.status;
  if (!off.length && !maybe.length) return "відключень не заплановано 🎉";
  const mins = off.reduce((a, x) => a + x.e - x.s, 0);
  return [...off.map((x) => `🕯 ${hhmm(x.s)}–${x.e === 1440 ? "24:00" : hhmm(x.e)}`), ...maybe.map((x) => `❔ можливо ${hhmm(x.s)}–${x.e === 1440 ? "24:00" : hhmm(x.e)}`),
    `Без світла: <b>${fmtDur(mins)}</b>`].join("\n");
}
// Абсолютні інтервали відключень (через північ — злиті)
export function offIntervals(sc: Sched) {
  const out: { a: number; b: number }[] = [];
  for (const d of sc.days) {
    if (d.status === "EmergencyShutdowns") continue;
    const nextDay = numDay(dayNum(d.date) + 1);
    for (const x of d.slots.filter((y) => y.t === "off")) {
      const a = localToMs(d.date, hhmm(x.s)), b = x.e >= 1440 ? localToMs(nextDay, "00:00") : localToMs(d.date, hhmm(x.e));
      const l = out[out.length - 1];
      if (l && a - l.b <= 60_000) l.b = Math.max(l.b, b); else out.push({ a, b });
    }
  }
  return out;
}
const cachedSched = (): Sched | null => { try { return S.dtek_sched ? JSON.parse(S.dtek_sched) : null; } catch { return null; } };

// Прогноз: на скільки вистачить АКБ при звичному навантаженні
export async function battForecast() {
  const [r] = await sql`select soc, load_w, grid_on, ts from energy.samples order by ts desc limit 1`;
  if (!r || r.soc == null) return null;
  const reserve = Number(S.batt_reserve || 10);
  const [ld] = await sql`select avg(load_w)::float8 a, count(*)::int n from energy.samples where not grid_on and load_w > 0 and ts > now() - interval '14 days'`;
  const [rc] = await sql`select avg(load_w)::float8 a from energy.samples where load_w > 0 and ts > now() - interval '2 hours'`;
  const load = ld?.n >= 6 ? ld.a : rc?.a ?? r.load_w;
  const avail = Math.max(0, r.soc - reserve);
  if (S.batt_kwh && load > 10) {
    return { soc: Math.round(r.soc), load_w: Math.round(load), hours: (avail / 100) * Number(S.batt_kwh) * 1000 / load, method: "kwh" };
  }
  // без ємності — за історією: скільки % АКБ іде за годину без світла
  const [h] = await sql`select sum(soc_start - coalesce(soc_end, soc_min))::float8 d, sum(extract(epoch from (ended_at - started_at)) / 3600)::float8 hrs
    from energy.outages where ended_at is not null and started_at > now() - interval '21 days' and soc_start is not null
      and ended_at - started_at > interval '30 minutes'`;
  if (h?.hrs > 0.5 && h.d > 1) return { soc: Math.round(r.soc), load_w: load ? Math.round(load) : null, hours: avail / (h.d / h.hrs), method: "history" };
  return null;
}
const verdict = (fc: { hours: number } | null, needMin: number) => !fc ? "" : fc.hours * 60 >= needMin * 1.15
  ? `✅ АКБ вистачить: ≈ ${fmtDur(fc.hours * 60)}` : `⚠️ АКБ може не вистачити: ≈ ${fmtDur(fc.hours * 60)} з потрібних ${fmtDur(needMin)} — вимкніть зайве`;

export async function dtekTick(force = false) {
  const s = S, group = s.dtek_group;
  if (!group) return null;
  const out: string[] = [];
  const every = 10 * 60_000;
  let sc = cachedSched();
  const sameArea = (sc?.area ?? "kyiv") === area();
  if (force || !sc || sc.group !== group || !sameArea || nowMs() - Number(s.dtek_at || 0) >= every - 20_000) {
    try {
      const fresh = await loadSched(group);
      await setSetting("dtek_at", String(nowMs())); await setSetting("dtek_err", "");
      if (!fresh.groups.includes(group) && fresh.groups.length) { await setSetting("dtek_err", `Черги ${group} немає в графіку ДТЕК`); }
      // повідомлення про новий або змінений графік
      let sigs: Record<string, string> = {}; try { sigs = JSON.parse(s.dtek_sigs || "{}"); } catch { /* */ }
      const firstRun = !sc || sc.group !== group || !sameArea;
      const today = local().day;
      for (const d of fresh.days) {
        const sig = d.status + "|" + JSON.stringify(d.slots);
        const prev = sigs[d.date];
        if (!firstRun && s.dtek_notify !== "0" && prev !== sig) {
          if (d.status === "EmergencyShutdowns") { await notify(`🚨 <b>Екстрені відключення</b> (${dayLbl(d.date)})\nГрафік черги ${esc(group)} не діє — світло можуть вимкнути будь-коли.`); out.push("emergency"); }
          else if (d.slots.length || d.status === "ScheduleApplies") {
            if (prev === undefined || /WaitingForSchedule/.test(prev)) { if (d.date > today) { await notify(`📅 <b>Графік на ${dayLbl(d.date)}</b> · черга ${esc(group)}\n${slotsText(d)}`); out.push("new"); } }
            else { await notify(`🔄 <b>Графік на ${dayLbl(d.date)} змінився</b> · черга ${esc(group)}\n${slotsText(d)}`); out.push("changed"); }
          }
        }
        sigs[d.date] = sig;
      }
      for (const k of Object.keys(sigs)) if (k < numDay(dayNum(today) - 2)) delete sigs[k];
      await setSetting("dtek_sigs", JSON.stringify(sigs));
      await setSetting("dtek_sched", JSON.stringify(fresh));
      sc = fresh;
    } catch (e) {
      await setSetting("dtek_err", `${local().hm} ${e instanceof Error ? e.message : e}`);
      if (!sc) return out;
    }
  }
  // попередження перед відключенням
  const before = Number(s.dtek_before ?? 30);
  if (s.dtek_notify !== "0" && before > 0 && sc) {
    let sent: string[] = []; try { sent = JSON.parse(s.dtek_warned || "[]"); } catch { /* */ }
    const [open] = await sql`select 1 from energy.outages where ended_at is null limit 1`;
    for (const iv of offIntervals(sc)) {
      const left = (iv.a - nowMs()) / 60000, key = String(iv.a);
      if (left <= 0 || left > before || sent.includes(key)) continue;
      sent.push(key);
      if (open) continue; // світла й так немає
      const need = (iv.b - iv.a) / 60000;
      const fc = await battForecast();
      await notify([`⏰ <b>Через ${fmtDur(left)} — відключення</b> (черга ${esc(group)})`, `🕯 ${local(iv.a).hm}–${local(iv.b).hm}, ${fmtDur(need)} без світла`,
        fc ? `🔋 АКБ ${fc.soc}%${fc.load_w ? ` · ~${fc.load_w} Вт` : ""}` : "", verdict(fc, need),
        "Встигніть: зарядити телефони й павербанки, набрати воду, увімкнути пральку чи бойлер."].filter(Boolean).join("\n"), "dtek_warn");
      out.push("warn");
    }
    await setSetting("dtek_warned", JSON.stringify(sent.slice(-20)));
  }
  return out;
}
export async function dtekInfo() {
  const sc = cachedSched();
  const now = nowMs();
  const ivs = sc ? offIntervals(sc) : [];
  const cur = ivs.find((x) => x.a <= now && x.b > now) || null, next = ivs.find((x) => x.a > now) || null;
  let fc = null; try { fc = await battForecast(); } catch { /* */ }
  return {
    group: S.dtek_group || "", groups: sc?.groups ?? [], days: sc?.days ?? [], updated: sc?.updated ?? "", src: sc?.src ?? "", at: Number(S.dtek_at || 0), error: S.dtek_err || "",
    current: cur, next, forecast: fc, status_ua: STATUS_UA,
  };
}

const pub = (s: Record<string, string>) => ({ dtek_area: AREAS[s.dtek_area] ? s.dtek_area : "kyiv", areas: AREAS, dtek_group: s.dtek_group || "", dtek_notify: s.dtek_notify !== "0", dtek_before: Number(s.dtek_before ?? 30), batt_reserve: Number(s.batt_reserve || 10), batt_kwh: s.batt_kwh ? Number(s.batt_kwh) : null });
class ApiError extends Error {}
async function act(action: string, b: Record<string, any>, me: { role: string }) {
  await settings(true);
  if (action === "dtek") {
    if (b.refresh) await dtekTick(true);
    const info = await dtekInfo();
    if (!info.groups.length || (cachedSched()?.area ?? "kyiv") !== area()) { try { info.groups = (await loadSched("1.1")).groups; } catch { /* */ } }
    return { ...info, settings: pub(S) };
  }
  if (action === "dtek_save") {
    if (me.role !== "admin") throw new ApiError("Лише для адміністратора");
    const v = b.settings ?? {};
    const num = (x: unknown, lo: number, hi: number) => { const n = Number(x); if (!(n >= lo && n <= hi)) throw new ApiError("Перевірте числа"); return String(n); };
    if (v.dtek_notify != null) await setSetting("dtek_notify", v.dtek_notify ? "1" : "0");
    if (v.dtek_before != null) await setSetting("dtek_before", num(v.dtek_before, 0, 240));
    if (v.batt_reserve != null) await setSetting("batt_reserve", num(v.batt_reserve, 0, 60));
    if (v.dtek_area != null && AREAS[v.dtek_area] && v.dtek_area !== area()) {
      await setSetting("dtek_area", v.dtek_area); await setSetting("dtek_warned", "[]"); await setSetting("dtek_sigs", "{}");
      if (S.dtek_group) await dtekTick(true).catch(() => {});
    }
    if (v.dtek_group != null) {
      const g = String(v.dtek_group).trim();
      if (g && !/^\d{1,2}\.\d$/.test(g)) throw new ApiError("Невірна черга — формат як 3.1");
      if (g !== (S.dtek_group || "")) { await setSetting("dtek_group", g); await setSetting("dtek_warned", "[]"); if (g) await dtekTick(true).catch(() => {}); }
    }
    return { settings: pub(await settings(true)) };
  }
  throw new ApiError("Невідома дія");
}
export async function tick() { await settings(true); return await dtekTick(); }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const s = await settings();
  if (url.searchParams.has("tick")) {
    if (!s.secret || url.searchParams.get("tick") !== s.secret) return new Response("forbidden", { status: 403 });
    return json({ ok: true, events: await tick() });
  }
  if (req.method !== "POST") return json({ ok: true, service: "svit-dtek" });
  const me = await checkToken((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!me) return json({ ok: false, error: "auth" }, 401);
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "Невірний запит" }, 400); }
  try { return json({ ok: true, ...(await act(String(b.action || ""), b, me as any)) }); }
  catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.message }, 400);
    console.error(e); return json({ ok: false, error: "Помилка сервера" }, 500);
  }
}
if (!env("DTEK_TEST")) Deno.serve(handler);
