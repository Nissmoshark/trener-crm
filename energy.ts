// Енергомонітор: інвертор у хмарі SmartESS/DessMonitor → відключення, енергія, вартість.
//   POST {action,...}     — API для додатку (Authorization: Bearer <token>)
//   POST ?tg=<secret>     — webhook Telegram-бота
//   POST ?tick=<secret>   — cron щохвилини: опитати інвертор, зафіксувати відключення
//   GET  ?setup=<secret>  — встановити webhook і команди бота
// «Світлиця»: сім'я (вхід за номером телефону й паролем), покупки, події з нагадуваннями, справи «коли дадуть світло»
import { Bot, Context, InlineKeyboard, webhookCallback } from "npm:grammy@1.30.0";
import postgres from "npm:postgres@3.4.5";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const TZ = env("ENERGY_TZ", "Europe/Kyiv");

export const sql = postgres(env("SUPABASE_DB_URL"), {
  prepare: false,
  max: 3,
  types: {
    bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
  },
});

// ───────────── Налаштування ─────────────
let S: Record<string, string> = {};
export const _setS = (o: Record<string, string>) => { S = o; };
let sAt = 0;
async function settings(force = false) {
  if (force || Date.now() - sAt > 15_000) {
    const rows = await sql`select key, value from energy.settings`;
    S = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
    sAt = Date.now();
  }
  return S;
}
async function setSetting(k: string, v: string) {
  await sql`insert into energy.settings(key,value) values(${k},${v}) on conflict(key) do update set value=excluded.value`;
  S[k] = v;
}

