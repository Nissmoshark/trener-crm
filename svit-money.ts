// «Світлиця» · гроші сімʼї: Monobank, готівка, бюджет по статтях на кожен місяць, регулярні платежі, цілі
//   POST {action,...}  (Authorization: Bearer <токен «Світлиці»>)
//   POST ?hook=<secret>&l=<link>  — вебхук Monobank
//   POST ?tick=<secret>           — cron щохвилини: черга запитів до Monobank, нагадування
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
const setSetting = (k: string, v: string) => sql`insert into energy.settings(key,value) values(${k},${v}) on conflict(key) do update set value=excluded.value`;

// ───────────── Вхід: той самий токен, що й в основному додатку ─────────────
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
type Member = { id: number; name: string; role: string; pin_ver: number };
async function checkToken(tok: string): Promise<Member | null> {
  const [payload, sig] = tok.split(".");
  if (!payload || !sig) return null;
  const s = await settings();
  if ((await hmac(s.token_secret, payload)) !== sig) return null;
  try {
    const p = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!(p.exp > nowMs()) || !p.m) return null;
    const [m] = await sql`select id, name, role, pin_ver from energy.members where id=${p.m} and active`;
    return m && m.pin_ver === p.v ? (m as unknown as Member) : null;
  } catch { return null; }
}
// Токен Monobank зберігається зашифрованим
async function bankKey() {
  const h = await crypto.subtle.digest("SHA-256", enc.encode((await settings()).token_secret + ":bank"));
  return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(s: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `${b64u(iv)}.${b64u(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await bankKey(), enc.encode(s)))}`;
}
async function decrypt(s: string) {
  const [iv, d] = s.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await bankKey(), unb64u(d)));
}

