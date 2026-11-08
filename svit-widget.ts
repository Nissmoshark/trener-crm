// «Світлиця» · дані для віджета на головному екрані телефона (KWGT на Android)
//   POST {action:"widget_key"} (Authorization: Bearer <токен «Світлиці»>) — створити/оновити особисте посилання
//   GET ?k=<ключ>                — JSON: світло, АКБ, тривога вдома й там, де я
//   GET ?k=<ключ>&fmt=text       — один рядок тексту
import postgres from "npm:postgres@3.4.5";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

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
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = async (s: string) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(s)));
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
    const [m] = await sql`select id, name, pin_ver, pass_hash is not null has_pass from energy.members where id=${p.m} and active`;
    return m && m.pin_ver === p.v && m.has_pass ? m : null;
  } catch { return null; }
}

const REGIONS = ["АР Крим", "Волинська обл.", "Вінницька обл.", "Дніпропетровська обл.", "Донецька обл.", "Житомирська обл.", "Закарпатська обл.", "Запорізька обл.", "Івано-Франківська обл.", "м. Київ", "Київська обл.", "Кіровоградська обл.", "Луганська обл.", "Львівська обл.", "Миколаївська обл.", "Одеська обл.", "Полтавська обл.", "Рівненська обл.", "м. Севастополь", "Сумська обл.", "Тернопільська обл.", "Харківська обл.", "Херсонська обл.", "Хмельницька обл.", "Черкаська обл.", "Чернівецька обл.", "Чернігівська обл."];
const THREATS: Record<string, string> = { drones: "дрони", ballistic_missiles: "балістика", cruise_missiles: "крилаті ракети", unspecified_missiles: "ракети", guided_aerial_bombs: "КАБи", mig31k_departure: "зліт МіГ-31К", tactic_aircraft_activity: "тактична авіація", strategic_aircraft_activity: "стратегічна авіація", air_defense: "робота ППО", unknown: "загроза" };
const fw = (s: string | null) => (s ?? "").toLowerCase().replace(/^м\.\s*/, "").split(/[\s,]+/)[0];
function hits(area: any, list: any[]) {
  return list.filter((a) =>
    (area.kyiv && (a.uid === "31" || a.t === "м. Київ")) ||
    (!area.kyiv && !!area.oblast && a.type === "oblast" && a.obl === area.oblast) ||
    (!!area.raion && a.type === "raion" && a.t === area.raion) ||
    (!!area.hromada && a.type === "hromada" && a.obl === area.oblast && fw(a.t) === fw(area.hromada)) ||
    (!area.kyiv && !!area.city && a.type === "city" && fw(a.t) === fw(area.city)));
}
const place = (a: any) => a.kyiv ? "Київ" : a.label || a.hromada || a.oblast || "";
function dur(min: number) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} год${m ? ` ${m} хв` : ""}` : `${m} хв`;
}
const hm = (ms: number) => new Date(ms).toLocaleTimeString("uk-UA", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export async function widgetData(memberId: number) {
  const s = await settings(true), now = nowMs();
  const [r] = await sql`select ts, grid_on, soc, load_w from energy.samples order by ts desc limit 1`;
  const [open] = await sql`select started_at from energy.outages where ended_at is null order by started_at desc limit 1`;
  const [lastOut] = await sql`select ended_at from energy.outages where ended_at is not null order by ended_at desc limit 1`;
  const lightOn = r ? !open : null;
  const since = open ? (now - new Date(open.started_at).getTime()) / 60000 : lastOut ? (now - new Date(lastOut.ended_at).getTime()) / 60000 : null;
  const soc = r?.soc != null ? Math.round(r.soc) : null;
  const age = r ? Math.round((now - new Date(r.ts).getTime()) / 60000) : null;
  // тривога вдома
  const reg = Number(s.alerts_region ?? 9), st = s.alerts_state || "", c = st[reg];
  const homeOn = c === "A" || c === "R" || c === "Y", homePart = c === "P";
  let list: any[] = []; try { list = JSON.parse(s.alerts_list || "[]"); } catch { /* */ }
  const homeName = (REGIONS[reg] ?? "").replace("м. ", "");
  // там, де я
  const [m] = await sql`select area, area_at from energy.members where id=${memberId}`;
  let meTxt = "", meOn = 0, mePlace = "", threats: string[] = [];
  if (m?.area && m.area_at && now - new Date(m.area_at).getTime() < 12 * 3600000) {
    const h = hits(m.area, list);
    mePlace = place(m.area); meOn = h.length ? 1 : 0;
    threats = [...new Set(h.flatMap((x) => x.th ?? []))].map((x) => THREATS[x] ?? x);
    meTxt = meOn ? `🔴 Тривога · ${mePlace}` : `🟢 Тихо · ${mePlace}`;
  }
  const alertTxt = !st ? "Тривоги: немає даних" : homeOn ? `🔴 Тривога · ${homeName}` : homePart ? `🟠 Частина області · ${homeName}` : `🟢 Тихо · ${homeName}`;
  const lightTxt = lightOn == null ? "Немає даних з інвертора" : lightOn ? "💡 Світло є" : "🕯 Світла немає";
  // графік ДТЕК (інтервали рахує svit-dtek)
  let ivs: { a: number; b: number }[] = []; try { ivs = JSON.parse(s.dtek_iv || "[]"); } catch { /* */ }
  const curIv = ivs.find((x) => x.a <= now && x.b > now), nextIv = ivs.find((x) => x.a > now);
  const sched = !s.dtek_group ? "" : curIv ? `За графіком світло о ${hm(curIv.b)}` : nextIv ? `Вимкнуть о ${hm(nextIv.a)} (до ${hm(nextIv.b)})` : "За графіком відключень немає";
  const out = {
    light_on: lightOn == null ? -1 : lightOn ? 1 : 0, light: lightTxt,
    since: since == null ? "" : dur(since), since_min: since == null ? -1 : Math.round(since),
    light_line: lightOn == null ? lightTxt : `${lightTxt}${since != null ? (lightOn ? ` · ${dur(since)}` : ` вже ${dur(since)}`) : ""}`,
    soc: soc ?? -1, soc_txt: soc == null ? "—" : `${soc}%`, load_w: r?.load_w != null ? Math.round(r.load_w) : -1,
    alert_on: homeOn ? 1 : 0, alert_part: homePart ? 1 : 0, alert: alertTxt, region: homeName,
    me_on: meOn, me: meTxt, me_place: mePlace, threats: threats.join(", "),
    data_age_min: age ?? -1, updated: hm(now), sched,
    sched_at: curIv ? hm(curIv.b) : nextIv ? hm(nextIv.a) : "", sched_kind: curIv ? "on" : nextIv ? "off" : "",
    sched_in: curIv ? dur((curIv.b - now) / 60000) : nextIv ? dur((nextIv.a - now) / 60000) : "", alert_short: homeOn ? "Тривога" : homePart ? "Частина обл." : "Тихо",
    line: `${lightTxt}${soc != null ? ` · АКБ ${soc}%` : ""} · ${homeOn ? "🔴 тривога" : homePart ? "🟠 частково" : "🟢 тихо"}`,
  };
  return out;
}

// ───── Картинка для віджета (Web Image Widget на Android, Віджет «Фото» тощо) ─────
let wasmReady: Promise<void> | null = null;
let fonts: Uint8Array[] | null = null;
export let fontLoad = async (): Promise<Uint8Array[]> => {
  const css = await (await fetch("https://fonts.googleapis.com/css2?family=Manrope:wght@600;800&subset=cyrillic")).text();
  const urls = [...css.matchAll(/url\((https:[^)]+\.ttf)\)/g)].map((m) => m[1]);
  return await Promise.all(urls.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
};
export let wasmLoad = () => fetch("https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
export function setImgDeps(f: () => Promise<Uint8Array[]>, w: () => any) { fontLoad = f; wasmLoad = w; }
const x = (t: string) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function widgetSvg(d: Awaited<ReturnType<typeof widgetData>>, dark = true) {
  const W = 800, H = 380;
  const bg = dark ? "#141a2b" : "#ffffff", ink = dark ? "#f3f4f6" : "#141a2b", mute = dark ? "#9aa3b5" : "#6b7280", tile = dark ? "#1f2740" : "#f1f2f5";
  const on = d.light_on === 1, off = d.light_on === 0;
  const lamp = on ? "#f4c04c" : off ? "#5b6b8f" : mute;
  const soc = d.soc >= 0 ? d.soc : null;
  const battCol = soc == null ? mute : soc <= 25 ? "#e5484d" : soc <= 50 ? "#f0b400" : "#3fbf7f";
  const head = d.light_on === -1 ? "Немає даних" : on ? "Світло є" : "Світла немає";
  const since = d.since ? (on ? `уже ${d.since}` : `уже ${d.since}`) : "";
  const alertCol = d.alert_on ? "#e5484d" : d.alert_part ? "#f0a000" : "#3fbf7f";
  const segs = Array.from({ length: 10 }, (_, i) => `<rect x="${470 + i * 28}" y="78" width="22" height="40" rx="5" fill="${soc != null && i < Math.round(soc / 10) ? battCol : tile}"/>`).join("");
  const schedTxt = d.sched_kind === "off" ? `Вимкнуть о ${d.sched_at}` : d.sched_kind === "on" ? `Світло о ${d.sched_at}` : d.sched ? "Відключень за графіком немає" : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="44" fill="${bg}"/>
  <circle cx="74" cy="92" r="26" fill="${lamp}"/>${on ? `<circle cx="74" cy="92" r="40" fill="${lamp}" opacity=".18"/>` : ""}
  <text x="120" y="104" font-family="Manrope" font-weight="800" font-size="44" fill="${ink}">${x(head)}</text>
  <text x="120" y="146" font-family="Manrope" font-weight="600" font-size="26" fill="${mute}">${x(since)}</text>
  <rect x="462" y="70" width="290" height="56" rx="12" fill="none" stroke="${mute}" stroke-width="3"/><rect x="754" y="88" width="8" height="20" rx="3" fill="${mute}"/>
  ${segs}
  <text x="752" y="176" text-anchor="end" font-family="Manrope" font-weight="800" font-size="46" fill="${ink}">${soc == null ? "—" : soc + "%"}</text>
  <text x="462" y="170" font-family="Manrope" font-weight="600" font-size="24" fill="${mute}">АКБ</text>
  <rect x="40" y="214" width="350" height="120" rx="26" fill="${tile}"/>
  <text x="66" y="256" font-family="Manrope" font-weight="600" font-size="23" fill="${mute}">Графік ДТЕК</text>
  <text x="66" y="294" font-family="Manrope" font-weight="800" font-size="${schedTxt.length > 16 ? 26 : 34}" fill="${ink}">${x(schedTxt || "—")}</text>
  ${d.sched_in ? `<text x="66" y="322" font-family="Manrope" font-weight="600" font-size="20" fill="${mute}">за ${x(d.sched_in)}</text>` : ""}
  <rect x="410" y="214" width="350" height="120" rx="26" fill="${tile}"/>
  <circle cx="446" cy="250" r="10" fill="${alertCol}"/>
  <text x="466" y="258" font-family="Manrope" font-weight="600" font-size="23" fill="${mute}">${x(d.region || "Тривога")}</text>
  <text x="436" y="306" font-family="Manrope" font-weight="800" font-size="34" fill="${ink}">${x(d.alert_short)}</text>
  <text x="${W - 44}" y="${H - 18}" text-anchor="end" font-family="Manrope" font-weight="600" font-size="18" fill="${mute}">оновлено ${x(d.updated)}</text>
</svg>`;
}
export async function widgetPng(d: Awaited<ReturnType<typeof widgetData>>, dark = true) {
  wasmReady ??= initWasm(wasmLoad());
  await wasmReady;
  fonts ??= await fontLoad();
  const r = new Resvg(widgetSvg(d, dark), { font: { fontBuffers: fonts, defaultFontFamily: "Manrope", loadSystemFonts: false }, fitTo: { mode: "width", value: 800 } });
  return r.render().asPng();
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const k = url.searchParams.get("k");
  if (k) {
    if (!/^[\w-]{20,64}$/.test(k)) return json({ error: "bad key" }, 403);
    const [row] = await sql`select value from energy.settings where key=${"wkey_h:" + await sha(k)}`;
    const [m] = row ? await sql`select id from energy.members where id=${Number(row.value)} and active` : [];
    if (!m) return json({ error: "Посилання віджета недійсне — створіть нове у «Світлиці»" }, 403);
    const d = await widgetData(m.id);
    if (url.searchParams.get("fmt") === "png") {
      try {
        const png = await widgetPng(d, url.searchParams.get("theme") !== "light");
        return new Response(png as unknown as BodyInit, { headers: { ...CORS, "content-type": "image/png", "cache-control": "no-store" } });
      } catch (e) { console.error("png", e); return json({ error: "Не вдалося намалювати віджет" }, 500); }
    }
    if (url.searchParams.get("fmt") === "text") return new Response(d.line, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    return json(d);
  }
  if (req.method !== "POST") return json({ ok: true, service: "svit-widget" });
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "Невірний запит" }, 400); }
  const me = await checkToken((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!me) return json({ ok: false, error: "auth" }, 401);
  if (b.action === "widget_key") {
    // нове посилання; старе одразу перестає працювати
    const [old] = await sql`select value from energy.settings where key=${"wkey_m:" + me.id}`;
    if (old?.value) await sql`delete from energy.settings where key=${"wkey_h:" + old.value}`;
    const key = b64u(crypto.getRandomValues(new Uint8Array(24))), h = await sha(key);
    await sql`insert into energy.settings(key, value) values(${"wkey_h:" + h}, ${String(me.id)}), (${"wkey_m:" + me.id}, ${h})
      on conflict (key) do update set value=excluded.value`;
    return json({ ok: true, url: `${env("SUPABASE_URL")}/functions/v1/svit-widget?k=${key}`, preview: await widgetData(me.id) });
  }
  if (b.action === "widget_off") {
    const [old] = await sql`select value from energy.settings where key=${"wkey_m:" + me.id}`;
    if (old?.value) await sql`delete from energy.settings where key in ${sql(["wkey_h:" + old.value, "wkey_m:" + me.id])}`;
    return json({ ok: true });
  }
  if (b.action === "widget_status") {
    const [old] = await sql`select 1 from energy.settings where key=${"wkey_m:" + me.id}`;
    return json({ ok: true, active: !!old, preview: await widgetData(me.id) });
  }
  return json({ ok: false, error: "Невідома дія" }, 400);
}
if (!env("WIDGET_TEST")) Deno.serve(handler);