// ───────────── Час ─────────────
export let nowMs = () => Date.now();
export function setClock(f: () => number) { nowMs = f; }
const dtf = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
export function local(ms = nowMs()) {
  const o: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(ms))) o[p.type] = p.value;
  const h = +o.hour % 24;
  return { day: `${o.year}-${o.month}-${o.day}`, hm: `${String(h).padStart(2, "0")}:${o.minute}`, min: h * 60 + +o.minute };
}
export function fmtDur(min: number) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} год${m ? ` ${m} хв` : ""}` : `${m} хв`;
}
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

// ───────────── Хмара DessMonitor / SmartESS ─────────────
const DESS_BASE = env("ENERGY_DESS_BASE", "https://api.dessmonitor.com/public/");
const COMPANY_KEY = "bnrl_frRFjEz8Mkn";
async function sha1(s: string) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// як Python quote_plus: усе, крім A-Z a-z 0-9 _ . - ~, кодується; пробіл → +
const qp = (v: string) =>
  encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");

export let dessFetch = (url: string) => fetch(url, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
export function setDessFetch(f: (url: string) => Promise<any>) { dessFetch = f; }

class DessError extends Error {}

async function dessCall(action: string, params: Record<string, string | number>, auth = false) {
  const s = await settings();
  let actionStr = `&action=${action}`;
  for (const [k, v] of Object.entries(params)) actionStr += `&${k}=${qp(String(v))}`;
  const salt = String(nowMs());
  const sign = auth
    ? await sha1(salt + (await sha1(s.dess_pass ?? "")) + actionStr)
    : await sha1(salt + s.dess_secret + s.dess_token + actionStr);
  const url = `${DESS_BASE}?sign=${sign}&salt=${salt}${auth ? "" : `&token=${s.dess_token}`}${actionStr}`;
  const j = await dessFetch(url);
  if (j.err !== 0) throw new DessError(`${j.desc || "помилка"} (${j.err})`);
  return j.dat;
}

async function dessLogin() {
  const s = await settings();
  if (!s.dess_user || !s.dess_pass) throw new DessError("Не вказано логін SmartESS");
  const d = await dessCall("authSource", {
    usr: s.dess_user, "company-key": COMPANY_KEY, source: "1",
    _app_client_: "web", _app_id_: "ha-dessmonitor", _app_version_: "2.6.0",
  }, true);
  if (!d?.token || !d?.secret) throw new DessError("Хмара не видала токен");
  await setSetting("dess_token", d.token);
  await setSetting("dess_secret", d.secret);
  await setSetting("dess_expire", String(nowMs() + (Number(d.expire) || 86400) * 1000 - 3600_000));
}

async function dessAuthed<T>(fn: () => Promise<T>): Promise<T> {
  const s = await settings();
  if (!s.dess_token || Number(s.dess_expire || 0) < nowMs()) await dessLogin();
  try { return await fn(); }
  catch (e) {
    // токен міг протухнути раніше — одна повторна спроба
    if (e instanceof DessError && /token|TOKEN|10[0-9]{2}/.test(e.message)) { await dessLogin(); return await fn(); }
    throw e;
  }
}

// Знайти інвертор: станція → збирач (Wi-Fi модуль) → пристрій
async function dessDiscover() {
  return await dessAuthed(async () => {
    const plants = (await dessCall("queryPlants", { pagesize: 50 }))?.plant ?? [];
    const found: { pn: string; sn: string; devcode: number; devaddr: number; alias: string }[] = [];
    for (const p of plants) {
      const cs = (await dessCall("webQueryCollectorsEs", { pid: p.pid, page: 0, pagesize: 50 }))?.collector ?? [];
      for (const c of cs) {
        const devs = (await dessCall("queryCollectorDevices", { pn: c.pn }))?.dev ?? [];
        for (const d of devs) found.push({ pn: c.pn, sn: d.sn, devcode: d.devcode, devaddr: d.devaddr, alias: d.devalias || c.alias || p.pname || d.sn });
      }
    }
    if (!found.length) throw new DessError("В акаунті не знайдено інверторів");
    return found;
  });
}

type Point = { title: string; val: string; unit?: string };
export type Reading = {
  grid_on: boolean; grid_v: number | null; out_v: number | null; load_w: number | null; pv_w: number | null;
  grid_w: number | null; soc: number | null; batt_v: number | null; batt_in_w: number | null; batt_out_w: number | null; mode: string | null;
};

// Розібрати точки даних (назви трохи різняться між моделями)
export function parseReading(points: Point[]): Reading {
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const p = points.find((x) => re.test(x.title.trim()));
      if (p && p.val !== "" && p.val != null && !isNaN(parseFloat(p.val))) {
        const v = parseFloat(p.val);
        return /^kw$/i.test(p.unit ?? "") ? v * 1000 : v;
      }
    }
    return null;
  };
  const text = (...res: RegExp[]) => {
    for (const re of res) { const p = points.find((x) => re.test(x.title.trim())); if (p?.val) return String(p.val); }
    return null;
  };
  const grid_v = find(/^AC Input Voltage$/i, /^Grid Voltage$/i, /^Grid voltage R$/i, /^Input Voltage$/i);
  const batt_v = find(/^Battery Voltage$/i);
  const chgA = find(/^Battery Charging Current$/i);
  const disA = find(/^Battery Discharge Current$/i);
  let batt_in_w = find(/^Battery Charging Power$/i, /^Battery Charge Power$/i);
  let batt_out_w = find(/^Battery Discharge Power$/i, /^Battery Discharging Power$/i);
  const batt_w = find(/^Battery Power$/i); // + заряд, − розряд
  if (batt_in_w == null && batt_v != null && chgA != null) batt_in_w = batt_v * chgA;
  if (batt_out_w == null && batt_v != null && disA != null) batt_out_w = batt_v * disA;
  if (batt_in_w == null && batt_w != null) batt_in_w = Math.max(0, batt_w);
  if (batt_out_w == null && batt_w != null) batt_out_w = Math.max(0, -batt_w);
  const mode = text(/^Operating mode$/i, /^Working mode$/i, /^Work Mode$/i, /^Operation mode$/i, /Mode$/i);
  let grid_on = grid_v != null ? grid_v > 150 : false;
  if (grid_v == null && mode) grid_on = /line|grid|mains|bypass/i.test(mode) && !/off.?grid|battery/i.test(mode);
  return {
    grid_on, grid_v, batt_v, batt_in_w, batt_out_w, mode,
    out_v: find(/^Output Voltage$/i, /^AC Output Voltage$/i),
    load_w: find(/^AC Output Active Power$/i, /^Output Active Power$/i, /^Total Output Active Power$/i, /^Load Power$/i),
    pv_w: find(/^PV Input Power$/i, /^Total PV Power$/i, /^PV Power$/i, /^PV total Power$/i, /^PV Charging Power$/i, /^PV1 Input Power$/i),
    grid_w: find(/^Grid Power$/i, /^AC Input Power$/i, /^AC Input Active Power$/i, /^Grid Active Power$/i),
    soc: find(/^Battery Capacity$/i, /^Battery SOC$/i, /^SOC$/i),
  };
}

async function dessRead(): Promise<Reading> {
  const s = await settings();
  if (!s.dess_pn) {
    const devs = await dessDiscover();
    const d = devs[0];
    await setSetting("dess_pn", d.pn); await setSetting("dess_sn", d.sn);
    await setSetting("dess_devcode", String(d.devcode)); await setSetting("dess_devaddr", String(d.devaddr));
    await setSetting("dess_alias", d.alias);
  }
  const dat = await dessAuthed(() =>
    dessCall("queryDeviceLastData", { pn: S.dess_pn, devcode: S.dess_devcode, devaddr: S.dess_devaddr, sn: S.dess_sn, i18n: "en" })
  );
  if (!Array.isArray(dat)) throw new DessError("Хмара не повернула дані");
  await setSetting("last_points", JSON.stringify(dat.map((p: Point) => [p.title, p.val, p.unit ?? ""])));
  return parseReading(dat);
}

// ───────────── Облік ─────────────
function tariffAt(ms: number) {
  const s = S, day = Number(s.tariff_day || 4.32);
  if (s.tariff_zones !== "1") return day;
  const m = local(ms).min, f = toMin(s.night_from || "23:00"), t = toMin(s.night_to || "07:00");
  const night = f > t ? m >= f || m < t : m >= f && m < t;
  return night ? Number(s.tariff_night || day / 2) : day;
}

// Зміна заряду АКБ: «+35% (+1,8 кВт·год)» / «−42% (−2,1 кВт·год)»
function socDelta(from: number | null, to: number | null) {
  if (from == null || to == null) return "";
  const d = Math.round(to - from);
  const kwh = S.batt_kwh ? ` (${d >= 0 ? "+" : "−"}${(Math.abs(d) / 100 * Number(S.batt_kwh)).toFixed(1).replace(".", ",")} кВт·год)` : "";
  return `${d >= 0 ? "+" : "−"}${Math.abs(d)}%${kwh}`;
}
// Графік ДТЕК (заповнює svit-dtek): коли дадуть світло / коли наступне відключення
function schedIvs(): { a: number; b: number }[] {
  try { return S.dtek_group ? JSON.parse(S.dtek_iv || "[]") : []; } catch { return []; }
}
function whenTxt(ms: number, from: number) {
  const d = local(ms).day, t = local(from).day, tm = local(from + 86400000).day;
  return `${local(ms).hm}${d === t ? "" : d === tm ? " завтра" : ` ${d.slice(8)}.${d.slice(5, 7)}`}`;
}
function emergencyNow(ts: number) {
  try { const sc = JSON.parse(S.dtek_sched || "null"); return !!sc?.days?.some((d: any) => d.date === local(ts).day && d.status === "EmergencyShutdowns"); } catch { return false; }
}
function rangeTxt(a: number, b: number, from: number) {
  const A = whenTxt(a, from), B = whenTxt(b, from), sa = A.slice(5), sb = B.slice(5);
  return sa && sa === sb ? `${A.slice(0, 5)}–${B.slice(0, 5)}${sa}` : `${A}–${B}`;
}
// «Світла немає»: коли воно буде за графіком
export function powerBackHint(ts = nowMs()) {
  if (!S.dtek_group) return "";
  if (emergencyNow(ts)) return "🚨 Екстрені відключення — коли дадуть світло, невідомо";
  const iv = schedIvs().find((x) => x.a - 45 * 60000 <= ts && ts < x.b);
  if (iv) return `⏳ За графіком світло буде о <b>${whenTxt(iv.b, ts)}</b> (через ${fmtDur((iv.b - ts) / 60000)})`;
  const next = schedIvs().find((x) => x.a > ts);
  return `⚠️ Відключення поза графіком (черга ${S.dtek_group}) — час увімкнення невідомий${next ? `\nНаступне за графіком: ${rangeTxt(next.a, next.b, ts)}` : ""}`;
}
// «Світло є»: наступне відключення за графіком
export function nextOffHint(ts = nowMs()) {
  if (!S.dtek_group) return "";
  const next = schedIvs().find((x) => x.a > ts);
  return next ? `📅 Наступне відключення: ${rangeTxt(next.a, next.b, ts)} (через ${fmtDur((next.a - ts) / 60000)})` : "📅 Відключень за графіком найближчим часом немає";
}
export async function recordReading(r: Reading, ts = nowMs()) {
  await settings();
  const [prev] = await sql`select * from energy.samples order by ts desc limit 1`;
  await sql`insert into energy.samples ${sql({ ts: new Date(ts), ...r })} on conflict (ts) do nothing`;
  const events: string[] = [];
  // Енергія за інтервал (не довше 15 хв, щоб не рахувати пропуски зв'язку)
  if (prev) {
    const dtH = Math.min(15, (ts - new Date(prev.ts).getTime()) / 60000) / 60;
    if (dtH > 0) {
      const avg = (a: number | null, b: number | null) => ((a ?? b ?? 0) + (b ?? a ?? 0)) / 2;
      const load = avg(prev.load_w, r.load_w), pv = avg(prev.pv_w, r.pv_w);
      const bIn = avg(prev.batt_in_w, r.batt_in_w), bOut = avg(prev.batt_out_w, r.batt_out_w);
      let grid = 0, est = false;
      if (r.grid_w != null || prev.grid_w != null) grid = Math.max(0, avg(prev.grid_w, r.grid_w));
      else if (r.grid_on && prev.grid_on) { grid = Math.max(0, load + bIn - pv - bOut); est = true; }
      const kwh = (w: number) => (w * dtH) / 1000;
      const day = local(ts).day;
      const outageMin = !r.grid_on && !prev.grid_on ? dtH * 60 : 0;
      await sql`insert into energy.daily(day, grid_kwh, grid_cost, load_kwh, pv_kwh, batt_in_kwh, batt_out_kwh, outage_min, grid_estimated)
        values(${day}, ${kwh(grid)}, ${kwh(grid) * tariffAt(ts)}, ${kwh(load)}, ${kwh(pv)}, ${kwh(bIn)}, ${kwh(bOut)}, ${outageMin}, ${est})
        on conflict (day) do update set grid_kwh=energy.daily.grid_kwh+excluded.grid_kwh, grid_cost=energy.daily.grid_cost+excluded.grid_cost,
          load_kwh=energy.daily.load_kwh+excluded.load_kwh, pv_kwh=energy.daily.pv_kwh+excluded.pv_kwh,
          batt_in_kwh=energy.daily.batt_in_kwh+excluded.batt_in_kwh, batt_out_kwh=energy.daily.batt_out_kwh+excluded.batt_out_kwh,
          outage_min=energy.daily.outage_min+excluded.outage_min, grid_estimated=energy.daily.grid_estimated or excluded.grid_estimated`;
    }
  }
  // Відключення
  const [open] = await sql`select * from energy.outages where ended_at is null order by started_at desc limit 1`;
  const lowSoc = Number(S.low_soc || 25);
  if (!r.grid_on && !open) {
    const [prevOut] = await sql`select ended_at, soc_end from energy.outages where ended_at is not null order by ended_at desc limit 1`;
    const [o] = await sql`insert into energy.outages(started_at, soc_start, soc_min) values(${new Date(ts)}, ${r.soc}, ${r.soc}) returning *`;
    events.push("off");
    const onMin = prevOut ? (ts - new Date(prevOut.ended_at).getTime()) / 60000 : null;
    const ch = prevOut ? socDelta(prevOut.soc_end, r.soc) : "";
    await notifyReplace("power", [`🕯 <b>Світла немає</b> з ${local(ts).hm}`,
      powerBackHint(ts),
      onMin != null ? `До цього світло було ${fmtDur(onMin)}` : "",
      r.soc != null ? `🔋 АКБ ${Math.round(r.soc)}%${ch ? ` · за час зі світлом ${ch}` : ""}` : "",
      r.load_w != null ? `🏠 Навантаження ${Math.round(r.load_w)} Вт` : ""].filter(Boolean).join("\n"), ["low", "dtek_warn"]);
    if (r.soc != null && r.soc <= lowSoc) { await sql`update energy.outages set low_notified=true where id=${o.id}`; }
  } else if (!r.grid_on && open) {
    if (r.soc != null) await sql`update energy.outages set soc_min=least(coalesce(soc_min, ${r.soc}), ${r.soc}) where id=${open.id}`;
    if (r.soc != null && r.soc <= lowSoc && !open.low_notified) {
      await sql`update energy.outages set low_notified=true where id=${open.id}`;
      const rate = r.load_w ? ` При навантаженні ${Math.round(r.load_w)} Вт.` : "";
      await notifyReplace("low", `🪫 <b>АКБ ${Math.round(r.soc)}%</b>, світла немає вже ${fmtDur((ts - new Date(open.started_at).getTime()) / 60000)}.${rate}${powerBackHint(ts) ? "\n" + powerBackHint(ts) : ""}`);
      events.push("low");
    }
  } else if (r.grid_on && open) {
    await sql`update energy.outages set ended_at=${new Date(ts)}, soc_end=${r.soc} where id=${open.id}`;
    const dur = (ts - new Date(open.started_at).getTime()) / 60000;
    const ch = socDelta(open.soc_start, r.soc);
    const minSoc = open.soc_min != null && r.soc != null ? Math.round(Math.min(open.soc_min, r.soc)) : null;
    await notifyReplace("power", [`💡 <b>Світло є</b> з ${local(ts).hm}`, `Відключення тривало ${fmtDur(dur)}`,
      r.soc != null ? `🔋 АКБ ${Math.round(r.soc)}%${ch ? ` · за відключення ${ch}` : ""}${minSoc != null && minSoc < Math.round(r.soc) ? ` · мінімум ${minSoc}%` : ""}` : "",
      nextOffHint(ts)].filter(Boolean).join("\n"), ["low", "dtek_warn"]);
    events.push("on");
    await powerTasksFire(ts);
  }
  return events;
}

// ───────────── Повітряні тривоги (alerts.in.ua) ─────────────
export const REGIONS = ["АР Крим", "Волинська обл.", "Вінницька обл.", "Дніпропетровська обл.", "Донецька обл.", "Житомирська обл.",
  "Закарпатська обл.", "Запорізька обл.", "Івано-Франківська обл.", "м. Київ", "Київська обл.", "Кіровоградська обл.", "Луганська обл.",
  "Львівська обл.", "Миколаївська обл.", "Одеська обл.", "Полтавська обл.", "Рівненська обл.", "м. Севастополь", "Сумська обл.",
  "Тернопільська обл.", "Харківська обл.", "Херсонська обл.", "Хмельницька обл.", "Черкаська обл.", "Чернівецька обл.", "Чернігівська обл."];
export let alertsFetch = async (token: string): Promise<unknown> => {
  const r = await fetch("https://api.alerts.in.ua/v2/iot/active_air_raid_alerts_by_oblast.json", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 401) throw new Error("невірний токен alerts.in.ua");
  if (r.status === 429) throw new Error("забагато запитів до alerts.in.ua");
  if (!r.ok) throw new Error(`alerts.in.ua: HTTP ${r.status}`);
  return r.json();
};
export function setAlertsFetch(f: (t: string) => Promise<unknown>) { alertsFetch = f; }
const isActive = (c: string) => c === "A" || c === "R" || c === "Y";

// ── Без токена: дані «Повітряної тривоги» (Ukraine Alarm) через публічну обгортку siren.pp.ua ──
export let sirenGet = async (path: string): Promise<any> => {
  const r = await fetch("https://siren.pp.ua/api/v3/" + path, {
    headers: { Accept: "application/json", "User-Agent": "svitlytsia-family-app/1.0" }, signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`siren.pp.ua: HTTP ${r.status}`);
  return r.json();
};
export function setSirenGet(f: (p: string) => Promise<any>) { sirenGet = f; }
let sirenMap: Record<string, [string, string | null]> | null = null;
async function sirenRegions() {
  if (sirenMap) return sirenMap;
  const [c] = await sql`select area, at from energy.geo_cache where key='siren:regions'`;
  if (c && nowMs() - new Date(c.at).getTime() < 7 * 86400000) return (sirenMap = c.area as Record<string, [string, string | null]>);
  const j = await sirenGet("regions");
  const map: Record<string, [string, string | null]> = {};
  for (const st of j.states ?? []) {
    map[st.regionId] = [st.regionName, null];
    for (const d of st.regionChildIds ?? []) {
      map[d.regionId] = [st.regionName, d.regionType === "District" ? d.regionName : null];
      for (const h of d.regionChildIds ?? []) map[h.regionId] = [st.regionName, d.regionType === "District" ? d.regionName : null];
    }
  }
  await sql`insert into energy.geo_cache(key, area, at) values('siren:regions', ${sql.json(map)}, ${new Date(nowMs())})
    on conflict (key) do update set area=excluded.area, at=excluded.at`;
  return (sirenMap = map);
}
const SIREN_KIND: Record<string, string> = { AIR: "air_raid", ARTILLERY: "artillery_shelling", URBAN_FIGHTS: "urban_fights", CHEMICAL: "chemical", NUCLEAR: "nuclear" };
const regKey = (n: string) => n === "АР Крим" ? "автономна" : n.toLowerCase().replace(/^м\.\s*/, "").split(/[\s,]+/)[0];
export async function sirenState() {
  const [map, raw] = await Promise.all([sirenRegions(), sirenGet("alerts")]);
  const list: AA[] = [];
  for (const r of raw as any[]) for (const a of r.activeAlerts ?? []) {
    const lv = a.activeAlertLevels?.[0], par = map[r.regionId];
    list.push({
      t: r.regionName, uid: String(r.regionId),
      type: r.regionType === "State" ? (String(r.regionId) === "31" ? "city" : "oblast") : r.regionType === "District" ? "raion" : "hromada",
      obl: r.regionType === "State" ? r.regionName : par?.[0] ?? "", raion: r.regionType === "District" ? r.regionName : par?.[1] ?? null,
      at: lv?.createdAt ?? a.lastUpdate, lvl: lv?.alertLevel === "Yellow" ? "yellow" : "red", kind: SIREN_KIND[a.type] ?? "unknown", th: [],
    });
  }
  const air = list.filter((x) => x.kind === "air_raid");
  const str = REGIONS.map((n) => {
    const k = regKey(n), mine = air.filter((x) => regKey(x.obl) === k);
    const whole = mine.find((x) => x.type === "oblast" || x.type === "city");
    return whole ? (whole.lvl === "yellow" ? "Y" : "A") : mine.length ? "P" : "N";
  }).join("");
  return { str, list };
}

export async function alertsTick(): Promise<string | null> {
  const s = S;
  try {
    let str: string;
    if (!s.alerts_token) {
      const r = await sirenState();
      str = r.str;
      await setSetting("alerts_state", str); await setSetting("alerts_at", String(nowMs()));
      await setSetting("alerts_list", JSON.stringify(r.list));
      if (s.alerts_src !== "siren") await setSetting("alerts_src", "siren");
    } else {
    str = String(await alertsFetch(s.alerts_token));
    if (!/^[ARYPN]{27}$/.test(str)) throw new Error("незрозумілий формат відповіді");
    await setSetting("alerts_state", str); await setSetting("alerts_at", String(nowMs()));
    if (s.alerts_src !== "alerts.in.ua") await setSetting("alerts_src", "alerts.in.ua");
    try {
      const full = await activeAlertsFetch(s.alerts_token);
      await setSetting("alerts_list", JSON.stringify(full.map((x: any) => ({
        t: x.location_title, type: x.location_type, uid: String(x.location_uid), obl: x.location_oblast, raion: x.location_raion ?? null,
        at: x.started_at, lvl: x.alert_level ?? "red", kind: x.alert_type, th: (x.threats ?? []).map((y: any) => y.threat_type),
      }))));
    } catch (e) { console.warn("active alerts", String(e)); }
    }
    if (s.alerts_error) await setSetting("alerts_error", "");
    const reg = Number(s.alerts_region ?? 9), c = str[reg], level = c === "Y" ? "yellow" : "red";
    const [open] = await sql`select * from energy.alerts where ended_at is null order by started_at desc limit 1`;
    const name = REGIONS[reg] ?? "регіон";
    const tell = s.alerts_notify !== "0";
    if (open && open.region !== reg) {
      await sql`update energy.alerts set ended_at=${new Date(nowMs())} where id=${open.id}`;
    } else if (isActive(c) && !open) {
      await sql`insert into energy.alerts(region, started_at, level) values(${reg}, ${new Date(nowMs())}, ${level})`;
      const hth = zoneStatus(homeArea(), alertsList()).threat_names;
      if (tell) await notifyReplace("alert", `${level === "yellow" ? "🟠" : "🔴"} <b>Повітряна тривога</b> · ${name} · ${local().hm}${hth.length ? `\n⚠️ ${hth.join(", ")}` : ""}`);
    } else if (!isActive(c) && open) {
      await sql`update energy.alerts set ended_at=${new Date(nowMs())} where id=${open.id}`;
      if (tell) await notifyReplace("alert", `🟢 <b>Відбій тривоги</b> · ${name}\nТривала ${fmtDur((nowMs() - new Date(open.started_at).getTime()) / 60000)}`);
    } else if (isActive(c) && open && open.level !== level) {
      await sql`update energy.alerts set level=${level} where id=${open.id}`;
    }
    try { await zonesTick(); } catch (e) { console.error("zones", e); }
    return str;
  } catch (e) {
    await setSetting("alerts_error", `${local().hm} ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function alertsInfo() {
  const s = S, reg = Number(s.alerts_region ?? 9);
  const [open] = await sql`select * from energy.alerts where ended_at is null order by started_at desc limit 1`;
  return {
    has_token: !!s.alerts_token || (s.alerts_src === "siren" && !!s.alerts_state), src: s.alerts_token ? "alerts.in.ua" : s.alerts_src === "siren" ? "siren" : "", state: s.alerts_state || "", at: Number(s.alerts_at || 0), region: reg,
    region_name: REGIONS[reg] ?? "", open: open ?? null, error: s.alerts_error || "",
  };
}