// ───────────── Monobank ─────────────
export let monoFetch = async (path: string, token: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const r = await fetch(`https://api.monobank.ua${path}`, {
    method: body ? "POST" : "GET", headers: { "X-Token": token, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
export function setMonoFetch(f: typeof monoFetch) { monoFetch = f; }
const CARD: Record<string, string> = { black: "Чорна", white: "Біла", platinum: "Platinum", iron: "Iron", yellow: "Дитяча", fop: "ФОП", eAid: "єПідтримка", madeInUkraine: "Зроблено в Україні", rebuilding: "Відновлення" };
const CUR: Record<number, string> = { 980: "₴", 840: "$", 978: "€", 985: "zł", 826: "£" };
// Не витрати: перекази між своїми й надходження
const NOT_SPEND = ["Перекази", "Надходження"];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const MCC: [string, number[]][] = [
  ["Продукти", [5411, 5422, 5441, 5451, 5462, 5499, 5300, 5331]],
  ["Кафе й ресторани", [5812, 5813, 5814]],
  ["Транспорт і авто", [4111, 4112, 4121, 4131, 4784, 7523, 5541, 5542, 5983, 5172, 7531, 7534, 7535, 7538, 7542, 7549, 5532, 5533, 5511, 5521]],
  ["Здоровʼя й аптека", [5912, 5122, 5047, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099]],
  ["Комуналка й звʼязок", [4900, 4814, 4816, 4899]],
  ["Діти", [5641, 5945, 8211, 8220, 8241, 8244, 8249, 8299, 8351]],
  ["Одяг і взуття", [5611, 5621, 5631, 5651, 5655, 5661, 5681, 5691, 5697, 5698, 5699, 5948]],
  ["Дім і техніка", [5039, 5045, 5065, 5200, 5211, 5231, 5251, 5261, 5712, 5713, 5714, 5718, 5719, 5722, 5732, 5733, 5734, 5946, 7622, 7629]],
  ["Розваги й підписки", [5815, 5816, 5817, 5818, 7832, 7841, 7922, 7929, 7932, 7933, 7941, 7991, 7992, 7993, 7994, 7996, 7997, 7998, 7999, 5735, 5942, 5994]],
  ["Подорожі", [...range(3000, 3999), 4411, 4511, 4582, 4722, 7011, 7012, 7032, 7033, 7512, 7513, 7519]],
  ["Краса", [5977, 7230, 7297, 7298]],
  ["Тварини", [742, 5995]],
  ["Готівка", [6010, 6011]],
  ["Перекази", [4829, 6012, 6050, 6051, 6211, 6513, 6529, 6530, 6533, 6534, 6536, 6537, 6538, 6540]],
];
const BY_MCC = new Map<number, string>();
for (const [c, l] of MCC) for (const m of l) BY_MCC.set(m, c);
const BY_TEXT: [string, RegExp][] = [
  ["Продукти", /сільпо|атб|novus|новус|фора|varus|варус|ашан|auchan|metro cash|фуршет|еко ?маркет|eko|велмарт|лоток|glovo.*маркет|fozzy|копійочка|рукавичка/i],
  ["Транспорт і авто", /uklon|uber|bolt|okko|окко|wog|socar|upg|shell|amic|brsm|укрзалізниця|kyiv ?digital|метро|паркінг|parking/i],
  ["Кафе й ресторани", /glovo|bolt food|mcdonald|kfc|пузата|lviv croissants|aroma|coffee|кав'ярня|кафе|ресторан|піца|sushi|суші/i],
  ["Здоровʼя й аптека", /аптека|apteka|аптека доброго дня|подорожник|ан[ц]|синево|сінево|dila|діла|добробут|клініка/i],
  ["Комуналка й звʼязок", /київстар|kyivstar|vodafone|водафон|lifecell|лайфсел|воля|volia|ланет|lanet|yasno|ясно|київгаз|газмережі|нафтогаз|водоканал|київтеплоенерго|осбб|дтек|комунал/i],
  ["Розваги й підписки", /netflix|spotify|youtube|apple\.com|google|megogo|sweet\.tv|кінотеатр|multiplex|планета кіно|steam|playstation/i],
  ["Дім і техніка", /епіцентр|epicentr|rozetka|розетка|comfy|фокстрот|foxtrot|eldorado|ельдорадо|jysk|ikea|leroy|нова лінія/i],
  ["Одяг і взуття", /zara|h&m|reserved|lc waikiki|answear|makeup|intertop|mango|sinsay/i],
  ["Перекази", /переказ|з картки|на картку|поповнення|переказ між|send\.monobank|банка/i],
];
export function categorize(mcc: number | null, desc: string, amount: number) {
  if (amount > 0) return "Надходження";
  for (const [c, re] of BY_TEXT) if (re.test(desc)) return c;
  return (mcc && BY_MCC.get(mcc)) || "Інше";
}
// Статті: вбудовані + додані сімʼєю
const BASE_EXPENSE = [...MCC.map((m) => m[0]).filter((c) => !NOT_SPEND.includes(c)), "Інше"];
const BASE_INCOME = ["Зарплата", "Підробіток", "Подарунки", "Кешбек і відсотки", "Надходження"];
async function categoryLists() {
  const custom = (await sql`select id, name, kind, icon from energy.money_categories where active order by kind, name`).map((c) => ({ id: Number(c.id), name: c.name, kind: c.kind, icon: c.icon }));
  const uniq = (a: string[]) => [...new Set(a)];
  const expense = uniq([...BASE_EXPENSE.slice(0, -1), ...custom.filter((c) => c.kind === "expense").map((c) => c.name), "Інше"]);
  const income = uniq([...BASE_INCOME.slice(0, -1), ...custom.filter((c) => c.kind === "income").map((c) => c.name), "Надходження"]);
  return { expense, income, custom };
}

async function saveTxn(link: any, account: string, t: any, currency: number) {
  const amount = Number(t.amount) / 100, desc = String(t.description ?? "").slice(0, 200), cat = categorize(t.mcc ?? null, desc, amount);
  await sql`insert into energy.txns(id, member_id, link_id, account, ts, amount, currency, description, mcc, category, comment, counter, source)
    values(${String(t.id)}, ${link.member_id}, ${link.id}, ${account}, ${new Date(Number(t.time) * 1000)}, ${amount}, ${currency}, ${desc}, ${t.mcc ?? null}, ${cat},
      ${t.comment ? String(t.comment).slice(0, 200) : null}, ${t.counterName ?? null}, 'mono')
    on conflict (id) do update set amount=excluded.amount, description=excluded.description, ts=excluded.ts,
      category=case when energy.txns.cat_manual then energy.txns.category else excluded.category end`;
  if (t.balance != null) {
    await sql`update energy.bank_links set balances = jsonb_set(balances, ${[account]}::text[], ${sql.json({ b: Number(t.balance) / 100, t: Number(t.time) })})
      where id=${link.id} and coalesce((balances->(${account}::text)->>'t')::bigint, 0) <= ${Number(t.time)}`;
  }
}
const hookUrl = (linkId: number) => `${env("SUPABASE_URL")}/functions/v1/svit-money?hook=${S.secret}&l=${linkId}`;
async function applyInfo(link: any, info: any) {
  const t = Math.floor(nowMs() / 1000), balances = { ...(link.balances ?? {}) };
  const accounts = (link.accounts ?? []).map((a: any) => {
    const x = (info.accounts ?? []).find((y: any) => y.id === a.id);
    if (x) balances[a.id] = { b: Number(x.balance) / 100, t };
    return x ? { ...a, credit: Number(x.creditLimit ?? 0) / 100 } : a;
  });
  const jars = (info.jars ?? []).map((j: any) => ({ id: j.id, title: j.title, balance: Number(j.balance) / 100, goal: j.goal ? Number(j.goal) / 100 : null, currency: j.currencyCode }));
  await sql`update energy.bank_links set accounts=${sql.json(accounts)}, balances=${sql.json(balances)}, jars=${sql.json(jars)} where id=${link.id}`;
}
// Черга запитів: Monobank дозволяє один запит на хвилину на токен
export async function tick() {
  await settings(true);
  const now = nowMs();
  for (const link of await sql`select * from energy.bank_links where next_call_at <= ${new Date(now)} order by id`) {
    let queue: any[] = link.queue ?? [];
    const accs: any[] = link.accounts ?? [];
    if (!queue.length && (!link.last_sync || now - new Date(link.last_sync).getTime() > 6 * 3600_000)) {
      queue = [{ op: "info" }, ...accs.filter((a) => a.include).map((a) => ({ op: "stmt", acc: a.id, from: Math.floor(now / 1000) - 2 * 86400, to: Math.floor(now / 1000) }))];
      if (!queue.length) { await sql`update energy.bank_links set last_sync=${new Date(now)} where id=${link.id}`; continue; }
    }
    if (!queue.length) continue;
    const job = queue[0];
    let token: string;
    try { token = await decrypt(link.token_enc); }
    catch { await sql`update energy.bank_links set last_error='Не вдалося прочитати токен — підключіть ще раз' where id=${link.id}`; continue; }
    let r;
    try {
      r = job.op === "hook" ? await monoFetch("/personal/webhook", token, { webHookUrl: hookUrl(link.id) })
        : job.op === "info" ? await monoFetch("/personal/client-info", token)
        : await monoFetch(`/personal/statement/${job.acc}/${job.from}/${job.to}`, token);
    } catch (e) {
      await sql`update energy.bank_links set next_call_at=${new Date(now + 61_000)}, last_error=${"Monobank не відповідає: " + String(e).slice(0, 80)} where id=${link.id}`;
      continue;
    }
    if (r.status === 429) { await sql`update energy.bank_links set next_call_at=${new Date(now + 65_000)} where id=${link.id}`; continue; }
    if (r.status === 401 || r.status === 403) {
      await sql`update energy.bank_links set queue='[]', next_call_at=${new Date(now + 3600_000)}, last_error='Токен Monobank більше не дійсний — підключіть ще раз' where id=${link.id}`;
      continue;
    }
    queue = queue.slice(1);
    let hookOk = link.hook_ok, err: string | null = null;
    if (job.op === "hook") { hookOk = r.status === 200; if (!hookOk) err = "Не вдалося увімкнути миттєві оновлення, операції підтягуватимуться раз на 6 год"; }
    else if (job.op === "info") { if (r.status === 200) await applyInfo(link, r.json); }
    else if (r.status === 200 && Array.isArray(r.json)) {
      const cur = accs.find((a) => a.id === job.acc)?.currency ?? 980;
      for (const t of r.json) await saveTxn(link, job.acc, t, cur);
      if (r.json.length >= 500) queue.unshift({ op: "stmt", acc: job.acc, from: job.from, to: Math.min(...r.json.map((t: any) => Number(t.time))) - 1 });
    } else err = `Monobank: ${r.json?.errorDescription ?? "HTTP " + r.status}`;
    await sql`update energy.bank_links set queue=${sql.json(queue)}, hook_ok=${hookOk}, next_call_at=${new Date(now + 61_000)},
      last_sync=${queue.length ? link.last_sync : new Date(now)}, last_error=${err} where id=${link.id}`;
  }
  await weekly();
  try { await plannerNotify(); } catch (e) { console.error("planner notify", e); }
}

// ───────────── Час, гроші, Telegram ─────────────
const ldtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hour12: false });
function local(ms = nowMs()) {
  const o: Record<string, string> = {};
  for (const p of ldtf.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { day: `${o.year}-${o.month}-${o.day}`, hour: +o.hour % 24, wd: o.weekday };
}
const UAH = (v: number) => Math.round(v).toLocaleString("uk-UA").replace(/ /g, " ") + " ₴";
export let tgSend = async (token: string, chat: string, text: string) => {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: Number(chat), text, parse_mode: "HTML" }) });
};
export function setTgSend(f: typeof tgSend) { tgSend = f; }
async function weekly() {
  const l = local();
  if (l.wd !== "Mon" || l.hour < 10 || S.money_week === l.day || !S.chat_id || !S.bot_token) return;
  const [{ n }] = await sql`select count(*)::int n from energy.bank_links`;
  await setSetting("money_week", l.day);
  const [{ m }] = await sql`select count(*)::int m from energy.txns where source='manual' and ts > ${new Date(nowMs() - 7 * 864e5)}`;
  if (!n && !m) return;
  const rows = await sql`select category, sum(-amount)::float s from energy.txns where ts > ${new Date(nowMs() - 7 * 864e5)} and amount < 0 and currency=980
    and not hidden and category <> all(${NOT_SPEND}) group by category order by s desc`;
  if (!rows.length) return;
  const tot = rows.reduce((a, r) => a + r.s, 0);
  await tgSend(S.bot_token, S.chat_id, `💳 <b>Витрати сімʼї за тиждень: ${UAH(tot)}</b>\n${rows.slice(0, 5).map((r) => `• ${r.category} — ${UAH(r.s)}`).join("\n")}`);
}

