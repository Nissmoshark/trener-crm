// «Світлиця» · повітряні цілі на карті
// Джерело — офіційний канал Повітряних сил ЗСУ (t.me/kpszsu, публічна вебверсія). Повідомлення розбираються
// на окремі цілі: тип (шахед, реактивний БпЛА, ракета, КАБ, балістика), область, напрямок і населений пункт;
// населені пункти геокодуються (OpenStreetMap Nominatim) і кешуються. Позиції орієнтовні.
//   POST {action:"air"}   (Authorization: Bearer <токен «Світлиці»>)
//   POST ?tick=<secret>   — cron щохвилини: оновити, якщо карту нещодавно відкривали
import postgres from "npm:postgres@3.4.5";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
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

// ───────────── Області: центри й форми назв ─────────────
type Obl = { name: string; lat: number; lon: number; re: RegExp };
export const OBL: Record<string, Obl> = {
  kyivcity: { name: "Київ", lat: 50.45, lon: 30.52, re: /(^|[^а-яіїєґ'ʼ’])(київ|києва|києві|києвом)(?![а-яіїєґщ])/i },
  kyiv: { name: "Київська область", lat: 50.35, lon: 30.45, re: /київщин|київськ\S* обл/i },
  zhytomyr: { name: "Житомирська область", lat: 50.45, lon: 28.5, re: /житомирщин|житомирськ\S* обл/i },
  vinnytsia: { name: "Вінницька область", lat: 49.1, lon: 28.6, re: /вінниччин|вінницьк\S* обл/i },
  volyn: { name: "Волинська область", lat: 51.15, lon: 25.0, re: /волин[ьіі]|волинськ\S* обл/i },
  dnipro: { name: "Дніпропетровська область", lat: 48.35, lon: 35.0, re: /дніпропетровщин|дніпровщин|дніпропетровськ\S* обл/i },
  donetsk: { name: "Донецька область", lat: 48.3, lon: 37.6, re: /донеччин|донецьк\S* обл/i },
  zakarpattia: { name: "Закарпатська область", lat: 48.45, lon: 23.3, re: /закарпатт/i },
  zaporizhzhia: { name: "Запорізька область", lat: 47.55, lon: 35.6, re: /запоріжж|запорізьк\S* обл/i },
  ifrankivsk: { name: "Івано-Франківська область", lat: 48.75, lon: 24.6, re: /франківщин|прикарпатт|франківськ\S* обл/i },
  kirovohrad: { name: "Кіровоградська область", lat: 48.5, lon: 32.0, re: /кіровоградщин|кропивниччин|кіровоградськ\S* обл/i },
  luhansk: { name: "Луганська область", lat: 48.9, lon: 39.0, re: /луганщин|луганськ\S* обл/i },
  lviv: { name: "Львівська область", lat: 49.75, lon: 24.0, re: /львівщин|львівськ\S* обл/i },
  mykolaiv: { name: "Миколаївська область", lat: 47.4, lon: 31.9, re: /миколаївщин|миколаївськ\S* обл/i },
  odesa: { name: "Одеська область", lat: 46.8, lon: 30.0, re: /одещин|одеськ\S* обл/i },
  poltava: { name: "Полтавська область", lat: 49.6, lon: 34.0, re: /полтавщин|полтавськ\S* обл/i },
  rivne: { name: "Рівненська область", lat: 51.0, lon: 26.4, re: /рівненщин|рівненськ\S* обл/i },
  sumy: { name: "Сумська область", lat: 50.9, lon: 34.0, re: /сумщин|сумськ\S* обл/i },
  ternopil: { name: "Тернопільська область", lat: 49.45, lon: 25.6, re: /тернопільщин|тернопільськ\S* обл/i },
  kharkiv: { name: "Харківська область", lat: 49.6, lon: 36.5, re: /харківщин|харківськ\S* обл|слобожанщин/i },
  kherson: { name: "Херсонська область", lat: 46.75, lon: 33.3, re: /херсонщин|херсонськ\S* обл/i },
  khmelnytskyi: { name: "Хмельницька область", lat: 49.4, lon: 27.0, re: /хмельниччин|хмельницьк\S* обл/i },
  cherkasy: { name: "Черкаська область", lat: 49.2, lon: 31.6, re: /черкащин|черкаськ\S* обл/i },
  chernivtsi: { name: "Чернівецька область", lat: 48.3, lon: 25.9, re: /чернівеччин|буковин|чернівецьк\S* обл/i },
  chernihiv: { name: "Чернігівська область", lat: 51.3, lon: 32.0, re: /чернігівщин|чернігівськ\S* обл/i },
  crimea: { name: "Крим", lat: 45.3, lon: 34.4, re: /крим/i },
  sea: { name: "Чорне море", lat: 45.6, lon: 31.5, re: /чорн\S* мор|акваторі/i },
};
const OBL_ORDER = Object.keys(OBL).filter((k) => k !== "kyivcity").concat("kyivcity");
export function findRegion(t: string): string | null {
  // найраніша згадка в тексті — область, де ціль зараз
  let best: [number, string] | null = null;
  for (const k of OBL_ORDER) {
    const re = new RegExp(OBL[k].re.source, "gi");
    for (const m of t.matchAll(re)) {
      const at = (m.index ?? 0) + (m[1]?.length ?? 0);
      // «курс на Київщину» — це куди летить, а не де зараз
      if (/курс(?:ом)?\s+на\s*$|напрямку\s*$/i.test(t.slice(Math.max(0, at - 16), at))) continue;
      if (!best || at < best[0]) best = [at, k];
      break;
    }
  }
  return best?.[1] ?? null;
}
const isRegionWord = (w: string) => OBL_ORDER.some((k) => k !== "kyivcity" && (OBL[k].re.test(w) || OBL[k].re.test(w + " обл")));
const regionOfWord = (w: string) => OBL_ORDER.find((k) => k !== "kyivcity" && (OBL[k].re.test(w) || OBL[k].re.test(w + " обл"))) ?? null;

// ───────────── Розбір повідомлень ─────────────
export type Kind = "drone" | "jet" | "missile" | "kab" | "ballistic";
export type Target = {
  id: string; kind: Kind; lat: number; lon: number; heading: number | null; precise: boolean;
  label: string; region: string | null; text: string; ts: number; post: string; count?: number;
};
type Parsed = { kind: Kind; region: string | null; part: [number, number] | null; at: string | null; dest: string | null; destRegion: string | null; heading: number | null; text: string; count: number; more?: string[] };

const KIND_TTL: Record<Kind, number> = { drone: 45, jet: 30, missile: 15, kab: 12, ballistic: 6 };
export function kindOf(t: string, prev: Kind | null): Kind | null {
  if (/балістик|іскандер|кинджал|циркон/i.test(t)) return "ballistic";
  if (/(^|[^а-яіїєґ])КАБ|керован\S* авіабомб/i.test(t)) return "kab";
  if (/реактивн/i.test(t) || t.includes("🏍")) return "jet";
  if (/крилат|ракет|калібр|х-?\d{2}/i.test(t) || t.includes("🚀")) return "missile";
  if (/бпла|шахед|дрон|безпілот|ударн|🛵/i.test(t)) return "drone";
  return prev;
}
const PARTS: [RegExp, [number, number]][] = [
  [/на\s+північному\s+сході|на\s+північн\S*-східн/i, [0.35, 0.55]], [/на\s+північному\s+заході|на\s+північн\S*-західн/i, [0.35, -0.55]],
  [/на\s+південному\s+сході|на\s+південн\S*-східн/i, [-0.35, 0.55]], [/на\s+південному\s+заході|на\s+південн\S*-західн/i, [-0.35, -0.55]],
  [/на\s+(півночі|північ\s+)|північн\S+\s+частин/i, [0.45, 0]], [/на\s+(півдні|південь\s+)|південн\S+\s+частин/i, [-0.45, 0]],
  [/на\s+(сході|схід\s+)|східн\S+\s+частин/i, [0, 0.7]], [/на\s+(заході|захід\s+)|західн\S+\s+частин/i, [0, -0.7]],
];
const DIRS: [RegExp, number][] = [
  [/північно-?східн|північн\S* схід/i, 45], [/північно-?західн|північн\S* захід/i, 315], [/південно-?східн|південн\S* схід/i, 135], [/південно-?західн|південн\S* захід/i, 225],
  [/північ/i, 0], [/південь|південн/i, 180], [/схід|східн/i, 90], [/захід|західн/i, 270],
];
const FROM_SIDE: [RegExp, number][] = [[/з\s+півночі/i, 180], [/з\s+півдня/i, 0], [/(зі|з)\s+сходу/i, 270], [/(із|з)\s+заходу/i, 90]];
const PLACE = String.raw`((?:н\.\s?п\.\s*|м\.\s*|смт\.?\s*|с\.\s*)?[А-ЯІЇЄҐ][а-яіїєґ'ʼ’\-]+(?:[\s\-][А-ЯІЇЄҐ][а-яіїєґ'ʼ’\-]+)?(?:\s\([А-ЯІЇЄҐ][^)]{1,30}\))?)`;
const cleanPlace = (p: string) => p.replace(/^(н\.\s?п\.|м\.|смт\.?|с\.)\s*/i, "").replace(/\s*\(.*\)$/, "").trim();
export function parseLine(raw: string, prevKind: Kind | null, ctxRegion: string | null): Parsed | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || /відбій|збит|знешкод|уражен|загроз[аи] застосування|увага!? (?:загроза )?балістик/i.test(t) && !/курс|напрям|на\s+[А-ЯІЇЄҐ]/.test(t)) {
    if (/загроз[аи] застосування|балістик/i.test(t) && !/відбій/i.test(t)) {
      return { kind: "ballistic", region: findRegion(t) ?? ctxRegion, part: null, at: null, dest: null, destRegion: null, heading: null, text: t, count: 1 };
    }
    return null;
  }
  const kind = kindOf(t, prevKind);
  if (!kind) return null;
  let region = findRegion(t) ?? ctxRegion;
  let part: [number, number] | null = null;
  for (const [re, off] of PARTS) if (re.test(t)) { part = off; break; }
  let at: string | null = null, dest: string | null = null, destRegion: string | null = null, heading: number | null = null;
  const mAt = new RegExp(String.raw`(?:повз|в районі|в р-ні|над|біля|поблизу|неподалік)\s+` + PLACE, "u").exec(t);
  if (mAt && !isRegionWord(mAt[1])) at = cleanPlace(mAt[1]);
  const mCourse = new RegExp(String.raw`курс(?:ом)?\s+(?:на\s+)?` + PLACE, "u").exec(t);
  const mOn = new RegExp(String.raw`(?:^|[\s,.:])(?:[Нн]а|[УуВв] напрямку)\s+` + PLACE, "u").exec(t);
  const cand = mCourse?.[1] ?? mOn?.[1] ?? null;
  if (cand) {
    if (isRegionWord(cand)) {
      destRegion = regionOfWord(cand);
      const inner = /\(([^)]+)\)/.exec(cand); // «на Житомирщину(Черняхів)»
      if (inner) dest = cleanPlace(inner[1]);
    } else dest = cleanPlace(cand);
  }
  // «курсом на Балаклію та на Чугуїв»
  const more: string[] = [];
  if (dest) for (const mm of t.matchAll(new RegExp(String.raw`(?:\sта|,)\s+(?:на\s+)` + PLACE, "gu"))) { const x = cleanPlace(mm[1]); if (x !== dest && !isRegionWord(mm[1])) more.push(x); }
  const inParen = /(?:щин[уиі]|ччин[уиі])\s*\(([А-ЯІЇЄҐ][^)]{1,30})\)/u.exec(t);
  if (!dest && inParen) dest = cleanPlace(inParen[1]);
  const mDir = /курс(?:ом)?\s+на\s+(північ\S*|південь\S*|південн\S*|схід\S*|захід\S*)|на\s+(\S+-\S+|північн\S*|південн\S*|східн\S*|західн\S*)\s+напрям/i.exec(t);
  if (mDir) { const w = mDir[1] ?? mDir[2]; for (const [re, h] of DIRS) if (re.test(w)) { heading = h; break; } }
  if (heading == null) for (const [re, h] of FROM_SIDE) if (re.test(t)) { heading = h; break; }
  if (dest && /^(Київ|Києва)$/.test(dest) && region === "kyivcity") region = ctxRegion ?? region;
  const cnt = /(\d+)\s*(?:х|шт|од)?\s*(?:БпЛА|ударн|шахед|ракет|крилат)/i.exec(t) ?? /(?:груп[аи])\s+(?:з\s+)?(\d+)/i.exec(t);
  const count = cnt ? Math.min(50, Number(cnt[1])) : /груп/i.test(t) ? 3 : /\b(БпЛА|ракети)\b.*\bта\b/i.test(t) ? 2 : 1;
  // уточнення в гілці: просто назва району чи пункту — «Куренівка.»
  if (!at && !dest && !destRegion && prevKind) { const bare = new RegExp("^" + PLACE + "\\.?$", "u").exec(t); if (bare) at = cleanPlace(bare[1]); }
  if (!region && !at && !dest && !destRegion) return null;
  return { kind, region, part, at, dest, destRegion, heading, text: t, count, more };
}