export async function tick() {
  const s = await settings(true);
  const alerts = await alertsTick();
  try { await remindersTick(); } catch (e) { console.error("reminders", e); }
  try { await shopTick(); } catch (e) { console.error("shop", e); }
  const pollMs = Math.max(1, Number(s.poll_min || 5)) * 60_000 - 20_000;
  if (!s.dess_user || nowMs() - Number(s.last_poll || 0) < pollMs) return { skipped: true, alerts };
  await setSetting("last_poll", String(nowMs()));
  try {
    const r = await dessRead();
    const ev = await recordReading(r);
    if (s.last_error) {
      await setSetting("last_error", "");
      if (s.offline_notified === "1") { await setSetting("offline_notified", "0"); await dropMsg("offline"); }
    }
    await setSetting("last_ok", String(nowMs()));
    // прибирання старих замірів
    if (Math.random() < 0.01) await sql`delete from energy.samples where ts < now() - interval '120 days'`;
    return { ok: true, events: ev, grid_on: r.grid_on, soc: r.soc };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setSetting("last_error", `${local().hm} ${msg}`);
    // 20 хв без даних — попередити один раз
    if (nowMs() - Number(s.last_ok || nowMs()) > 20 * 60_000 && s.offline_notified !== "1") {
      await setSetting("offline_notified", "1");
      await notifyReplace("offline", `⚠️ Немає даних від інвертора вже 20 хв.\nМожливо, Wi-Fi-модуль без інтернету. Помилка: ${esc(msg)}`);
    }
    return { ok: false, error: msg };
  }
}