class ApiError extends Error {}
const monthRange = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return [`${y}-${String(mo).padStart(2, "0")}-01`, mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`];
};
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
async function myLinks(me: Member) {
  return (await sql`select id, client_name, accounts, share, hook_ok, last_sync, last_error, jsonb_array_length(queue) pending from energy.bank_links where member_id=${me.id} order by id`)
    .map((l) => ({ ...l, pending: Number(l.pending) }));
}
const isSpend = (t: any) => Number(t.amount) < 0 && t.currency === 980 && !t.hidden && !NOT_SPEND.includes(t.category);
const isIncome = (t: any) => Number(t.amount) > 0 && t.currency === 980 && !t.hidden && t.category !== "Перекази";
export function planDue(p: any, month: string) {
  if (p.every === "year" && Number(month.slice(5, 7)) !== Number(p.month)) return null;
  const [y, m] = month.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(p.day), last)).padStart(2, "0")}`;
}
async function plansFor(month: string, txns: any[]) {
  const plans = await sql`select * from energy.money_plans where active order by day, id`;
  const used = new Set<string>(), today = local().day, out: any[] = [];
  for (const p of plans) {
    const due = planDue(p, month); if (!due) continue;
    let paid = p.paid?.[month] ?? null;
    if (!paid) {
      const amt = Number(p.amount), dueMs = Date.parse(due + "T12:00:00Z"), match = (p.match ?? "").trim().toLowerCase();
      const t = txns.find((x) => !used.has(x.id) && !x.hidden && (p.kind === "income" ? Number(x.amount) > 0 : Number(x.amount) < 0) && (
        (match && String(x.description ?? "").toLowerCase().includes(match)) ||
        (Math.abs(Math.abs(Number(x.amount)) - amt) <= Math.max(1, amt * 0.05) && Math.abs(+new Date(x.ts) - dueMs) <= 6 * 864e5 && (p.kind === "income" || !p.category || x.category === p.category))));
      if (t) { paid = t.id; used.add(t.id); await sql`update energy.money_plans set paid = paid || ${sql.json({ [month]: t.id })} where id=${p.id}`; }
    }
    out.push({ id: p.id, title: p.title, kind: p.kind, amount: Number(p.amount), category: p.category, day: p.day, every: p.every, month: p.month, match: p.match,
      remind_days: p.remind_days, due, paid: !!paid, auto: !!paid && paid !== "manual", overdue: !paid && due < today });
  }
  return out;
}
async function accountsInfo() {
  const links = await sql`select l.id, l.accounts, l.balances, l.jars, m.name owner from energy.bank_links l join energy.members m on m.id = l.member_id order by l.id`;
  const accounts: any[] = [];
  for (const l of links) for (const a of l.accounts ?? []) {
    if (!a.include || a.currency !== 980) continue;
    const b = l.balances?.[a.id];
    accounts.push({ id: "mono:" + a.id, kind: "mono", name: a.label, owner: l.owner, balance: b ? Math.round((b.b - (a.credit ?? 0)) * 100) / 100 : null, at: b ? b.t * 1000 : null });
  }
  const cash = await sql`select a.id, a.name, a.opening::float opening, m.name owner, a.member_id,
      coalesce((select sum(t.amount) from energy.txns t where t.account_id = a.id and (t.ts at time zone ${TZ})::date >= (a.opened_at at time zone ${TZ})::date), 0)::float moved
    from energy.money_accounts a join energy.members m on m.id = a.member_id where a.active order by a.id`;
  for (const a of cash) accounts.push({ id: "cash:" + a.id, cid: Number(a.id), kind: "cash", name: a.name, owner: a.owner, member_id: Number(a.member_id), opening: a.opening, balance: Math.round((a.opening + a.moved) * 100) / 100 });
  const jars = links.flatMap((l) => (l.jars ?? []).filter((j: any) => j.currency === 980 || !j.currency).map((j: any) => ({ ...j, owner: l.owner })));
  return { accounts, jars, total: accounts.reduce((s, a) => s + (a.balance ?? 0), 0) };
}