// HTML вебверсії каналу → повідомлення
const decode = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
export type Msg = { post: string; ts: number; text: string; reply: string | null; replyPost: string | null };
export function parseChannel(html: string): Msg[] {
  const out: Msg[] = [];
  for (const chunk of html.split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = /data-post="([^"]+)"/.exec(chunk)?.[1];
    const dt = /<time datetime="([^"]+)"/.exec(chunk)?.[1];
    const body = /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1];
    if (!post || !dt || body == null) continue;
    const reply = /js-message_reply_text"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1];
    const rp = /tgme_widget_message_reply[^>]*href="https?:\/\/t\.me\/([^"?]+)"/.exec(chunk)?.[1] ?? null;
    out.push({ post, ts: Date.parse(dt), text: decode(body), reply: reply != null ? decode(reply) : null, replyPost: rp });
  }
  return out;
}

// ───────────── Геокодування ─────────────
export let geoSearch = async (q: string): Promise<any[]> => {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ua&accept-language=uk&limit=5&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "svitlytsia-family-app/1.0 (air targets map)" }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error("nominatim " + r.status);
  return await r.json();
};
export function setGeoSearch(f: (q: string) => Promise<any[]>) { geoSearch = f; }
// Знахідний відмінок → називний: «на Балаклію» → Балаклія, «на Христинівку» → Христинівка
export function nameVariants(n: string) {
  const v: string[] = [];
  if (/ю$/.test(n)) v.push(n.replace(/ю$/, "я"));
  if (/у$/.test(n)) v.push(n.replace(/у$/, "а"));
  if (/ого$/.test(n)) v.push(n.replace(/ого$/, "е"));
  v.push(n);
  if (/а$/.test(n)) v.push(n.replace(/а$/, ""));
  return [...new Set(v)];
}
const GOOD = new Set(["city", "town", "village", "hamlet", "suburb", "quarter", "neighbourhood", "borough", "municipality", "city_district", "locality", "isolated_dwelling"]);
let geoBudget = 0;
export let geoCache = {
  async get(key: string) { const [c] = await sql`select area from energy.geo_cache where key=${key}`; return c ? c.area : undefined; },
  async set(key: string, v: unknown) { await sql`insert into energy.geo_cache(key, area, at) values(${key}, ${sql.json(v as any)}, now()) on conflict (key) do update set area=excluded.area, at=now()`; },
};
export function setGeoCache(c: typeof geoCache) { geoCache = c; }
export let geoDelay = 1100;
export function setGeoDelay(n: number) { geoDelay = n; }
export function setGeoBudget(n: number) { geoBudget = n; }
type Geo = { lat: number; lon: number; name: string };
async function geocode(name: string, region: string | null): Promise<Geo | null> {
  const key = `air:${name}|${region ?? ""}`;
  const c = await geoCache.get(key);
  if (c) return c.none ? null : c;
  if (geoBudget <= 0) return undefined as unknown as null; // ще не шукали — спробуємо наступного разу
  let found: Geo | null = null;
  const ctx = region && OBL[region] ? OBL[region] : null;
  for (const v of nameVariants(name)) {
    if (geoBudget-- <= 0) return undefined as unknown as null;
    const q = ctx && region !== "sea" ? (region === "kyivcity" ? `${v}, Київ` : `${v}, ${ctx.name}`) : v;
    let res: any[] = [];
    try { res = await geoSearch(q); } catch { return undefined as unknown as null; }
    if (geoDelay) await new Promise((r) => setTimeout(r, geoDelay)); // правила Nominatim: не частіше 1 запиту на секунду
    const hit = res.find((x) => GOOD.has(x.addresstype) || x.category === "place" || x.class === "place") ?? null;
    if (hit) {
      const lat = +hit.lat, lon = +hit.lon;
      // занадто далеко від області — мабуть, однойменне село деінде
      if (!ctx || region === "sea" || Math.hypot(lat - ctx.lat, (lon - ctx.lon) * 0.65) < 2.2) { found = { lat, lon, name: v }; break; }
    }
  }
  await geoCache.set(key, found ?? { none: true });
  return found;
}
const bearing = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return Math.round(((Math.atan2(y, x) / r) + 360) % 360);
};