// ───────────── Тривоги там, де зараз члени сімʼї ─────────────
// Повний список активних тривог (області, райони, громади, міста) з типами загроз
export let activeAlertsFetch = async (token: string): Promise<any[]> => {
  const r = await fetch("https://api.alerts.in.ua/v1/alerts/active.json", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`alerts.in.ua: HTTP ${r.status}`);
  return (await r.json()).alerts ?? [];
};
export function setActiveAlertsFetch(f: (t: string) => Promise<any[]>) { activeAlertsFetch = f; }
// Зворотне геокодування: координати → область / район / громада (OpenStreetMap)
export let geoFetch = async (lat: number, lon: number): Promise<any> => {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=uk&zoom=12`, {
    headers: { "User-Agent": "svitlytsia-family-app/1.0 (private family use)" }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`geocode HTTP ${r.status}`);
  return r.json();
};
export function setGeoFetch(f: (lat: number, lon: number) => Promise<any>) { geoFetch = f; }

export const THREATS: Record<string, string> = {
  drones: "дрони", ballistic_missiles: "балістика", cruise_missiles: "крилаті ракети", unspecified_missiles: "ракети",
  guided_aerial_bombs: "КАБи", mig31k_departure: "зліт МіГ-31К", tactic_aircraft_activity: "тактична авіація",
  strategic_aircraft_activity: "стратегічна авіація", air_defense: "робота ППО", unknown: "загроза",
};
const ALERT_KIND: Record<string, string> = {
  air_raid: "Повітряна тривога", artillery_shelling: "Загроза артобстрілу", urban_fights: "Вуличні бої",
  chemical: "Хімічна загроза", nuclear: "Радіаційна загроза",
};
type AA = { t: string; type: string; uid: string; obl: string; raion: string | null; at: string; lvl: string; kind: string; th: string[] };
export type Area = { label: string; oblast: string | null; raion: string | null; hromada: string | null; city: string | null; kyiv: boolean };

const firstWord = (s: string | null) => (s ?? "").toLowerCase().replace(/^м\.\s*/, "").split(/[\s,]+/)[0];
export function zoneHits(area: Area, list: AA[]) {
  return list.filter((a) =>
    (area.kyiv && (a.uid === "31" || a.t === "м. Київ")) ||
    (!area.kyiv && !!area.oblast && a.type === "oblast" && a.obl === area.oblast) ||
    (!!area.raion && a.type === "raion" && a.t === area.raion) ||
    (!!area.hromada && a.type === "hromada" && a.obl === area.oblast && firstWord(a.t) === firstWord(area.hromada)) ||
    (!area.kyiv && !!area.city && a.type === "city" && firstWord(a.t) === firstWord(area.city))
  );
}
export function zoneStatus(area: Area, list: AA[]) {
  const hits = zoneHits(area, list);
  const near = area.kyiv ? [] : list.filter((a) => a.obl === area.oblast && !hits.includes(a)).length;
  const threats = [...new Set(hits.flatMap((h) => h.th))];
  return {
    active: hits.length > 0, red: hits.some((h) => h.lvl !== "yellow"),
    kinds: [...new Set(hits.map((h) => ALERT_KIND[h.kind] ?? "Тривога"))], threats,
    threat_names: threats.map((x) => THREATS[x] ?? x), since: hits.length ? hits.map((h) => h.at).sort()[0] : null,
    near, uids: hits.map((h) => h.uid).sort().join(","),
  };
}
const homeArea = (): Area => {
  const reg = Number(S.alerts_region ?? 9), name = REGIONS[reg] ?? "м. Київ";
  return reg === 9 ? { kyiv: true, label: "Київ", oblast: "м. Київ", raion: null, hromada: null, city: "Київ" }
    : { kyiv: false, label: name, oblast: name.replace("обл.", "область"), raion: null, hromada: null, city: null };
};
const alertsList = (): AA[] => { try { return JSON.parse(S.alerts_list || "[]"); } catch { return []; } };
export const placeLabel = (a: Area) => a.kyiv ? "Київ" : [a.label, a.hromada && !a.hromada.startsWith(a.label) ? a.hromada.replace(" територіальна", "").replace(" громада", " гр.") : null, a.raion].filter(Boolean).join(" · ");

export async function areaOf(lat: number, lon: number): Promise<Area | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const [c] = await sql`select area from energy.geo_cache where key=${key}`;
  if (c) return c.area as Area;
  let j;
  try { j = await geoFetch(lat, lon); } catch { return null; }
  const a = j?.address ?? {};
  if (!a.state && !a.city) return null;
  const kyiv = a.city === "Київ" || a["ISO3166-2-lvl4"] === "UA-30";
  const area: Area = {
    kyiv, oblast: kyiv ? "м. Київ" : a.state ?? null, raion: a.district ?? a.county ?? null, hromada: a.municipality ?? null,
    city: a.city ?? a.town ?? null, label: kyiv ? "Київ" : a.village || a.town || a.city || a.hamlet || a.suburb || a.municipality || a.district || a.state || "",
  };
  await sql`insert into energy.geo_cache(key, area) values(${key}, ${sql.json(area)}) on conflict (key) do nothing`;
  return area;
}
// Оновити, де зараз член сімʼї (з додатку або з живої геопозиції Telegram)
export async function setMemberArea(memberId: number, lat: number, lon: number, src: string) {
  const [m] = await sql`select area_lat, area_lon, area_at, area from energy.members where id=${memberId}`;
  if (!m) return null;
  const moved = m.area_lat == null || Math.hypot((lat - m.area_lat) * 111, (lon - m.area_lon) * 71) > 0.8;
  const stale = !m.area_at || nowMs() - new Date(m.area_at).getTime() > 30 * 60000;
  if (!moved && !stale && m.area) {
    await sql`update energy.members set area_at=${new Date(nowMs())}, area_src=${src} where id=${memberId}`;
    return m.area as Area;
  }
  const area = await areaOf(lat, lon);
  if (!area) return null;
  await sql`update energy.members set area=${sql.json(area)}, area_lat=${lat}, area_lon=${lon}, area_at=${new Date(nowMs())}, area_src=${src} where id=${memberId}`;
  await zonesTick(); // одразу перевірити тривогу на новому місці
  return area;
}

// Сповіщення: тривога / відбій / нова загроза там, де зараз хтось із сімʼї
export async function zonesTick() {
  const list = alertsList();
  if (!S.alerts_list || !S.alerts_state) return;
  let state: Record<string, { a: boolean; th: string[] }> = {};
  try { state = JSON.parse(S.zone_state || "{}"); } catch { /* */ }
  const tell = S.alerts_notify !== "0", home = homeArea(), hs = zoneStatus(home, list), next: typeof state = {};
  // дім: лише нові загрози під час тривоги (саму тривогу й відбій повідомляє alertsTick)
  const ph = state.home ?? { a: false, th: [] };
  const newTh = hs.threats.filter((x) => !ph.th.includes(x));
  if (hs.active && ph.a && newTh.length && tell) await notifyReplace("alert_th", `⚠️ <b>Нова загроза</b> · ${esc(home.label)}: ${newTh.map((x) => THREATS[x] ?? x).join(", ")}`);
  next.home = { a: hs.active, th: hs.threats };
  const ms = await sql`select id, name, area, area_at from energy.members where active and area is not null and area_at > ${new Date(nowMs() - 12 * 3600000)}`;
  // групуємо членів сімʼї за однаковими тривожними зонами, щоб не дублювати
  const groups = new Map<string, { names: string[]; area: Area; st: ReturnType<typeof zoneStatus> }>();
  for (const m of ms) {
    const area = m.area as Area, st = zoneStatus(area, list);
    const key = area.kyiv ? "kyiv" : `${area.oblast}|${area.raion}|${area.hromada}`;
    if (st.active && st.uids === hs.uids) continue; // там само, як удома — вже повідомлено
    const g = groups.get(key) ?? { names: [], area, st };
    g.names.push(m.name); groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const prev = state["z:" + key] ?? { a: false, th: [] };
    const who = g.names.join(", "), where = placeLabel(g.area);
    if (g.st.active && !prev.a && tell) {
      await notifyReplace("zone_" + key, `${g.st.red ? "🔴" : "🟠"} <b>${g.st.kinds[0] ?? "Тривога"}</b> там, де зараз <b>${esc(who)}</b>\n📍 ${esc(where)}${g.st.threat_names.length ? `\n⚠️ ${g.st.threat_names.join(", ")}` : ""}`);
    } else if (!g.st.active && prev.a && tell) {
      await notifyReplace("zone_" + key, `🟢 <b>Відбій</b> там, де зараз <b>${esc(who)}</b> · ${esc(where)}`);
    } else if (g.st.active && prev.a && tell) {
      const nt = g.st.threats.filter((x) => !prev.th.includes(x));
      if (nt.length) await notifyReplace("zone_th_" + key, `⚠️ <b>Нова загроза</b> там, де ${esc(who)} (${esc(where)}): ${nt.map((x) => THREATS[x] ?? x).join(", ")}`);
    }
    next["z:" + key] = { a: g.st.active, th: g.st.threats };
  }
  await setSetting("zone_state", JSON.stringify(next));
}

async function zonesInfo(me: Member) {
  const list = alertsList(), home = homeArea();
  const ms = await sql`select id, name, area, area_at, area_src from energy.members where active order by id`;
  const fam = ms.map((m) => {
    const fresh = m.area && m.area_at && nowMs() - new Date(m.area_at).getTime() < 12 * 3600000;
    return { id: m.id, name: m.name, me: m.id === me.id, place: fresh ? placeLabel(m.area as Area) : null, at: m.area_at, src: m.area_src, status: fresh ? zoneStatus(m.area as Area, list) : null };
  });
  return { home: { label: home.label, status: zoneStatus(home, list) }, family: fam };
}

// ───────────── Сім'я: покупки, події, «коли дадуть світло» ─────────────
// Відділи магазину за ключовими словами (порядок має значення)
const CATS: [string, RegExp][] = [
  ["Побутове", /папір|серветк|мило|шампун|гель для|порош|засіб|губк|пакет|фольг|плівк|батарейк|зубн|прокладк|підгуз|туалетн|відбілюв|кондиціонер для|лампочк|свічк|сірник|запальничк/],
  ["Аптека", /таблет|вітамін|пластир|бинт|ліки|краплі|сироп|термометр|аптек|маск/],
  ["Солодке й снеки", /шоколад|цукерк|печив|торт|тістеч|чипс|горіх|морозив|вафл|снек|зефір|мармелад|халв|сухарики/],
  ["Молочне й яйця", /молок|кефір|сир|сметан|йогурт|вершк|ряжан|творог|бринз|масло вершк|вершкове|яйц|яєць/],
  ["Хліб", /хліб|батон|булк|лаваш|багет|сухар|паляниц|бублик|круасан/],
  ["М'ясо й риба", /м'яс|мяс|м’яс|курк|кур[яи]|філе|фарш|свинин|ялович|телятин|ковбас|сосиск|сардельк|шинк|бекон|сало|риб|оселед|лосос|скумбр|креветк|печінк|індич|крил|стегн|гомілк/],
  ["Овочі й фрукти", /картопл|цибул|морк|буряк|капуст|помідор|томат|огір|перец|перц|часник|яблу|банан|апельсин|лимон|груш|виногр|ківі|зелен|кріп|петруш|салат|гриб|печериц|кабач|баклаж|мандарин|ягод|авокад|гарбуз|редис|броколі|шпинат|імбир|слив|персик|кавун|диня|полуниц/],
  ["Напої", /вод[аиу]|сік|соки|пиво|вино|вина|лимонад|кола|мінерал|компот|узвар|енергетик/],
  ["Бакалія", /круп|гречк|рис|макарон|спагет|вермішел|борошн|цукор|сіль|солі|олі[яї]|кав[аиу]|чай|вівсян|пластівц|консерв|горох|квасол|сочевиц|спеці|перець мелен|соус|кетчуп|майонез|гірчиц|мед|варення|джем|оцет|дріжд|розпушув|ванілін|какао|паштет|тушонк|кукурудз|оливк|маслин/],
];
export const catOf = (name: string) => {
  const n = name.toLowerCase();
  for (const [c, re] of CATS) if (re.test(n)) return c;
  return "Інше";
};
export const splitItems = (text: string) =>
  text.split(/[\n,;]+/).map((x) => x.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "").trim().replace(/\s+/g, " "))
    .filter((x) => x.length >= 1 && x.length <= 80).slice(0, 40);

async function shopAdd(names: string[], by: { id?: number | null; name: string }, notified = false) {
  const open = await sql`select lower(name) n from energy.shop_items where bought_at is null and not cleared`;
  const have = new Set(open.map((r) => r.n));
  const added: string[] = [];
  for (const raw of names) {
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    await sql`insert into energy.shop_items(name, cat, added_by, added_name, added_at, add_notified)
      values(${name}, ${catOf(name)}, ${by.id ?? null}, ${by.name}, ${new Date(nowMs())}, ${notified})`;
    added.push(name);
  }
  return added;
}

// Дати в місцевому часі
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const numDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export function localToMs(day: string, hm: string) {
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
type Ev = { id: number; title: string; notes: string; day: string; tm: string | null; rep: string; remind: number[]; who: number | null };
// Дні повторів події між fromDay і toDay включно
export function occDays(ev: Ev, fromDay: string, toDay: string) {
  const out: string[] = [];
  const base = ev.day, push = (d: string) => { if (d >= base && d >= fromDay && d <= toDay) out.push(d); };
  if (toDay < base) return out;
  if (ev.rep === "none") push(base);
  else if (ev.rep === "weekly") {
    const k = Math.max(0, Math.floor((dayNum(fromDay) - dayNum(base)) / 7));
    for (let n = dayNum(base) + k * 7; n <= dayNum(toDay); n += 7) push(numDay(n));
  } else {
    const bd = +base.slice(8, 10), bm = +base.slice(5, 7);
    let y = +fromDay.slice(0, 4), m = +fromDay.slice(5, 7);
    while (`${y}-${String(m).padStart(2, "0")}` <= toDay.slice(0, 7)) {
      if (ev.rep === "monthly" || m === bm) {
        const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        push(`${y}-${String(m).padStart(2, "0")}-${String(Math.min(bd, dim)).padStart(2, "0")}`);
      }
      if (++m > 12) { m = 1; y++; }
    }
  }
  return out;
}
const evTime = (ev: Ev) => ev.tm || "09:00";
export function occurrences(ev: Ev, aMs: number, bMs: number) {
  const f = numDay(dayNum(local(aMs).day) - 1), t = numDay(dayNum(local(bMs).day) + 1);
  return occDays(ev, f, t).map((d) => ({ day: d, ms: localToMs(d, evTime(ev)) })).filter((o) => o.ms >= aMs && o.ms < bMs);
}

async function memberNames() {
  const rows = await sql`select id, name from energy.members`;
  return Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<number, string>;
}
const offLabel = (m: number) => m >= 10080 ? "за тиждень" : m >= 2880 ? `за ${m / 1440} дні` : m >= 1440 ? "за день" : m >= 120 ? `за ${m / 60} год` : m >= 60 ? "за годину" : `за ${m} хв`;
function whenLabel(day: string, tm: string | null) {
  const td = local().day, diff = dayNum(day) - dayNum(td);
  const d = diff === 0 ? "сьогодні" : diff === 1 ? "завтра" : `${+day.slice(8, 10)}.${day.slice(5, 7)}`;
  return tm ? `${d} о ${tm}` : d;
}

export async function remindersTick() {
  const now = nowMs(), last = Number(S.ev_last || 0);
  await setSetting("ev_last", String(now));
  if (!last) return 0;
  const from = Math.max(last, now - 30 * 60000); // після простою не засипаємо старими нагадуваннями
  const evs = (await sql`select * from energy.events`) as unknown as Ev[];
  if (!evs.length) return 0;
  const names = await memberNames();
  let n = 0;
  for (const ev of evs) {
    for (const off of ev.remind ?? []) {
      // вікно (from, now] — нагадування в точну хвилину надсилається в ту ж хвилину
      for (const o of occurrences(ev, from + off * 60000 + 1, now + off * 60000 + 1)) {
        const head = off === 0
          ? `⏰ <b>${esc(ev.title)}</b>${ev.tm ? ` · зараз, ${ev.tm}` : " · сьогодні"}`
          : `🔔 <b>${esc(ev.title)}</b> · ${whenLabel(o.day, ev.tm)} <i>(нагадування ${offLabel(off)})</i>`;
        await notify([head, ev.who ? `👤 ${esc(names[ev.who] ?? "")}` : "", ev.notes ? esc(ev.notes) : ""].filter(Boolean).join("\n"));
        n++;
      }
    }
  }
  return n;
}

// Сповіщення про покупки пачками: коли хтось перестав додавати / відмічати на кілька хвилин
export async function shopTick() {
  const now = nowMs();
  const adds = await sql`select * from energy.shop_items where not add_notified order by added_at`;
  if (adds.length && now - Math.max(...adds.map((r) => new Date(r.added_at).getTime())) >= 2 * 60000) {
    await sql`update energy.shop_items set add_notified=true where id in ${sql(adds.map((r) => r.id))}`;
    const fresh = adds.filter((r) => !r.bought_at && !r.cleared);
    const by: Record<string, string[]> = {};
    for (const r of fresh) (by[r.added_name || "Хтось"] ??= []).push(r.name);
    const [{ n }] = await sql`select count(*)::int n from energy.shop_items where bought_at is null and not cleared`;
    for (const [who, items] of Object.entries(by)) {
      await notifyReplace("shop", `🛒 <b>${esc(who)}</b>: +${items.length} у списку покупок\n${esc(items.join(", "))}\n\nУсього купити: ${n} · /list`);
    }
  }
  const buys = await sql`select * from energy.shop_items where bought_at is not null and not buy_notified order by bought_at`;
  if (buys.length && now - Math.max(...buys.map((r) => new Date(r.bought_at).getTime())) >= 3 * 60000) {
    await sql`update energy.shop_items set buy_notified=true where id in ${sql(buys.map((r) => r.id))}`;
    const left = await sql`select name from energy.shop_items where bought_at is null and not cleared order by added_at`;
    const by: Record<string, string[]> = {};
    for (const r of buys) (by[r.bought_name || "Хтось"] ??= []).push(r.name);
    for (const [who, items] of Object.entries(by)) {
      const tail = left.length ? `Лишилось: ${left.length} (${esc(left.slice(0, 6).map((r) => r.name).join(", "))}${left.length > 6 ? "…" : ""})` : "Список закрито 🎉";
      await notifyReplace("shop", `✅ <b>${esc(who)}</b> купує: ${esc(items.join(", "))}\n${tail}`);
    }
  }
}

export async function powerTasksFire(ts = nowMs()) {
  const tasks = await sql`select * from energy.power_tasks where notified_at is null and done_at is null order by created_at`;
  if (!tasks.length) return;
  await sql`update energy.power_tasks set notified_at=${new Date(ts)} where id in ${sql(tasks.map((t) => t.id))}`;
  await notifyReplace("tasks", `🔌 <b>Світло є — час для справ:</b>\n${tasks.map((t) => `• ${esc(t.title)}`).join("\n")}`);
}

async function homeSummary() {
  const now = nowMs();
  const left = await sql`select name from energy.shop_items where bought_at is null and not cleared order by added_at`;
  const evs = (await sql`select * from energy.events`) as unknown as Ev[];
  const names = await memberNames();
  const up = evs.flatMap((ev) => occurrences(ev, now - (ev.tm ? 60 * 60000 : 9 * 3600000), now + 8 * 86400000)
    .map((o) => ({ id: ev.id, title: ev.title, day: o.day, tm: ev.tm, ms: o.ms, who: ev.who ? names[ev.who] ?? "" : "" })))
    .sort((a, b) => a.ms - b.ms).slice(0, 4);
  const power = await sql`select id, title from energy.power_tasks where notified_at is null and done_at is null order by created_at`;
  return { shop_left: left.length, shop_preview: left.slice(0, 5).map((r) => r.name), events: up, power };
}
async function homeWith(me: Member) {
  const [h, ch] = await Promise.all([homeSummary(), chargingSummary(me)]);
  return { ...h, charging: ch };
}

// ───── Зарядка ЖК: проксі до бота зарядки (charging-bot) від імені Telegram члена сімʼї ─────
export let chargingFetch = async (body: Record<string, unknown>): Promise<any> => {
  const [s] = await sql`select value from charging.settings where key='webhook_secret'`;
  if (!s?.value) throw new Error("бот зарядки не налаштований");
  const r = await fetch(`${env("SUPABASE_URL")}/functions/v1/charging-bot?api=${s.value}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  return r.json();
};
export function setChargingFetch(f: (b: Record<string, unknown>) => Promise<any>) { chargingFetch = f; }
async function myTg(me: Member) {
  const [m] = await sql`select tg_id from energy.members where id=${me.id}`;
  return m?.tg_id ? Number(m.tg_id) : null;
}
// Квартира сімʼї: перший член сімʼї, зареєстрований у боті зарядки
async function familyApartment() {
  try {
    const [u] = await sql`select c.apartment, c.entrance from energy.members m join charging.users c on c.tg_id = m.tg_id where m.active order by m.id limit 1`;
    return u ?? null;
  } catch { return null; }
}
async function chargingSummary(me: Member) {
  const tg = await myTg(me);
  if (!tg) return null;
  try {
    const j = await chargingFetch({ action: "status", tg_id: tg });
    if (!j.ok || !j.registered) return null;
    const mine = j.bookings.find((b: { mine: boolean }) => b.mine);
    return { gen_on: j.gen_on, load: j.load, limit: j.limit, mine: mine ?? null, my_queue: j.my_queue, now: j.now };
  } catch { return null; }
}