// ───────────── План по статтях на місяць ─────────────
// Якщо на місяць план ще не складено — береться останній попередній (переноситься автоматично).
// Рядок kind='mark' означає «план цього місяця складено» (навіть якщо всі статті прибрали).
async function budgetRows(month: string) {
  const [src] = await sql`select max(month) m from energy.money_budgets where month <= ${month}`;
  if (!src?.m) return { from: null as string | null, rows: [] as { kind: string; category: string; amount: number }[] };
  const rows = (await sql`select kind, category, amount::float amount from energy.money_budgets where month=${src.m} and kind <> 'mark' and amount > 0 order by kind, category`)
    .map((r) => ({ kind: r.kind as string, category: r.category as string, amount: Number(r.amount) }));
  return { from: src.m as string, rows };
}
async function ownBudget(month: string) {
  const [x] = await sql`select 1 from energy.money_budgets where month=${month} limit 1`;
  if (x) return;
  const { rows } = await budgetRows(month);
  await sql.begin(async (tx) => {
    await tx`insert into energy.money_budgets(month, kind, category, amount) values(${month}, 'mark', '', 0) on conflict do nothing`;
    for (const r of rows) await tx`insert into energy.money_budgets(month, kind, category, amount) values(${month}, ${r.kind}, ${r.category}, ${r.amount}) on conflict do nothing`;
  });
}

async function planner(month: string, txns: any[]) {
  const spent: Record<string, number> = {}, got: Record<string, number> = {};
  for (const t of txns.filter(isSpend)) spent[t.category] = (spent[t.category] ?? 0) - Number(t.amount);
  for (const t of txns.filter(isIncome)) got[t.category] = (got[t.category] ?? 0) + Number(t.amount);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const bud = await budgetRows(month);
  const budgets = bud.rows.filter((r) => r.kind === "expense").map((r) => ({ category: r.category, limit: r.amount, spent: r2(spent[r.category] ?? 0) }));
  const income_plan = bud.rows.filter((r) => r.kind === "income").map((r) => ({ category: r.category, plan: r.amount, fact: r2(got[r.category] ?? 0) }));
  const plans = await plansFor(month, txns), acc = await accountsInfo();
  const goals = (await sql`select * from energy.money_goals order by done, deadline nulls last, id`).map((g) => {
    const jar = g.jar_id ? acc.jars.find((j: any) => j.id === g.jar_id) : null;
    const saved = jar ? jar.balance : Number(g.saved), target = Number(g.target);
    const dl = g.deadline ? String(g.deadline instanceof Date ? g.deadline.toISOString() : g.deadline).slice(0, 10) : null;
    let monthly = null;
    if (dl && saved < target) {
      const [y, m] = local().day.split("-").map(Number), [dy, dm] = dl.split("-").map(Number);
      monthly = Math.ceil((target - saved) / Math.max(1, (dy - y) * 12 + (dm - m) + 1));
    }
    return { id: g.id, title: g.title, target, saved, deadline: dl, jar_id: g.jar_id, jar: jar?.title ?? null, done: g.done || saved >= target, monthly };
  });
  let forecast = null;
  if (month === local().day.slice(0, 7)) {
    const income = plans.filter((p) => p.kind === "income" && !p.paid).reduce((s, p) => s + p.amount, 0);
    const planned = plans.filter((p) => p.kind === "expense" && !p.paid).reduce((s, p) => s + p.amount, 0);
    const budget_left = budgets.reduce((s, b) => {
      const pl = plans.filter((p) => p.kind === "expense" && !p.paid && p.category === b.category).reduce((a, p) => a + p.amount, 0);
      return s + Math.max(0, b.limit - b.spent - pl);
    }, 0);
    forecast = { balance: acc.total, income, planned, budget_left, end: Math.round(acc.total + income - planned - budget_left) };
  }
  // План / факт по всіх статтях місяця
  const cats = new Set([...budgets.map((b) => b.category), ...Object.keys(spent)]);
  const pf_expense = [...cats].map((c) => ({ category: c, plan: budgets.find((b) => b.category === c)?.limit ?? 0, fact: r2(spent[c] ?? 0) }))
    .sort((a, b) => b.plan - a.plan || b.fact - a.fact);
  const icats = new Set([...income_plan.map((b) => b.category), ...Object.keys(got)]);
  const pf_income = [...icats].map((c) => ({ category: c, plan: income_plan.find((b) => b.category === c)?.plan ?? 0, fact: r2(got[c] ?? 0) }))
    .sort((a, b) => b.plan - a.plan || b.fact - a.fact);
  return {
    budgets, income_plan, plans, ...acc, goals, forecast,
    budget_total: budgets.reduce((s, b) => s + b.limit, 0), income_total: income_plan.reduce((s, b) => s + b.plan, 0),
    budget_month: month, budget_from: bud.from, budget_inherited: !!bud.from && bud.from !== month,
    pf_expense, pf_income,
  };
}
async function flagOnce(key: string) { return (await sql`insert into energy.money_flags(key) values(${key}) on conflict do nothing returning key`).length > 0; }
export async function plannerNotify() {
  if (!S.chat_id || !S.bot_token) return;
  const l = local(), month = l.day.slice(0, 7), [a, b] = monthRange(month);
  const lim = (await budgetRows(month)).rows.filter((r) => r.kind === "expense");
  if (lim.length) {
    const sp = await sql`select category, sum(-amount)::float s from energy.txns where ts >= ${a}::date::timestamp at time zone ${TZ} and ts < ${b}::date::timestamp at time zone ${TZ}
      and amount < 0 and currency = 980 and not hidden and category <> all(${NOT_SPEND}) group by category`;
    for (const x of lim) {
      const s = sp.find((y) => y.category === x.category)?.s ?? 0, pc = (s / x.amount) * 100;
      if (pc >= 100 && await flagOnce(`bud:${month}:${x.category}:100`)) {
        await flagOnce(`bud:${month}:${x.category}:80`);
        await tgSend(S.bot_token, S.chat_id, `🔴 <b>Перевищено план «${x.category}»</b>: ${UAH(s)} із ${UAH(x.amount)}`);
      } else if (pc >= 80 && pc < 100 && await flagOnce(`bud:${month}:${x.category}:80`)) {
        await tgSend(S.bot_token, S.chat_id, `⚠️ <b>План «${x.category}»</b>: витрачено ${UAH(s)} із ${UAH(x.amount)} (${Math.round(pc)}%). Лишилось ${UAH(x.amount - s)}`);
      }
    }
  }
  if (l.hour < 9) return;
  const tx = await sql`select id, ts, amount, currency, description, category, hidden from energy.txns where ts >= ${a}::date::timestamp at time zone ${TZ} and ts < ${b}::date::timestamp at time zone ${TZ}`;
  for (const p of await plansFor(month, tx)) {
    if (p.kind !== "expense" || p.paid) continue;
    const d = Math.round((Date.parse(p.due) - Date.parse(l.day)) / 864e5);
    if (d > p.remind_days || d < -3 || !await flagOnce(`plan:${p.id}:${month}`)) continue;
    const when = d > 1 ? `до ${p.due.slice(8)}.${p.due.slice(5, 7)} (за ${d} дн.)` : d === 1 ? "завтра" : d === 0 ? "сьогодні" : `прострочено з ${p.due.slice(8)}.${p.due.slice(5, 7)}`;
    await tgSend(S.bot_token, S.chat_id, `🔔 <b>Платіж: ${p.title}</b> — ${UAH(p.amount)}, ${when}`);
  }
}