// ───────────── Збирання цілей ─────────────
export let channelGet = async (): Promise<string> => {
  const r = await fetch("https://t.me/s/kpszsu", { headers: { "User-Agent": "Mozilla/5.0 (svitlytsia family app)", "Accept-Language": "uk" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error("t.me " + r.status);
  return await r.text();
};
export function setChannelGet(f: () => Promise<string>) { channelGet = f; }

export async function buildTargets(msgs: Msg[], now = nowMs()) {
  const fresh = msgs.filter((m) => now - m.ts < 60 * 60_000 && m.ts <= now + 60_000).sort((a, b) => a.ts - b.ts);
  const byKey = new Map<string, Target>();
  const meta = new Map<string, { dest: string | null; at: string | null; region: string | null }>();
  const keysOf = new Map<string, string[]>(), ctxOf = new Map<string, { kind: Kind | null; region: string | null }>();
  let pending = 0;
  for (const m of fresh) {
    const parent = m.replyPost ? ctxOf.get(m.replyPost) : undefined;
    const ctxKind = parent?.kind ?? (m.reply ? kindOf(m.reply, null) : null);
    const ctxRegion = parent?.region ?? (m.reply ? findRegion(m.reply) : null);
    // уточнення у відповідь на попереднє повідомлення замінює ту ціль
    if (m.replyPost) for (const k of keysOf.get(m.replyPost) ?? []) byKey.delete(k);
    let prevKind: Kind | null = ctxKind, myRegion = ctxRegion;
    const myKeys: string[] = [];
    for (const line of m.text.split("\n")) {
      const p0 = parseLine(line, prevKind, ctxRegion);
      if (!p0) continue;
      for (const p of [p0, ...(p0.more ?? []).map((d) => ({ ...p0, dest: d, more: [] }))]) {
      prevKind = p.kind;
      if (p.dest && /^(Київ|Києва)$/.test(p.dest)) myRegion = "kyivcity"; else if (p.region) myRegion = p.region;
      if (now - m.ts > KIND_TTL[p.kind] * 60_000) continue;
      const reg = p.region && OBL[p.region] ? OBL[p.region] : null;
      let pos: { lat: number; lon: number } | null = null, precise = false, heading = p.heading, label = "";
      const geoRegion = p.region ?? p.destRegion;
      if (p.at) { const g = await geocode(p.at, geoRegion); if (g === undefined) pending++; if (g) { pos = g; precise = true; label = g.name; } }
      let destPos: Geo | null = null;
      if (p.dest) { const g = await geocode(p.dest, p.destRegion ?? p.region); if (g === undefined) pending++; if (g) destPos = g; }
      const origin = reg ? { lat: reg.lat + (p.part?.[0] ?? 0), lon: reg.lon + (p.part?.[1] ?? 0) } : null;
      if (!pos && destPos) {
        // ціль ще на підльоті — ставимо між районом області й пунктом призначення, ближче до пункту
        if (origin && Math.hypot(origin.lat - destPos.lat, origin.lon - destPos.lon) > 0.25) {
          pos = { lat: destPos.lat + (origin.lat - destPos.lat) * 0.3, lon: destPos.lon + (origin.lon - destPos.lon) * 0.3 };
          if (heading == null) heading = bearing(pos, destPos);
        } else pos = destPos;
      } else if (pos && destPos && heading == null) heading = bearing(pos, destPos);
      else if (pos && !destPos && p.destRegion && p.destRegion !== p.region && heading == null && OBL[p.destRegion]) heading = bearing(pos, OBL[p.destRegion]);
      if (!pos && origin) { pos = origin; if (heading == null && p.destRegion && p.destRegion !== p.region && OBL[p.destRegion]) heading = bearing(origin, OBL[p.destRegion]); }
      if (!pos && p.destRegion) { const r = OBL[p.destRegion]; pos = { lat: r.lat, lon: r.lon }; }
      if (!pos) continue;
      if (p.dest) label = (label ? label + " → " : "→ ") + (destPos?.name ?? p.dest);
      else if (p.destRegion) label = (label ? label + " → " : "→ ") + OBL[p.destRegion].name.replace(" область", " обл.");
      if (!label) label = reg ? reg.name.replace(" область", " обл.") : "";
      const key = `${m.post}|${p.kind}|${p.dest ?? p.destRegion ?? ""}|${p.region ?? ""}|${p.at ?? ""}`;
      // та сама ціль у новішому повідомленні: долетіла до пункту, куди прямувала, або той самий курс
      for (const [k, v] of byKey) {
        const o = meta.get(k);
        if (!o || v.kind !== p.kind || m.ts - v.ts > 40 * 60_000) continue;
        if ((p.at && (o.dest === p.at || o.at === p.at)) || (p.dest && o.dest === p.dest && (o.region === p.region || !p.region || !o.region))) { byKey.delete(k); meta.delete(k); }
      }
      meta.set(key, { dest: p.dest, at: p.at, region: p.region });
      myKeys.push(key);
      byKey.set(key, { id: key, kind: p.kind, lat: +pos.lat.toFixed(4), lon: +pos.lon.toFixed(4), heading, precise, label,
        region: p.region ? OBL[p.region].name : null, text: p.text, ts: m.ts, post: m.post, count: p.count });
      }
    }
    keysOf.set(m.post, myKeys);
    ctxOf.set(m.post, { kind: prevKind, region: myRegion });
  }
  return { targets: [...byKey.values()].sort((a, b) => b.ts - a.ts), pending };
}

async function refresh(geoMax: number) {
  geoBudget = geoMax;
  const html = await channelGet();
  const msgs = parseChannel(html);
  const { targets, pending } = await buildTargets(msgs);
  const feed = { at: nowMs(), targets, pending, last: msgs.at(-1)?.ts ?? null, error: "" };
  await sql`insert into energy.geo_cache(key, area, at) values('air:feed', ${sql.json(feed)}, now()) on conflict (key) do update set area=excluded.area, at=now()`;
  return feed;
}
async function feedGet(force = false) {
  const [c] = await sql`select area, at from energy.geo_cache where key='air:feed'`;
  const age = c ? nowMs() - new Date(c.at).getTime() : Infinity;
  if (!force && c && age < 60_000 && !(c.area?.pending > 0 && age > 20_000)) return c.area;
  try { return await refresh(force ? 6 : 3); }
  catch (e) {
    const old = c?.area ?? { targets: [], at: 0 };
    return { ...old, error: `Канал Повітряних сил недоступний: ${e instanceof Error ? e.message : e}` };
  }
}

// ───────────── Вхід ─────────────
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
    const [m] = await sql`select id, name, role, pin_ver from energy.members where id=${p.m} and active`;
    return m && m.pin_ver === p.v ? m : null;
  } catch { return null; }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url), s = await settings();
  if (url.searchParams.has("tick")) {
    if (!s.secret || url.searchParams.get("tick") !== s.secret) return new Response("forbidden", { status: 403 });
    // оновлюємо у фоні лише тоді, коли карту хтось нещодавно відкривав
    const [v] = await sql`select at from energy.geo_cache where key='air:viewed'`;
    if (v && nowMs() - new Date(v.at).getTime() < 20 * 60_000) { try { await refresh(8); } catch (e) { console.warn("air refresh", String(e)); } }
    return json({ ok: true });
  }
  if (req.method !== "POST") return json({ ok: true, service: "svit-air" });
  const me = await checkToken((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!me) return json({ ok: false, error: "auth" }, 401);
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "Невірний запит" }, 400); }
  if (b.action !== "air") return json({ ok: false, error: "Невідома дія" }, 400);
  try {
    await sql`insert into energy.geo_cache(key, area, at) values('air:viewed', '{}', now()) on conflict (key) do update set at=now()`;
    const feed = await feedGet(!!b.refresh);
    const family = await sql`select name, lat, lon, updated_at, member_id from energy.locations where updated_at > now() - interval '3 days' order by name`;
    return json({ ok: true, ...feed, now: nowMs(), family: family.map((f) => ({ name: f.name, lat: Number(f.lat), lon: Number(f.lon), at: f.updated_at, me: f.member_id === me.id })),
      source: { name: "Повітряні сили ЗСУ", url: "https://t.me/kpszsu" } });
  } catch (e) { console.error(e); return json({ ok: false, error: "Помилка сервера" }, 500); }
}
if (!env("AIR_TEST")) Deno.serve(handler);