const REMIND_OK = new Set([0, 10, 30, 60, 120, 180, 1440, 2880, 10080]);
const familyActions: Record<string, (b: Record<string, any>, me: Member) => Promise<unknown>> = {
  async members(_b, me) {
    const rows = await sql`select id, name, role, created_at, phone, tg_id, pass_hash is not null has_pass from energy.members where active order by id`;
    const ms = rows.map((m) => ({
      id: m.id, name: m.name, role: m.role, created_at: m.created_at, has_tg: !!m.tg_id, has_pass: m.has_pass,
      phone: me.role === "admin" || m.id === me.id ? m.phone : maskPhone(m.phone),
    }));
    const inv = me.role === "admin"
      ? await sql`select code, kind, phone, member_id, expires_at from energy.invites where used_by is null and expires_at > ${new Date(nowMs())} order by created_at desc`
      : [];
    return { members: ms, me: { id: me.id, name: me.name, role: me.role }, invites: inv };
  },
  async invite_create(b, me) {
    const phone = normPhone(b.phone);
    if (!phone) throw new ApiError("Вкажіть номер телефону того, кого запрошуєте");
    const [dup] = await sql`select 1 from energy.members where phone=${phone} and active`;
    if (dup) throw new ApiError("Цей номер уже є в сімʼї");
    await sql`delete from energy.invites where used_by is null and kind='join' and phone=${phone}`;
    const code = randCode();
    await sql`insert into energy.invites(code, kind, phone, created_by, expires_at) values(${code}, 'join', ${phone}, ${me.id}, ${new Date(nowMs() + 72 * 3600000)})`;
    return { code };
  },
  async invite_delete(b) {
    await sql`delete from energy.invites where code=${String(b.code ?? "")} and used_by is null`;
    return {};
  },
  // Адміністратор: одноразове посилання, щоб член сімʼї задав новий пароль
  async member_reset(b, me) {
    const [m] = await sql`select id from energy.members where id=${Number(b.id)} and active`;
    if (!m) throw new ApiError("Не знайшов цього члена сімʼї");
    if (m.id === me.id) throw new ApiError("Свій пароль змініть у «Мій вхід»");
    const code = await makeResetCode(m.id, me.id, 24 * 60);
    return { code };
  },
  async member_remove(b, me) {
    const id = Number(b.id);
    if (id === me.id) throw new ApiError("Себе видалити не можна");
    await sql`update energy.members set active=false, pin_ver=pin_ver+1, tg_id=null where id=${id}`;
    await sql`delete from energy.locations where member_id=${id}`;
    await sql`delete from energy.invites where member_id=${id} and used_by is null`;
    tgCache.clear();
    return {};
  },
  // Покупки
  async shop_list() {
    const items = await sql`select id, name, cat, added_name, added_at, bought_at, bought_name from energy.shop_items
      where not cleared and (bought_at is null or bought_at > now() - interval '3 days') order by added_at`;
    const freq = await sql`select max(name) as name, count(*)::int n from energy.shop_items
      where added_at > now() - interval '120 days' group by lower(name) having count(*) >= 2 order by count(*) desc limit 30`;
    const open = new Set(items.filter((i) => !i.bought_at).map((i) => i.name.toLowerCase()));
    return { items, frequent: freq.filter((f) => !open.has(f.name.toLowerCase())).slice(0, 14).map((f) => f.name), now: nowMs() };
  },
  async shop_add(b, me) {
    const names = splitItems(String(b.text ?? ""));
    if (!names.length) throw new ApiError("Напишіть, що купити");
    const added = await shopAdd(names, me);
    return { added: added.length, ...(await familyActions.shop_list(b, me) as object) };
  },
  async shop_toggle(b, me) {
    const [i] = await sql`select * from energy.shop_items where id=${Number(b.id)}`;
    if (!i) throw new ApiError("Позицію вже видалено");
    if (i.bought_at) await sql`update energy.shop_items set bought_at=null, bought_by=null, bought_name=null, buy_notified=true where id=${i.id}`;
    else await sql`update energy.shop_items set bought_at=${new Date(nowMs())}, bought_by=${me.id}, bought_name=${me.name}, buy_notified=false where id=${i.id}`;
    return familyActions.shop_list(b, me);
  },
  async shop_delete(b, me) {
    await sql`delete from energy.shop_items where id=${Number(b.id)}`;
    return familyActions.shop_list(b, me);
  },
  async shop_clear(b, me) {
    await sql`update energy.shop_items set cleared=true, buy_notified=true where bought_at is not null`;
    return familyActions.shop_list(b, me);
  },
  // Події
  async events_list() {
    const events = await sql`select id, title, notes, day, tm, rep, remind, who, created_by from energy.events order by day, tm`;
    const power = await sql`select id, title, created_name, created_at, notified_at from energy.power_tasks
      where done_at is null and (notified_at is null or notified_at > now() - interval '1 day') order by created_at`;
    const members = await sql`select id, name from energy.members where active order by id`;
    const [open] = await sql`select id from energy.outages where ended_at is null limit 1`;
    return { events, power, members, now: nowMs(), today: local().day, light_off: !!open };
  },
  async event_save(b, me) {
    const e = b.event ?? {};
    const title = String(e.title ?? "").trim();
    if (!title || title.length > 120) throw new ApiError("Вкажіть назву події");
    if (!isDay(e.day)) throw new ApiError("Вкажіть дату");
    const tm = e.tm ? String(e.tm) : null;
    if (tm && !/^\d{2}:\d{2}$/.test(tm)) throw new ApiError("Невірний час");
    const rep = ["none", "weekly", "monthly", "yearly"].includes(e.rep) ? e.rep : "none";
    const remind = [...new Set((Array.isArray(e.remind) ? e.remind : []).map(Number).filter((x: number) => REMIND_OK.has(x)))].slice(0, 4) as number[];
    const who = e.who ? Number(e.who) : null;
    const notes = String(e.notes ?? "").trim().slice(0, 500);
    if (e.id) await sql`update energy.events set title=${title}, notes=${notes}, day=${e.day}, tm=${tm}, rep=${rep}, remind=${remind}, who=${who} where id=${Number(e.id)}`;
    else await sql`insert into energy.events(title, notes, day, tm, rep, remind, who, created_by) values(${title}, ${notes}, ${e.day}, ${tm}, ${rep}, ${remind}, ${who}, ${me.id})`;
    return familyActions.events_list(b, me);
  },
  async event_delete(b, me) {
    await sql`delete from energy.events where id=${Number(b.id)}`;
    return familyActions.events_list(b, me);
  },
  async power_add(b, me) {
    const t = String(b.title ?? "").trim();
    if (!t || t.length > 120) throw new ApiError("Напишіть справу");
    await sql`insert into energy.power_tasks(title, created_by, created_name, created_at) values(${t}, ${me.id}, ${me.name}, ${new Date(nowMs())})`;
    return familyActions.events_list(b, me);
  },
  // Telegram члена сімʼї (для зарядки ЖК і особистих нагадувань)
  // Привʼязка — лише в боті, кнопкою «Поділитися номером»: номер Telegram має збігтися з номером у «Світлиці»
  async tg_me_link(_b, me) {
    const s = await settings();
    if (!s.bot_username) throw new ApiError("Бот «Світлиці» ще не підключений на сервері");
    const [m] = await sql`select phone, tg_id from energy.members where id=${me.id}`;
    if (!m?.phone) throw new ApiError("Спершу вкажіть свій номер телефону");
    return { url: `https://t.me/${s.bot_username}?start=phone`, phone: m.phone, linked: !!m.tg_id };
  },
  async tg_unlink(_b, me) {
    await sql`update energy.members set tg_id=null where id=${me.id}`;
    tgCache.clear();
    return {};
  },
  async charging(b, me) {
    const tg = await myTg(me);
    if (!tg) return { linked: false };
    const op = String(b.op ?? "status");
    if (op === "register") {
      const fam = await familyApartment();
      if (!fam) throw new ApiError("Ніхто в сімʼї ще не зареєстрований у боті зарядки");
      await sql`insert into charging.users(tg_id, name, apartment, entrance, created) values(${tg}, ${me.name}, ${fam.apartment}, ${fam.entrance}, ${Math.floor(nowMs() / 1000)})
        on conflict (tg_id) do nothing`;
      return familyActions.charging({ op: "status" }, me);
    }
    if (!["status", "book", "queue_join", "done", "extend", "q_leave", "q_take"].includes(op)) throw new ApiError("Невідома дія");
    let j;
    try { j = await chargingFetch({ ...b, action: op, tg_id: tg }); }
    catch { throw new ApiError("Бот зарядки зараз не відповідає"); }
    if (!j.ok) throw new ApiError(j.error || "Помилка зарядки");
    const st = op === "status" ? j : await chargingFetch({ action: "status", tg_id: tg });
    const fam = st.registered ? null : await familyApartment();
    return { linked: true, result: op === "status" ? null : j, status: st, family_apartment: fam };
  },
  // Де сімʼя
  async locations() {
    const rows = await sql`select who, member_id, name, lat, lon, accuracy, live_until, source, updated_at from energy.locations
      where updated_at > now() - interval '7 days' order by name`;
    return { locations: rows, now: nowMs() };
  },
  async loc_share(b, me) {
    const lat = Number(b.lat), lon = Number(b.lon), acc = b.accuracy == null ? null : Number(b.accuracy);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new ApiError("Невірні координати");
    await sql`insert into energy.locations(who, member_id, name, lat, lon, accuracy, source, updated_at)
      values(${"m:" + me.id}, ${me.id}, ${me.name}, ${lat}, ${lon}, ${acc}, 'app', ${new Date(nowMs())})
      on conflict (who) do update set name=excluded.name, lat=excluded.lat, lon=excluded.lon, accuracy=excluded.accuracy, source='app', live_until=null, updated_at=excluded.updated_at`;
    await setMemberArea(me.id, lat, lon, "app");
    return { ...(await familyActions.locations(b, me) as object), zones: await zonesInfo(me) };
  },
  async loc_stop(b, me) {
    await sql`delete from energy.locations where who=${"m:" + me.id}`;
    return familyActions.locations(b, me);
  },
  async power_done(b, me) {
    await sql`update energy.power_tasks set done_at=${new Date(nowMs())} where id=${Number(b.id)}`;
    return familyActions.events_list(b, me);
  },
};

// ───────────── Безпека додатку ─────────────
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
export type Member = { id: number; name: string; role: string; pin_ver: number; has_pass?: boolean };
async function makeToken(m: { id: number; pin_ver: number }) {
  const s = await settings();
  const payload = b64u(enc.encode(JSON.stringify({ exp: nowMs() + 180 * 86400_000, m: m.id, v: m.pin_ver })));
  return `${payload}.${await hmac(s.token_secret, payload)}`;
}
const sameStr = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
async function checkToken(tok: string): Promise<Member | null> {
  const [payload, sig] = tok.split(".");
  if (!payload || !sig) return null;
  const s = await settings();
  if (!sameStr(await hmac(s.token_secret, payload), sig)) return null;
  try {
    const p = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!(p.exp > nowMs()) || !p.m) return null;
    const [m] = await sql`select id, name, role, pin_ver, pass_hash is not null has_pass from energy.members where id=${p.m} and active`;
    return m && m.pin_ver === p.v ? (m as unknown as Member) : null;
  } catch { return null; }
}
const randCode = () => b64u(crypto.getRandomValues(new Uint8Array(9)));
const longCode = () => b64u(crypto.getRandomValues(new Uint8Array(18)));

// Номер телефону → +380XXXXXXXXX (або міжнародний +XXXXXXXXXX)
export function normPhone(x: unknown): string | null {
  let d = String(x ?? "").replace(/[^\d]/g, "");
  if (d.length === 10 && d.startsWith("0")) d = "38" + d;
  else if (d.length === 9) d = "380" + d;
  if (d.startsWith("380") && d.length !== 12) return null;
  if (d.length < 10 || d.length > 15) return null;
  return "+" + d;
}
export const maskPhone = (p: string | null) => p ? p.slice(0, 4) + " ·· ··· " + p.slice(-4, -2) + " " + p.slice(-2) : null;
function checkPassword(x: unknown) {
  const p = String(x ?? "");
  if (p.length < 8) throw new ApiError("Пароль — щонайменше 8 символів");
  if (p.length > 128) throw new ApiError("Задовгий пароль");
  if (!/\p{L}/u.test(p) || !/\d/.test(p)) throw new ApiError("Пароль має містити літери й цифри");
  return p;
}
const PBKDF2_ITER = 120_000;
async function passHash(salt: string, pw: string, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, key, 256);
  return `p2$${iter}$${b64u(bits)}`;
}
async function passOk(salt: string | null, stored: string | null, pw: string) {
  if (!salt || !stored) { await passHash("dummy-salt", pw); return false; } // однаковий час відповіді
  const iter = Number(stored.split("$")[1]) || PBKDF2_ITER;
  return sameStr(await passHash(salt, pw, iter), stored);
}
// Обмеження спроб: після max помилок — пауза lockMin хвилин
async function throttleCheck(key: string) {
  const [r] = await sql`select until from energy.auth_fails where key=${key}`;
  const until = r?.until ? new Date(r.until).getTime() : 0;
  if (until > nowMs()) throw new ApiError(`Забагато спроб. Спробуйте через ${Math.ceil((until - nowMs()) / 60000)} хв`);
}
async function throttleFail(key: string, max: number, lockMin: number) {
  const now = new Date(nowMs());
  const [r] = await sql`insert into energy.auth_fails(key, n, at) values(${key}, 1, ${now})
    on conflict (key) do update set n = case when energy.auth_fails.at < ${new Date(nowMs() - 60 * 60000)} then 1 else energy.auth_fails.n + 1 end, at=${now}
    returning n`;
  if (r.n >= max) await sql`update energy.auth_fails set n=0, until=${new Date(nowMs() + lockMin * 60000)} where key=${key}`;
}
const throttleClear = (key: string) => sql`delete from energy.auth_fails where key=${key}`;
async function makeResetCode(memberId: number, by: number | null, minutes: number) {
  await sql`delete from energy.invites where kind='reset' and member_id=${memberId} and used_by is null`;
  const code = longCode();
  await sql`insert into energy.invites(code, kind, member_id, created_by, expires_at) values(${code}, 'reset', ${memberId}, ${by}, ${new Date(nowMs() + minutes * 60000)})`;
  return code;
}