// ───────────── API ─────────────
const money = (x: unknown) => { const n = Number(String(x ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const title = (x: unknown, max = 60) => { const t = String(x ?? "").trim().replace(/\s+/g, " ").slice(0, max); if (!t) throw new ApiError("Вкажіть назву"); return t; };
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
type Body = Record<string, any>;
const actions: Record<string, (b: Body, me: Member) => Promise<any>> = {
  async money(b, me) {
    const month = isMonth(b.month) ? b.month : local().day.slice(0, 7), [a, z] = monthRange(month), [pa] = monthRange(prevMonth(month));
    const q = (from: string, to: string) => sql`select t.*, mb.name member_name, coalesce(l.share, 'full') share, ma.name account_name from energy.txns t
      join energy.members mb on mb.id = t.member_id left join energy.bank_links l on l.id = t.link_id left join energy.money_accounts ma on ma.id = t.account_id
      where t.ts >= ${from}::date::timestamp at time zone ${TZ} and t.ts < ${to}::date::timestamp at time zone ${TZ}`;
    const cur = await q(a, z), prev = await q(pa, a), spend = cur.filter(isSpend);
    const sum = (l: any[]) => l.reduce((s, t) => s - Number(t.amount), 0);
    const group = (key: (t: any) => string) => {
      const o: Record<string, number> = {};
      for (const t of spend) o[key(t)] = (o[key(t)] ?? 0) - Number(t.amount);
      return Object.entries(o).map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
    };
    const byDay: Record<string, number> = {};
    for (const t of spend) { const d = new Date(t.ts).toLocaleDateString("en-CA", { timeZone: TZ }); byDay[d] = (byDay[d] ?? 0) - Number(t.amount); }
    const txns = cur.filter((t) => t.member_id === me.id || t.share === "full").sort((x, y) => +new Date(y.ts) - +new Date(x.ts)).slice(0, 400)
      .map((t) => ({ id: t.id, ts: t.ts, amount: Number(t.amount), currency: t.currency, description: t.description, category: t.category, hidden: t.hidden,
        member: t.member_name, mine: t.member_id === me.id, comment: t.comment, manual: t.source === "manual", account_id: t.account_id, account: t.account_name }));
    const family = await sql`select m.id, m.name, exists(select 1 from energy.bank_links l where l.member_id=m.id) connected from energy.members m where m.active order by m.id`;
    const today = local().day, curM = month === today.slice(0, 7);
    const cl = await categoryLists();
    return {
      month, total: sum(spend), prev_total: sum(prev.filter(isSpend)),
      prev_same: sum(prev.filter(isSpend).filter((t) => !curM || +new Date(t.ts).toLocaleDateString("en-CA", { timeZone: TZ }).slice(8, 10) <= +today.slice(8, 10))),
      income: cur.filter(isIncome).reduce((s, t) => s + Number(t.amount), 0),
      by_category: group((t) => t.category), by_member: group((t) => t.member_name), by_day: byDay, txns,
      links: await myLinks(me), family,
      categories: [...cl.expense, ...NOT_SPEND], expense_categories: cl.expense, income_categories: cl.income, custom_categories: cl.custom,
      now: nowMs(), planner: await planner(month, cur),
    };
  },
  async mono_connect(b, me) {
    const tok = String(b.token ?? "").trim();
    if (!/^[A-Za-z0-9_\-]{20,80}$/.test(tok)) throw new ApiError("Схоже, це не токен Monobank. Скопіюйте його повністю зі сторінки api.monobank.ua");
    let r;
    try { r = await monoFetch("/personal/client-info", tok); } catch { throw new ApiError("Monobank зараз не відповідає, спробуйте за хвилину"); }
    if (r.status === 429) throw new ApiError("Monobank дозволяє один запит на хвилину. Спробуйте ще раз за хвилину");
    if (r.status !== 200) throw new ApiError("Monobank не прийняв токен. Перевірте, що скопіювали його повністю");
    const accounts = (r.json.accounts ?? []).map((a: any) => ({
      id: a.id, currency: a.currencyCode, type: a.type, pan: (a.maskedPan ?? [])[0]?.slice(-4) ?? "",
      label: `${CARD[a.type] ?? "Картка"} ${(a.maskedPan ?? [])[0]?.slice(-4) ? "•" + a.maskedPan[0].slice(-4) : ""} ${CUR[a.currencyCode] ?? ""}`.replace(/\s+/g, " ").trim(),
      include: a.currencyCode === 980 && !["fop", "eAid"].includes(a.type), credit: Number(a.creditLimit ?? 0) / 100,
    }));
    const balances = Object.fromEntries((r.json.accounts ?? []).map((a: any) => [a.id, { b: Number(a.balance) / 100, t: Math.floor(nowMs() / 1000) }]));
    const jars = (r.json.jars ?? []).map((j: any) => ({ id: j.id, title: j.title, balance: Number(j.balance) / 100, goal: j.goal ? Number(j.goal) / 100 : null, currency: j.currencyCode }));
    const t = Math.floor(nowMs() / 1000), queue: any[] = [{ op: "hook" }, { op: "info" }];
    for (const a of accounts.filter((x: any) => x.include)) for (let i = 0; i < 2; i++) queue.push({ op: "stmt", acc: a.id, from: t - (i + 1) * 31 * 86400, to: t - i * 31 * 86400 });
    await settings();
    const [l] = await sql`insert into energy.bank_links(member_id, token_enc, client_name, accounts, queue, next_call_at, balances, jars)
      values(${me.id}, ${await encrypt(tok)}, ${r.json.name ?? ""}, ${sql.json(accounts)}, ${sql.json(queue.filter((x) => x.op !== "info"))}, ${new Date(nowMs() + 61_000)}, ${sql.json(balances)}, ${sql.json(jars)}) returning id`;
    return { link_id: l.id, accounts, minutes: queue.length, ...await actions.money({}, me) };
  },
  async mono_update(b, me) {
    const [l] = await sql`select * from energy.bank_links where id=${Number(b.link_id)} and member_id=${me.id}`;
    if (!l) throw new ApiError("Підключення не знайдено");
    let accounts = l.accounts, queue = l.queue ?? [];
    if (Array.isArray(b.include)) {
      const t = Math.floor(nowMs() / 1000);
      accounts = accounts.map((a: any) => {
        const inc = b.include.includes(a.id);
        if (inc && !a.include) for (let i = 0; i < 2; i++) queue.push({ op: "stmt", acc: a.id, from: t - (i + 1) * 31 * 86400, to: t - i * 31 * 86400 });
        return { ...a, include: inc };
      });
      const off = accounts.filter((a: any) => !a.include).map((a: any) => a.id);
      if (off.length) await sql`delete from energy.txns where link_id=${l.id} and account in ${sql(off)}`;
      queue = queue.filter((j: any) => j.op !== "stmt" || !off.includes(j.acc));
    }
    const share = b.share === "totals" ? "totals" : b.share === "full" ? "full" : l.share;
    await sql`update energy.bank_links set accounts=${sql.json(accounts)}, queue=${sql.json(queue)}, share=${share} where id=${l.id}`;
    return actions.money({ month: b.month }, me);
  },
  async mono_disconnect(b, me) {
    const [l] = await sql`select * from energy.bank_links where id=${Number(b.link_id)} and member_id=${me.id}`;
    if (!l) throw new ApiError("Підключення не знайдено");
    try { await monoFetch("/personal/webhook", await decrypt(l.token_enc), { webHookUrl: "" }); } catch { /* */ }
    await sql`delete from energy.txns where link_id=${l.id}`;
    await sql`delete from energy.bank_links where id=${l.id}`;
    return actions.money({ month: b.month }, me);
  },
  // Операція: категорія, «не враховувати»; ручну — ще сума, дата, опис, рахунок, видалення
  async txn_update(b, me) {
    const [t] = await sql`select * from energy.txns where id=${String(b.id)} and member_id=${me.id}`;
    if (!t) throw new ApiError("Змінювати можна лише свої операції");
    if (b.delete && t.source === "manual") { await sql`delete from energy.txns where id=${t.id}`; return actions.money({ month: b.month }, me); }
    if (b.category) await sql`update energy.txns set category=${String(b.category).slice(0, 40)}, cat_manual=true where id=${t.id}`;
    if (b.hidden != null) await sql`update energy.txns set hidden=${!!b.hidden} where id=${t.id}`;
    if (t.source === "manual") {
      if (b.amount != null && b.amount !== "") {
        const a = Math.abs(money(b.amount));
        if (!(a > 0 && a < 1e7)) throw new ApiError("Вкажіть суму");
        await sql`update energy.txns set amount=${Number(t.amount) > 0 ? a : -a} where id=${t.id}`;
      }
      if (isDay(b.day)) await sql`update energy.txns set ts=${b.day}::date::timestamp at time zone ${TZ} + interval '12 hours' where id=${t.id}`;
      if (b.note != null) await sql`update energy.txns set description=${String(b.note).trim().slice(0, 120) || t.description} where id=${t.id}`;
      if (b.account_id !== undefined) {
        const [acc] = b.account_id ? await sql`select id from energy.money_accounts where id=${Number(b.account_id)} and active` : [];
        await sql`update energy.txns set account_id=${acc?.id ?? null} where id=${t.id}`;
      }
    }
    return actions.money({ month: b.month }, me);
  },
  async txn_add(b, me) {
    const a = Math.abs(money(b.amount));
    if (!(a > 0 && a < 1e7)) throw new ApiError("Вкажіть суму");
    const day = isDay(b.day) ? b.day : local().day, income = b.kind === "income";
    const [acc] = b.account_id ? await sql`select id from energy.money_accounts where id=${Number(b.account_id)} and active` : [];
    const cat = String(b.category || (income ? "Надходження" : "Інше")).slice(0, 40);
    await sql`insert into energy.txns(id, member_id, ts, amount, currency, description, category, cat_manual, source, account_id)
      values(${"m" + crypto.randomUUID()}, ${me.id}, ${day}::date::timestamp at time zone ${TZ} + interval '12 hours', ${income ? a : -a}, 980,
        ${String(b.note || cat).trim().slice(0, 120)}, ${cat}, true, 'manual', ${acc?.id ?? null})`;
    return actions.money({ month: day.slice(0, 7) }, me);
  },
  // План по статті на місяць (витрати або доходи). 0 — прибрати статтю з плану.
  async budget_set(b, me) {
    const month = isMonth(b.month) ? b.month : local().day.slice(0, 7);
    const kind = b.kind === "income" ? "income" : "expense", cat = title(b.category, 40), a = money(b.amount);
    if (!(a >= 0 && a < 1e8)) throw new ApiError("Вкажіть суму");
    await ownBudget(month);
    if (a === 0) await sql`delete from energy.money_budgets where month=${month} and kind=${kind} and category=${cat}`;
    else await sql`insert into energy.money_budgets(month, kind, category, amount) values(${month}, ${kind}, ${cat}, ${a})
      on conflict (month, kind, category) do update set amount=excluded.amount, updated_at=now()`;
    return actions.money({ month }, me);
  },
  // Скопіювати план з іншого місяця (за замовчуванням — з попереднього) або зі фактичних витрат того місяця
  async budget_copy(b, me) {
    const month = isMonth(b.month) ? b.month : local().day.slice(0, 7), from = isMonth(b.from) ? b.from : prevMonth(month);
    let rows: { kind: string; category: string; amount: number }[];
    if (b.source === "fact") {
      const [a, z] = monthRange(from);
      rows = (await sql`select case when amount < 0 then 'expense' else 'income' end kind, category, abs(sum(amount))::float amount from energy.txns
        where ts >= ${a}::date::timestamp at time zone ${TZ} and ts < ${z}::date::timestamp at time zone ${TZ} and currency=980 and not hidden and category <> 'Перекази'
          and not (amount < 0 and category = 'Надходження')
        group by 1, 2 having abs(sum(amount)) >= 1`).map((r) => ({ kind: r.kind, category: r.category, amount: Math.ceil(Number(r.amount) / 100) * 100 }));
    } else rows = (await budgetRows(from)).rows;
    if (!rows.length) throw new ApiError("Нічого копіювати — у тому місяці немає ні плану, ні витрат");
    await sql.begin(async (tx) => {
      await tx`delete from energy.money_budgets where month=${month}`;
      await tx`insert into energy.money_budgets(month, kind, category, amount) values(${month}, 'mark', '', 0)`;
      for (const r of rows) await tx`insert into energy.money_budgets(month, kind, category, amount) values(${month}, ${r.kind}, ${r.category}, ${r.amount}) on conflict do nothing`;
    });
    return actions.money({ month }, me);
  },
  async category_save(b, me) {
    const name = title(b.name, 40), kind = b.kind === "income" ? "income" : "expense";
    const icon = b.icon ? String(b.icon).trim().slice(0, 8) : null;
    if ([...BASE_EXPENSE, ...BASE_INCOME, ...NOT_SPEND].includes(name)) throw new ApiError("Така стаття вже є");
    if (b.id) {
      const [c] = await sql`select * from energy.money_categories where id=${Number(b.id)} and active`;
      if (!c) throw new ApiError("Статтю не знайдено");
      await sql`update energy.money_categories set name=${name}, icon=${icon} where id=${c.id}`;
      if (c.name !== name) {
        await sql`update energy.txns set category=${name} where category=${c.name}`;
        await sql`update energy.money_budgets set category=${name} where category=${c.name} and kind=${c.kind}`;
        await sql`update energy.money_plans set category=${name} where category=${c.name}`;
      }
    } else {
      await sql`insert into energy.money_categories(name, kind, icon, created_by) values(${name}, ${kind}, ${icon}, ${me.id})
        on conflict (name) do update set active=true, kind=excluded.kind, icon=excluded.icon`;
    }
    return actions.money({ month: b.month }, me);
  },
  async category_delete(b, me) {
    const [c] = await sql`select * from energy.money_categories where id=${Number(b.id)} and active`;
    if (!c) throw new ApiError("Статтю не знайдено");
    const to = c.kind === "income" ? "Надходження" : "Інше";
    await sql`update energy.money_categories set active=false where id=${c.id}`;
    await sql`update energy.txns set category=${to} where category=${c.name}`;
    await sql`delete from energy.money_budgets where category=${c.name} and kind=${c.kind}`;
    return actions.money({ month: b.month }, me);
  },
  async plan_save(b, me) {
    const p = b.plan ?? {}, t = title(p.title), a = money(p.amount), day = Math.round(Number(p.day));
    if (!(a > 0 && a < 1e8)) throw new ApiError("Вкажіть суму");
    if (!(day >= 1 && day <= 31)) throw new ApiError("День місяця — від 1 до 31");
    const kind = p.kind === "income" ? "income" : "expense", every = p.every === "year" ? "year" : "month";
    const mo = every === "year" ? Math.min(12, Math.max(1, Math.round(Number(p.month) || 1))) : null;
    const cat = kind === "expense" && p.category ? String(p.category).slice(0, 40) : null;
    const match = (p.match && String(p.match).trim().slice(0, 40)) || null, rem = Math.min(10, Math.max(0, Math.round(Number(p.remind_days ?? 2))));
    if (p.id) await sql`update energy.money_plans set title=${t}, kind=${kind}, amount=${a}, category=${cat}, day=${day}, every=${every}, month=${mo}, match=${match}, remind_days=${rem} where id=${Number(p.id)}`;
    else await sql`insert into energy.money_plans(title, kind, amount, category, day, every, month, match, remind_days, created_by)
      values(${t}, ${kind}, ${a}, ${cat}, ${day}, ${every}, ${mo}, ${match}, ${rem}, ${me.id})`;
    return actions.money({ month: b.month }, me);
  },
  async plan_delete(b, me) { await sql`update energy.money_plans set active=false where id=${Number(b.id)}`; return actions.money({ month: b.month }, me); },
  async plan_paid(b, me) {
    const month = isMonth(b.month) ? b.month : local().day.slice(0, 7);
    if (b.paid) await sql`update energy.money_plans set paid = paid || ${sql.json({ [month]: "manual" })} where id=${Number(b.id)}`;
    else await sql`update energy.money_plans set paid = paid - ${month} where id=${Number(b.id)}`;
    return actions.money({ month }, me);
  },
  async account_save(b, me) {
    const name = title(b.name, 40), opening = money(b.opening ?? 0);
    if (!Number.isFinite(opening)) throw new ApiError("Перевірте суму");
    if (b.id) {
      const [a] = await sql`select * from energy.money_accounts where id=${Number(b.id)} and active`;
      if (!a) throw new ApiError("Рахунок не знайдено");
      if (b.opening != null && b.opening !== "") await sql`update energy.money_accounts set name=${name}, opening=${opening}, opened_at=${new Date(nowMs())} where id=${a.id}`;
      else await sql`update energy.money_accounts set name=${name} where id=${a.id}`;
    } else await sql`insert into energy.money_accounts(member_id, name, opening, opened_at) values(${me.id}, ${name}, ${opening}, ${new Date(nowMs())})`;
    return actions.money({ month: b.month }, me);
  },
  async account_delete(b, me) { await sql`update energy.money_accounts set active=false where id=${Number(b.id)}`; return actions.money({ month: b.month }, me); },
  async goal_save(b, me) {
    const g = b.goal ?? {}, t = title(g.title), target = money(g.target);
    if (!(target > 0 && target < 1e9)) throw new ApiError("Вкажіть суму цілі");
    const dl = isDay(g.deadline) ? g.deadline : null, jar = g.jar_id ? String(g.jar_id).slice(0, 64) : null;
    if (g.id) await sql`update energy.money_goals set title=${t}, target=${target}, deadline=${dl}, jar_id=${jar} where id=${Number(g.id)}`;
    else await sql`insert into energy.money_goals(title, target, deadline, jar_id, saved) values(${t}, ${target}, ${dl}, ${jar}, ${Math.max(0, money(g.saved) || 0)})`;
    return actions.money({ month: b.month }, me);
  },
  async goal_add(b, me) {
    const a = money(b.amount);
    if (!(Math.abs(a) > 0 && Math.abs(a) < 1e9)) throw new ApiError("Вкажіть суму");
    await sql`update energy.money_goals set saved = greatest(0, saved + ${a}) where id=${Number(b.id)} and jar_id is null`;
    return actions.money({ month: b.month }, me);
  },
  async goal_delete(b, me) { await sql`delete from energy.money_goals where id=${Number(b.id)}`; return actions.money({ month: b.month }, me); },
};

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url), s = await settings();
  if (url.searchParams.has("hook")) {
    if (url.searchParams.get("hook") !== s.secret) return new Response("forbidden", { status: 403 });
    if (req.method !== "POST") return new Response("ok");
    try {
      const j = await req.json();
      if (j?.type === "StatementItem") {
        const [l] = await sql`select id, member_id, accounts from energy.bank_links where id=${Number(url.searchParams.get("l"))}`;
        const acc = (l?.accounts ?? []).find((a: any) => a.id === j.data?.account);
        if (l && acc?.include) await saveTxn(l, acc.id, j.data.statementItem, acc.currency);
      }
    } catch (e) { console.error("hook", e); }
    return new Response("ok");
  }
  if (url.searchParams.has("tick")) {
    if (url.searchParams.get("tick") !== s.secret) return new Response("forbidden", { status: 403 });
    await tick(); return new Response("ok");
  }
  if (req.method !== "POST") return json({ ok: true, service: "svit-money" });
  let b: Body;
  try { b = await req.json(); } catch { return json({ ok: false, error: "Невірний запит" }, 400); }
  try {
    const me = await checkToken((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!me) return json({ ok: false, error: "auth" }, 401);
    const f = actions[String(b.action)];
    return f ? json({ ok: true, ...await f(b, me) }) : json({ ok: false, error: "Невідома дія" }, 400);
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.message }, 400);
    console.error(e); return json({ ok: false, error: "Помилка сервера" }, 500);
  }
}
if (!env("MONEY_TEST")) Deno.serve(handler);