// ───────────── API ─────────────
class ApiError extends Error {}
type Body = Record<string, any>;
const isDay = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const publicSettings = (s: Record<string, string>) => ({
  dess_user: s.dess_user || "", has_pass: !!s.dess_pass, dess_alias: s.dess_alias || "", dess_sn: s.dess_sn || "",
  tariff_day: Number(s.tariff_day || 4.32), tariff_night: Number(s.tariff_night || 2.16), tariff_zones: s.tariff_zones === "1",
  night_from: s.night_from || "23:00", night_to: s.night_to || "07:00", low_soc: Number(s.low_soc || 25), batt_kwh: s.batt_kwh ? Number(s.batt_kwh) : null,
  alerts_region: Number(s.alerts_region ?? 9), alerts_notify: s.alerts_notify !== "0", has_alerts_token: !!s.alerts_token,
  tg_linked: !!s.chat_id, bot_username: s.bot_username || "", last_error: s.last_error || "", last_ok: Number(s.last_ok || 0),
});

const CHG_ID = "bat_max_utility_charge_current";
const CHG_OPTS = [2, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const ADMIN_ONLY = new Set(["inv_fields", "inv_charge_set", "settings_save", "dess_connect", "points", "tg_link", "invite_create", "invite_delete", "member_reset", "member_remove"]);
// Поки член сімʼї не задав номер і пароль, доступні лише ці дії
const NO_PASS_OK = new Set(["dashboard", "credentials_save"]);
const actions: Record<string, (b: Body, me: Member) => Promise<unknown>> = {
  async dashboard(_b, me) {
    const s = await settings(true);
    if (!me.has_pass) return { now: nowMs(), me: { id: me.id, name: me.name, role: me.role, needs_credentials: true } };
    const [last] = await sql`select * from energy.samples order by ts desc limit 1`;
    const [open] = await sql`select * from energy.outages where ended_at is null order by started_at desc limit 1`;
    const [lastOut] = await sql`select * from energy.outages where ended_at is not null order by started_at desc limit 1`;
    const today = local().day;
    const [d] = await sql`select * from energy.daily where day=${today}`;
    const todaySamples = await sql`select ts, grid_on, soc, load_w from energy.samples
      where ts >= now() - interval '26 hours' order by ts`;
    return {
      now: nowMs(), last, open, last_outage: lastOut, today: d ?? null, samples: todaySamples, settings: publicSettings(s),
      alerts: { ...(await alertsInfo()), zones: await zonesInfo(me) }, me: { id: me.id, name: me.name, role: me.role, phone: (await sql`select phone from energy.members where id=${me.id}`)[0]?.phone ?? null }, home: await homeWith(me),
    };
  },
  async outages(b) {
    if (!isDay(b.from) || !isDay(b.to)) throw new ApiError("Невірні дати");
    const rows = await sql`select * from energy.outages
      where started_at < (${b.to}::date + 1)::timestamp at time zone ${TZ}
        and coalesce(ended_at, now()) > ${b.from}::date::timestamp at time zone ${TZ}
      order by started_at`;
    const al = await sql`select * from energy.alerts
      where started_at < (${b.to}::date + 1)::timestamp at time zone ${TZ}
        and coalesce(ended_at, now()) > ${b.from}::date::timestamp at time zone ${TZ}
      order by started_at`;
    return { outages: rows, alerts: al, now: nowMs() };
  },
  async daily(b) {
    if (!isDay(b.from) || !isDay(b.to)) throw new ApiError("Невірні дати");
    return { days: await sql`select * from energy.daily where day between ${b.from} and ${b.to} order by day` };
  },
  async samples(b) {
    if (!isDay(b.day)) throw new ApiError("Невірна дата");
    return {
      samples: await sql`select ts, grid_on, soc, load_w, pv_w, batt_in_w, batt_out_w from energy.samples
        where ts >= ${b.day}::date::timestamp at time zone ${TZ} and ts < (${b.day}::date + 1)::timestamp at time zone ${TZ} order by ts`,
    };
  },
  async settings_save(b) {
    const v = b.settings ?? {};
    const num = (x: unknown, lo: number, hi: number) => { const n = Number(x); if (!(n >= lo && n <= hi)) throw new ApiError("Перевірте числа в налаштуваннях"); return String(n); };
    if (v.tariff_day != null) await setSetting("tariff_day", num(v.tariff_day, 0, 100));
    if (v.tariff_night != null) await setSetting("tariff_night", num(v.tariff_night, 0, 100));
    if (v.tariff_zones != null) await setSetting("tariff_zones", v.tariff_zones ? "1" : "0");
    if (/^\d{2}:\d{2}$/.test(v.night_from ?? "")) await setSetting("night_from", v.night_from);
    if (/^\d{2}:\d{2}$/.test(v.night_to ?? "")) await setSetting("night_to", v.night_to);
    if (v.low_soc != null) await setSetting("low_soc", num(v.low_soc, 0, 100));
    if (v.batt_kwh != null) await setSetting("batt_kwh", v.batt_kwh === "" ? "" : num(v.batt_kwh, 0, 200));
    if (v.alerts_region != null) await setSetting("alerts_region", num(v.alerts_region, 0, 26));
    if (v.alerts_notify != null) await setSetting("alerts_notify", v.alerts_notify ? "1" : "0");
    if (v.alerts_token) {
      const tok = String(v.alerts_token).trim();
      try {
        const str = String(await alertsFetch(tok));
        if (!/^[ARYPN]{27}$/.test(str)) throw new Error("незрозумілий формат відповіді");
      } catch (e) { throw new ApiError(`Токен не підійшов: ${e instanceof Error ? e.message : e}`); }
      await setSetting("alerts_token", tok);
      await alertsTick();
    }
    return { settings: publicSettings(await settings(true)) };
  },
  // Інвертор: струм заряду від мережі (хмара SmartESS: bat_max_utility_charge_current)
  async inverter() {
    await settings(true);
    const dev = { pn: S.dess_pn, devcode: S.dess_devcode, devaddr: S.dess_devaddr, sn: S.dess_sn, i18n: "en" };
    const [cur, tot] = await Promise.all([
      dessAuthed(() => dessCall("queryDeviceCtrlValue", { ...dev, id: CHG_ID })),
      dessAuthed(() => dessCall("queryDeviceCtrlValue", { ...dev, id: "bat_max_total_charge_current" })).catch(() => null),
    ]);
    const max = parseFloat(tot?.val) || 50;
    const [r] = await sql`select batt_v from energy.samples where batt_v is not null order by ts desc limit 1`;
    const log = (() => { try { return JSON.parse(S.inv_log || "[]"); } catch { return []; } })();
    return { charge_a: parseFloat(cur?.val) || null, max_a: max, options: CHG_OPTS.filter((a) => a <= max), batt_v: r?.batt_v ?? 53, log };
  },
  async inv_charge_set(b, me) {
    await settings(true);
    const a = Number(b.amps);
    if (!CHG_OPTS.includes(a)) throw new ApiError("Невірний струм");
    const dev = { pn: S.dess_pn, devcode: S.dess_devcode, devaddr: S.dess_devaddr, sn: S.dess_sn, i18n: "en" };
    const before = await dessAuthed(() => dessCall("queryDeviceCtrlValue", { ...dev, id: CHG_ID })).catch(() => null);
    await dessAuthed(() => dessCall("ctrlDevice", { ...dev, id: CHG_ID, val: String(a) }));
    const after = await dessAuthed(() => dessCall("queryDeviceCtrlValue", { ...dev, id: CHG_ID })).catch(() => null);
    const was = parseFloat(before?.val) || null, now = parseFloat(after?.val) || null;
    if (now !== a) throw new ApiError(`Інвертор не підтвердив зміну (зараз ${after?.val ?? "невідомо"}). Спробуйте ще раз за хвилину`);
    const log = (() => { try { return JSON.parse(S.inv_log || "[]"); } catch { return []; } })();
    log.unshift({ at: nowMs(), who: me.name, from: was, to: a });
    await setSetting("inv_log", JSON.stringify(log.slice(0, 20)));
    const [r] = await sql`select batt_v from energy.samples where batt_v is not null order by ts desc limit 1`;
    const kw = (a * Number(r?.batt_v ?? 53) / 1000).toFixed(1).replace(".", ",");
    if (was !== a) await notify(`⚙️ ${esc(me.name)} змінив заряд від мережі: ${was ?? "?"} → <b>${a} А</b> (≈${kw} кВт)`);
    return await actions.inverter(b, me);
  },
  async dess_connect(b) {
    const user = String(b.user ?? "").trim(), pass = String(b.pass ?? "");
    if (!user) throw new ApiError("Вкажіть логін SmartESS");
    const old = await settings(true);
    await setSetting("dess_user", user);
    if (pass) await setSetting("dess_pass", pass);
    for (const k of ["dess_token", "dess_secret", "dess_expire", "dess_pn", "dess_sn", "dess_devcode", "dess_devaddr", "dess_alias"]) await setSetting(k, "");
    try {
      const devs = await dessDiscover();
      const d = devs[0];
      await setSetting("dess_pn", d.pn); await setSetting("dess_sn", d.sn);
      await setSetting("dess_devcode", String(d.devcode)); await setSetting("dess_devaddr", String(d.devaddr));
      await setSetting("dess_alias", d.alias);
      await setSetting("last_poll", "0");
      const t = await tick();
      return { device: d.alias, sn: d.sn, devices: devs.length, reading: t };
    } catch (e) {
      if (!old.dess_user) { await setSetting("dess_user", ""); await setSetting("dess_pass", ""); }
      else { await setSetting("dess_user", old.dess_user); await setSetting("dess_pass", old.dess_pass); }
      throw new ApiError(`SmartESS: ${e instanceof Error ? e.message : e}`);
    }
  },
  async poll_now() {
    await setSetting("last_poll", "0");
    return { result: await tick() };
  },
  async points() {
    const s = await settings(true);
    return { points: JSON.parse(s.last_points || "[]") };
  },
  async tg_link() {
    const s = await settings(true);
    if (!s.bot_username) throw new ApiError("Бот ще не підключений на сервері");
    const code = randCode();
    await setSetting("tg_code", code);
    return { url: `https://t.me/${s.bot_username}?startgroup=${code}` };
  },
  // Мій вхід: номер і пароль. Перший раз (перехід з PIN) — без поточного пароля
  async credentials_save(b, me) {
    const [m] = await sql`select * from energy.members where id=${me.id}`;
    if (m.pass_hash) {
      await throttleCheck("pw:" + me.id);
      if (!(await passOk(m.pass_salt, m.pass_hash, String(b.current ?? "")))) {
        await throttleFail("pw:" + me.id, 5, 15);
        throw new ApiError("Невірний поточний пароль");
      }
      await throttleClear("pw:" + me.id);
    }
    const phone = b.phone != null && b.phone !== "" ? normPhone(b.phone) : m.phone;
    if (!phone) throw new ApiError("Вкажіть номер телефону, напр. 067 123 45 67");
    if (!m.pass_hash && !b.password) throw new ApiError("Придумайте пароль");
    const pw = b.password ? checkPassword(b.password) : null;
    const [dup] = await sql`select 1 from energy.members where phone=${phone} and active and id<>${me.id}`;
    if (dup) throw new ApiError("Цей номер уже використовує інший член сімʼї");
    const phoneChanged = phone !== m.phone;
    const salt = pw ? randCode() : m.pass_salt;
    const hash = pw ? await passHash(salt, pw) : m.pass_hash;
    const [u] = await sql`update energy.members set phone=${phone}, pass_salt=${salt}, pass_hash=${hash},
        pin_hash=null, pin_ver=pin_ver+1, fail_count=0, tg_id=${phoneChanged ? null : m.tg_id}
      where id=${me.id} returning id, pin_ver`;
    if (phoneChanged) tgCache.clear();
    return { token: await makeToken(u as unknown as Member), phone, tg_unlinked: phoneChanged && !!m.tg_id };
  },
  ...familyActions,
};

const cleanName = (x: unknown) => {
  const n = String(x ?? "").trim().replace(/\s+/g, " ");
  if (n.length < 1 || n.length > 30) throw new ApiError("Імʼя — від 1 до 30 символів");
  return n;
};
async function createMember(name: string, phone: string, pw: string, role: "admin" | "member") {
  const salt = randCode();
  try {
    const [m] = await sql`insert into energy.members(name, role, phone, pass_salt, pass_hash, pin_salt)
      values(${name}, ${role}, ${phone}, ${salt}, ${await passHash(salt, pw)}, ${salt}) returning id, name, role, pin_ver`;
    return m as unknown as Member;
  } catch (e) {
    const c = String(e) + String((e as { constraint_name?: string }).constraint_name ?? "");
    if (c.includes("ux_members_name")) throw new ApiError("Таке імʼя вже є в сімʼї");
    if (c.includes("ux_members_phone")) throw new ApiError("Цей номер уже є в сімʼї");
    throw e;
  }
}
const LOGIN_ERR = "Невірний номер або пароль";

async function publicAction(action: string, b: Body) {
  await settings(true);
  const ip = String(b._ip || "?");
  if (action === "status") {
    const [{ n }] = await sql`select count(*)::int n from energy.members where active`;
    return { needs_setup: !n };
  }
  if (action === "invite_check") {
    const [i] = await sql`select i.kind, i.phone, m.name, m.phone mphone from energy.invites i left join energy.members m on m.id=i.member_id
      where i.code=${String(b.code ?? "")} and i.used_by is null and i.expires_at > ${new Date(nowMs())}`;
    if (!i) return { valid: false };
    return { valid: true, kind: i.kind, name: i.name ?? null, phone_hint: maskPhone(i.phone ?? i.mphone), needs_phone: i.kind === "reset" && !i.mphone };
  }
  if (action === "setup") {
    const [{ n }] = await sql`select count(*)::int n from energy.members`;
    if (n) throw new ApiError("Додаток уже налаштовано");
    const phone = normPhone(b.phone);
    if (!phone) throw new ApiError("Вкажіть номер телефону");
    const m = await createMember(cleanName(b.name ?? "Я"), phone, checkPassword(b.password), "admin");
    return { token: await makeToken(m) };
  }
  if (action === "join") {
    await throttleCheck("ip:" + ip);
    const name = cleanName(b.name), pw = checkPassword(b.password), phone = normPhone(b.phone);
    const [i] = await sql`select * from energy.invites where code=${String(b.code ?? "")} and kind='join' and used_by is null and expires_at > ${new Date(nowMs())}`;
    if (!i) throw new ApiError("Запрошення недійсне або вже використане. Попросіть нове.");
    if (!phone || phone !== i.phone) {
      await throttleFail("ip:" + ip, 10, 15);
      throw new ApiError("Номер не збігається з тим, на який надіслано запрошення");
    }
    const m = await createMember(name, phone, pw, "member");
    const used = await sql`update energy.invites set used_by=${m.id} where code=${i.code} and used_by is null returning code`;
    if (!used.length) { await sql`delete from energy.members where id=${m.id}`; throw new ApiError("Запрошення вже використане"); }
    return { token: await makeToken(m) };
  }
  if (action === "login") {
    await throttleCheck("ip:" + ip);
    const phone = normPhone(b.phone), pw = String(b.password ?? "");
    if (phone) await throttleCheck("ph:" + phone);
    const [m] = phone ? await sql`select * from energy.members where phone=${phone} and active` : [];
    if (m && (await passOk(m.pass_salt, m.pass_hash, pw))) {
      await throttleClear("ph:" + phone);
      return { token: await makeToken(m as unknown as Member) };
    }
    if (!m) await passOk(null, null, pw);
    await throttleFail("ip:" + ip, 20, 15);
    if (phone) await throttleFail("ph:" + phone, 5, 15);
    throw new ApiError(LOGIN_ERR);
  }
  // Новий пароль за одноразовим посиланням (від адміністратора або з Telegram)
  if (action === "reset") {
    await throttleCheck("ip:" + ip);
    const [i] = await sql`select * from energy.invites where code=${String(b.code ?? "")} and kind='reset' and used_by is null and expires_at > ${new Date(nowMs())}`;
    if (!i) { await throttleFail("ip:" + ip, 20, 15); throw new ApiError("Посилання недійсне або застаріло. Попросіть нове."); }
    const pw = checkPassword(b.password);
    const [m] = await sql`select * from energy.members where id=${i.member_id} and active`;
    if (!m) throw new ApiError("Посилання недійсне");
    let phone = m.phone;
    if (!phone) {
      phone = normPhone(b.phone);
      if (!phone) throw new ApiError("Вкажіть свій номер телефону");
      const [dup] = await sql`select 1 from energy.members where phone=${phone} and active and id<>${m.id}`;
      if (dup) throw new ApiError("Цей номер уже використовує інший член сімʼї");
    }
    const used = await sql`update energy.invites set used_by=${m.id} where code=${i.code} and used_by is null returning code`;
    if (!used.length) throw new ApiError("Посилання вже використане");
    const salt = randCode();
    const [u] = await sql`update energy.members set phone=${phone}, pass_salt=${salt}, pass_hash=${await passHash(salt, pw)}, pin_hash=null,
        pin_ver=pin_ver+1, tg_id=${phone === m.phone ? m.tg_id : null} where id=${m.id} returning id, pin_ver`;
    await throttleClear("ph:" + phone);
    return { token: await makeToken(u as unknown as Member) };
  }
  // Забули пароль: посилання надсилає бот в особистий Telegram, привʼязаний до цього номера
  if (action === "forgot") {
    await throttleCheck("ip:" + ip);
    await throttleFail("ip:" + ip, 20, 15);
    const phone = normPhone(b.phone);
    const [m] = phone ? await sql`select id, name, tg_id from energy.members where phone=${phone} and active` : [];
    const s = await settings();
    if (m?.tg_id && BOT_TOKEN && s.app_url) {
      const code = await makeResetCode(m.id, null, 30);
      try {
        await bot.api.sendMessage(Number(m.tg_id), `🔑 ${esc(m.name)}, ось посилання для нового пароля до «Світлиці» (діє 30 хв):\n${s.app_url}#reset=${code}\n\nЯкщо це не ви — просто проігноруйте.`, { link_preview_options: { is_disabled: true } });
      } catch (e) { console.warn("forgot send", String(e)); }
    }
    return { sent: true };
  }
  return undefined;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

export async function api(req: Request) {
  let b: Body;
  try { b = await req.json(); } catch { return json({ ok: false, error: "Невірний запит" }, 400); }
  const action = String(b.action ?? "");
  b._ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "?";
  try {
    const pub = await publicAction(action, b);
    if (pub !== undefined) return json({ ok: true, ...pub });
    const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const me = await checkToken(tok);
    if (!me) return json({ ok: false, error: "auth" }, 401);
    const fn = actions[action];
    if (!fn) return json({ ok: false, error: "Невідома дія" }, 400);
    if (!me.has_pass && !NO_PASS_OK.has(action)) throw new ApiError("Спершу задайте номер телефону й пароль");
    if (ADMIN_ONLY.has(action) && me.role !== "admin") throw new ApiError("Це може змінити лише адміністратор");
    // адреса додатку (для посилань «забули пароль») — з запитів адміністратора
    if (me.role === "admin" && typeof b._app === "string" && /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(b._app) && b._app !== S.app_url) await setSetting("app_url", b._app);
    return json({ ok: true, ...((await fn(b, me)) as object) });
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.message }, 400);
    console.error(e);
    return json({ ok: false, error: "Помилка сервера" }, 500);
  }
}

// ───────────── Telegram-бот ─────────────
let BOT_TOKEN = env("ENERGY_BOT_TOKEN");
if (!BOT_TOKEN && env("SUPABASE_DB_URL")) {
  try { BOT_TOKEN = (await sql`select value from energy.settings where key='bot_token'`)[0]?.value ?? ""; }
  catch (e) { console.error("token load failed", String(e)); }
}
export const bot = new Bot(BOT_TOKEN || "0:not-configured");
const H = { parse_mode: "HTML" as const };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function notify(text: string) {
  const chat = S.chat_id;
  if (!chat || !BOT_TOKEN) return;
  try { await bot.api.sendMessage(Number(chat), text, H); } catch (e) { console.warn("notify failed", String(e)); }
}
// Повідомлення, що замінює попереднє такого ж типу (і пов'язані): у групі лишається тільки актуальний стан
export async function notifyReplace(kind: string, text: string, also: string[] = []) {
  const chat = S.chat_id;
  if (!chat || !BOT_TOKEN) return;
  for (const k of [kind, ...also]) {
    const id = Number(S["tgm_" + k] || 0);
    if (id) { try { await bot.api.deleteMessage(Number(chat), id); } catch { /* старше 48 год або вже видалено */ } await setSetting("tgm_" + k, ""); }
  }
  try { const m = await bot.api.sendMessage(Number(chat), text, H); await setSetting("tgm_" + kind, String(m.message_id)); }
  catch (e) { console.warn("notify failed", String(e)); }
}
async function dropMsg(kind: string) {
  const id = Number(S["tgm_" + kind] || 0);
  if (!id || !S.chat_id || !BOT_TOKEN) return;
  try { await bot.api.deleteMessage(Number(S.chat_id), id); } catch { /* */ }
  await setSetting("tgm_" + kind, "");
}

async function statusText() {
  await settings(true);
  const [r] = await sql`select * from energy.samples order by ts desc limit 1`;
  if (!r) return "Даних ще немає. Підключіть SmartESS у додатку.";
  const [open] = await sql`select * from energy.outages where ended_at is null limit 1`;
  const age = Math.round((nowMs() - new Date(r.ts).getTime()) / 60000);
  const st = S.alerts_state || "", reg = Number(S.alerts_region ?? 9);
  const alertLine = S.alerts_token && st.length === 27
    ? (isActive(st[reg]) ? `🔴 Тривога · ${REGIONS[reg]}` : `🟢 Тривоги немає · ${REGIONS[reg]}`) : "";
  const L = [
    alertLine,
    open ? `🕯 <b>Світла немає</b> вже ${fmtDur((nowMs() - new Date(open.started_at).getTime()) / 60000)}` : "💡 <b>Світло є</b>",
    open ? powerBackHint() : nextOffHint(),
    r.soc != null ? `🔋 АКБ: <b>${Math.round(r.soc)}%</b>${r.batt_in_w ? ` · заряд ${Math.round(r.batt_in_w)} Вт` : r.batt_out_w ? ` · розряд ${Math.round(r.batt_out_w)} Вт` : ""}` : "",
    r.load_w != null ? `🏠 Навантаження: ${Math.round(r.load_w)} Вт` : "",
    r.pv_w ? `☀️ Сонце: ${Math.round(r.pv_w)} Вт` : "",
    `<i>дані ${age <= 1 ? "щойно" : `${age} хв тому`}</i>`,
  ];
  return L.filter(Boolean).join("\n");
}

// Хто може користуватись ботом: сімейна група або в особистому чаті — лише член сімʼї з підтвердженим номером
const tgCache = new Map<number, { id: number | null; at: number }>();
async function memberByTg(userId: number) {
  const c = tgCache.get(userId);
  if (c && Date.now() - c.at < 60000) return c.id;
  const [m] = await sql`select id from energy.members where tg_id=${userId} and active`;
  tgCache.set(userId, { id: m ? Number(m.id) : null, at: Date.now() });
  return m ? Number(m.id) : null;
}
const inFamilyChat = (ctx: Context) => !!S.chat_id && String(ctx.chat?.id) === String(S.chat_id);
async function allowed(ctx: Context) {
  await settings();
  if (inFamilyChat(ctx)) return true;
  return ctx.chat?.type === "private" && !!ctx.from && (await memberByTg(ctx.from.id)) != null;
}
const PHONE_KB = { keyboard: [[{ text: "📱 Поділитися номером", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true, is_persistent: true };
const askPhone = (ctx: Context) => ctx.reply(
  "🔒 Це закритий сімейний бот «Світлиці».\n\nЩоб користуватися ним, підтвердіть свій номер телефону кнопкою нижче. Номер має збігатися з тим, з яким ви входите у «Світлицю».",
  { reply_markup: PHONE_KB });
const tgName = (ctx: Context) => ctx.from?.first_name || "Хтось";
export const BOT_COMMANDS = [
  { command: "list", description: "Список покупок" },
  { command: "buy", description: "Додати покупки: /buy молоко, хліб" },
  { command: "events", description: "Найближчі події" },
  { command: "light", description: "Нагадати, коли дадуть світло" },
  { command: "now", description: "Світло й АКБ зараз" },
  { command: "stoploc", description: "Прибрати мою геолокацію" },
  { command: "today", description: "Відключення сьогодні" },
  { command: "week", description: "Відключення за тиждень" },
];
const HELP = "🛒 /list — список покупок (тисніть на позицію, коли купили)\n/buy молоко, хліб — додати в список\n📅 /events — найближчі події\n🔌 /light пральку — нагадаю, коли дадуть світло\n💡 /now — світло й АКБ\n/today, /week — відключення\n📍 Надішліть боту в особисті «Геопозицію наживо» — сімʼя бачитиме вас у додатку. /stoploc — прибрати";

export async function listView() {
  const items = await sql`select id, name, bought_at from energy.shop_items
    where not cleared and (bought_at is null or bought_at > now() - interval '12 hours')
    order by bought_at nulls first, added_at limit 40`;
  const left = items.filter((i) => !i.bought_at).length;
  const text = left ? `🛒 <b>Купити: ${left}</b>\nТисніть на позицію, коли купили.` : items.length ? "🛒 Усе куплено 🎉" : "🛒 Список порожній.\nДодайте: /buy молоко, хліб";
  const kb = new InlineKeyboard();
  for (const i of items) kb.text(`${i.bought_at ? "✅" : "⬜️"} ${i.name}`.slice(0, 60), `b:${i.id}`).row();
  kb.text("🔄 Оновити", "b:0");
  return { text, kb };
}

bot.command("start", async (ctx) => {
  await settings(true);
  const code = (ctx.match ?? "").trim();
  if (code && S.tg_code && code === S.tg_code) {
    // групу підключає лише адміністратор «Світлиці» з підтвердженим номером
    const mid = ctx.from ? await memberByTg(ctx.from.id) : null;
    const [adm] = mid ? await sql`select 1 from energy.members where id=${mid} and role='admin' and active` : [];
    if (!adm) return ctx.reply(`🔒 Групу може підключити лише адміністратор «Світлиці», який підтвердив свій номер у боті. Напишіть боту @${S.bot_username || "бот"} в особисті, натисніть «Поділитися номером», а потім знову «Додати бота в групу» в додатку.`);
    await setSetting("chat_id", String(ctx.chat.id)); await setSetting("tg_code", "");
    return ctx.reply(`✅ Готово! Сюди приходитимуть сповіщення для всієї сімʼї: світло, тривоги, нагадування про події, зміни у списку покупок.\n\n${HELP}`);
  }
  if (await allowed(ctx)) {
    return ctx.reply(HELP + (ctx.chat.type === "private" ? "\n\nТут можна просто написати, що купити, — кожне з нового рядка або через кому." : ""));
  }
  if (ctx.chat.type === "private") return askPhone(ctx);
  return; // чужі групи ігноруємо
});
// Підтвердження номера: лише власний контакт (кнопкою), номер має бути в сімʼї
bot.on("message:contact", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  await settings();
  const c = ctx.message.contact, uid = ctx.from.id, key = "tg:" + uid;
  const [t] = await sql`select until from energy.auth_fails where key=${key}`;
  if (t?.until && new Date(t.until).getTime() > nowMs()) return ctx.reply("Забагато спроб. Спробуйте пізніше.");
  if (c.user_id !== uid) return ctx.reply("Надішліть, будь ласка, саме свій номер — кнопкою «📱 Поділитися номером».", { reply_markup: PHONE_KB });
  const phone = normPhone(c.phone_number);
  const [m] = phone ? await sql`select id, name, tg_id from energy.members where phone=${phone} and active` : [];
  if (!m) {
    await throttleFail(key, 5, 60);
    return ctx.reply("❌ Цього номера немає серед сімʼї у «Світлиці».\nПопросіть адміністратора запросити вас на цей номер, або перевірте номер у «Світлиці» → Ще → Мій вхід.", { reply_markup: { remove_keyboard: true } });
  }
  if (m.tg_id && Number(m.tg_id) !== uid) {
    return ctx.reply("Цей номер уже привʼязаний до іншого Telegram. Відвʼяжіть його у «Світлиці» (Ще → Сімʼя і Telegram) і спробуйте ще раз.", { reply_markup: { remove_keyboard: true } });
  }
  await sql`update energy.members set tg_id=null where tg_id=${uid} and id<>${m.id}`;
  await sql`update energy.members set tg_id=${uid} where id=${m.id}`;
  await throttleClear(key);
  tgCache.clear();
  await ctx.reply(`✅ ${esc(m.name)}, номер підтверджено — бот ваш.\n\n${HELP}\n\nТут можна просто написати, що купити, — кожне з нового рядка або через кому.`, { ...H, reply_markup: { remove_keyboard: true } });
});
bot.command("now", async (ctx) => { if (await allowed(ctx)) await ctx.reply(await statusText(), H); });
bot.command("list", async (ctx) => {
  if (!(await allowed(ctx))) return;
  const v = await listView();
  await ctx.reply(v.text, { ...H, reply_markup: v.kb });
});
bot.command("buy", async (ctx) => {
  if (!(await allowed(ctx))) return;
  const names = splitItems(ctx.match ?? "");
  if (!names.length) return ctx.reply("Напишіть так: /buy молоко, хліб, яйця");
  const added = await shopAdd(names, { name: tgName(ctx) }, inFamilyChat(ctx));
  await ctx.reply(added.length ? `➕ Додано: ${esc(added.join(", "))}` : "Це вже є у списку", H);
});
bot.callbackQuery(/^b:(\d+)$/, async (ctx) => {
  if (!(await allowed(ctx))) return ctx.answerCallbackQuery({ text: "Лише для сімʼї" });
  const id = Number(ctx.match[1]);
  if (id) {
    const [i] = await sql`select * from energy.shop_items where id=${id}`;
    if (i?.bought_at) await sql`update energy.shop_items set bought_at=null, bought_by=null, bought_name=null, buy_notified=true where id=${id}`;
    else if (i) await sql`update energy.shop_items set bought_at=${new Date(nowMs())}, bought_name=${tgName(ctx)}, buy_notified=${inFamilyChat(ctx)} where id=${id}`;
  }
  const v = await listView();
  try { await ctx.editMessageText(v.text, { ...H, reply_markup: v.kb }); } catch { /* без змін */ }
  await ctx.answerCallbackQuery(id ? undefined : { text: "Оновлено" });
});
bot.command("light", async (ctx) => {
  if (!(await allowed(ctx))) return;
  const t = (ctx.match ?? "").trim().slice(0, 120);
  if (t) {
    await sql`insert into energy.power_tasks(title, created_name) values(${t}, ${tgName(ctx)})`;
    const [open] = await sql`select 1 from energy.outages where ended_at is null limit 1`;
    return ctx.reply(`🔌 Нагадаю ${open ? "щойно дадуть світло" : "наступного разу, коли дадуть світло"}: ${esc(t)}`, H);
  }
  const ts = await sql`select title from energy.power_tasks where notified_at is null and done_at is null order by created_at`;
  await ctx.reply(ts.length ? `🔌 <b>Чекають світла:</b>\n${ts.map((x) => `• ${esc(x.title)}`).join("\n")}` : "Справ «коли дадуть світло» немає.\nДодайте: /light увімкнути пральку", H);
});
bot.command("events", async (ctx) => {
  if (!(await allowed(ctx))) return;
  const now = nowMs();
  const evs = (await sql`select * from energy.events`) as unknown as Ev[];
  const names = await memberNames();
  const up = evs.flatMap((ev) => occurrences(ev, now - 3600000, now + 7 * 86400000).map((o) => ({ ev, ...o }))).sort((a, b) => a.ms - b.ms).slice(0, 15);
  await ctx.reply(up.length
    ? `📅 <b>Найближчі 7 днів</b>\n\n${up.map((o) => `${whenLabel(o.day, o.ev.tm)} — <b>${esc(o.ev.title)}</b>${o.ev.who ? ` (${esc(names[o.ev.who] ?? "")})` : ""}`).join("\n")}`
    : "📅 На найближчий тиждень подій немає", H);
});
bot.command("today", async (ctx) => {
  if (!(await allowed(ctx))) return;
  const day = local().day;
  const [d] = await sql`select * from energy.daily where day=${day}`;
  const outs = await sql`select * from energy.outages where started_at >= ${day}::date::timestamp at time zone ${TZ} order by started_at`;
  const L = [`📅 <b>Сьогодні</b>`, ""];
  L.push(outs.length ? `Відключень: <b>${outs.length}</b>, без світла ${fmtDur(d?.outage_min ?? 0)}` : "Відключень не було 🎉");
  for (const o of outs) L.push(`  ${local(new Date(o.started_at).getTime()).hm}–${o.ended_at ? local(new Date(o.ended_at).getTime()).hm : "зараз"}`);
  if (d) {
    L.push("", `З мережі: ${d.grid_kwh.toFixed(1)} кВт·год · <b>${Math.round(d.grid_cost)} грн</b>`);
    L.push(`Спожито вдома: ${d.load_kwh.toFixed(1)} кВт·год`);
    if (d.pv_kwh > 0.05) L.push(`Від сонця: ${d.pv_kwh.toFixed(1)} кВт·год`);
  }
  await ctx.reply(L.join("\n"), H);
});
bot.command("week", async (ctx) => {
  if (!(await allowed(ctx))) return;
  const rows = await sql`select day, outage_min, grid_cost from energy.daily where day > ${local().day}::date - 7 order by day`;
  if (!rows.length) return ctx.reply("Даних за тиждень ще немає");
  const tot = rows.reduce((a, r) => a + r.outage_min, 0), cost = rows.reduce((a, r) => a + r.grid_cost, 0);
  await ctx.reply([`🗓 <b>7 днів</b>`, "", ...rows.map((r) => `${r.day.slice(8)}.${r.day.slice(5, 7)} — без світла ${fmtDur(r.outage_min)}`), "", `Разом без світла: <b>${fmtDur(tot)}</b>`, `За світло з мережі: <b>${Math.round(cost)} грн</b>`].join("\n"), H);
});
// Геолокація: звичайна або «наживо»; живе місце оновлюється редагуванням того самого повідомлення
async function saveTgLocation(ctx: Context, live: boolean) {
  const m = ctx.editedMessage ?? ctx.message;
  const loc = m?.location, from = m?.from ?? ctx.from;
  if (!loc || !from) return;
  if (!(await allowed(ctx))) return;
  const until = loc.live_period ? new Date((m!.date + (loc.live_period >= 0x7fffffff ? 365 * 86400 : loc.live_period)) * 1000) : null;
  await sql`insert into energy.locations(who, name, lat, lon, accuracy, live_until, source, updated_at)
    values(${"tg:" + from.id}, ${from.first_name || "Хтось"}, ${loc.latitude}, ${loc.longitude}, ${loc.horizontal_accuracy ?? null}, ${until}, 'telegram', ${new Date(nowMs())})
    on conflict (who) do update set name=excluded.name, lat=excluded.lat, lon=excluded.lon, accuracy=excluded.accuracy,
      live_until=coalesce(excluded.live_until, energy.locations.live_until), source='telegram', updated_at=excluded.updated_at`;
  const [mem] = await sql`select id from energy.members where tg_id=${from.id} and active`;
  if (mem) await setMemberArea(mem.id, loc.latitude, loc.longitude, "telegram");
  if (!live && ctx.chat?.type === "private") {
    await ctx.reply(loc.live_period ? "📍 Дякую! Поки ділитесь наживо, сімʼя бачить вас у додатку («Ще → Де сімʼя»). Зупинити можна в Telegram." : "📍 Записав вашу точку. Щоб сімʼя бачила вас постійно, оберіть «Ділитися геопозицією наживо».");
  }
}
bot.on("message:location", (ctx) => saveTgLocation(ctx, false));
bot.on("edited_message:location", (ctx) => saveTgLocation(ctx, true));
bot.command("stoploc", async (ctx) => {
  if (!(await allowed(ctx)) || !ctx.from) return;
  await sql`delete from energy.locations where who=${"tg:" + ctx.from.id}`;
  await ctx.reply("📍 Вашу точку видалено. Не забудьте зупинити трансляцію в самому Telegram.");
});
// Група стала супергрупою — новий id чату
bot.on("message:migrate_to_chat_id", async (ctx) => {
  await settings();
  if (inFamilyChat(ctx)) await setSetting("chat_id", String(ctx.message.migrate_to_chat_id));
});
// Особисте повідомлення без команди — це покупки
bot.on("message:text", async (ctx) => {
  if (ctx.chat.type !== "private" || ctx.message.text.startsWith("/")) return;
  if (!(await allowed(ctx))) return askPhone(ctx);
  const added = await shopAdd(splitItems(ctx.message.text), { name: tgName(ctx) });
  await ctx.reply(added.length ? `🛒 Додано в покупки: ${esc(added.join(", "))}\n/list — весь список` : "Це вже є у списку", H);
});

// ───────────── HTTP ─────────────
let tgHandler: ((r: Request) => Promise<Response>) | null = null;
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const s = await settings();
  if (url.searchParams.has("tick")) {
    if (url.searchParams.get("tick") !== s.secret) return new Response("forbidden", { status: 403 });
    return new Response(JSON.stringify(await tick()));
  }
  if (url.searchParams.has("tg")) {
    if (url.searchParams.get("tg") !== s.secret || !BOT_TOKEN) return new Response("forbidden", { status: 403 });
    tgHandler ??= webhookCallback(bot, "std/http", { timeoutMilliseconds: 50_000, onTimeout: "return" });
    try { return await tgHandler(req); } catch (e) { console.error(e); return new Response("ok"); }
  }
  if (url.searchParams.has("setup")) {
    if (url.searchParams.get("setup") !== s.secret || !BOT_TOKEN) return new Response("forbidden", { status: 403 });
    await bot.api.setWebhook(`${env("SUPABASE_URL")}/functions/v1/energy?tg=${s.secret}`, { drop_pending_updates: true });
    await bot.api.setMyCommands(BOT_COMMANDS);
    const me = await bot.api.getMe();
    await setSetting("bot_username", me.username);
    return new Response(`ok @${me.username}`);
  }
  if (req.method === "POST") return api(req);
  return json({ ok: true, service: "energy" });
}

if (!Deno.env.get("ENERGY_TEST")) Deno.serve(handler);
