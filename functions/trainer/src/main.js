// Appwrite Function: API додатку, Telegram-бот і щохвилинні нагадування
import { createCore } from "./core.js";
import { appwriteStore } from "./store-appwrite.js";

let core = null, schemaOk = false, storeKey = "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Cache-Control": "no-store",
};

export default async ({ req, res, log, error }) => {
  if (req.method === "OPTIONS") return res.text("", 204, CORS);
  const key = req.headers["x-appwrite-key"] || process.env.APPWRITE_API_KEY || "";
  if (!core || key !== storeKey) {
    // динамічний ключ змінюється від запуску до запуску — оновлюємо сховище
    const st = appwriteStore({ endpoint: process.env.APPWRITE_FUNCTION_API_ENDPOINT, project: process.env.APPWRITE_FUNCTION_PROJECT_ID, key });
    if (!schemaOk) { await st.ensureSchema(log); schemaOk = true; }
    if (core) core.swapStore(st);
    else core = createCore(st, { log: (m) => error(m), publicUrl: process.env.PUBLIC_URL || "", botToken: (process.env.TELEGRAM_BOT_TOKEN || "").trim(), appUrl: process.env.APP_URL || "", tickSlackMin: Number(process.env.TICK_SLACK_MIN ?? 59) });
    storeKey = key;
  }
  await core.ensureBot();
  const trig = req.headers["x-appwrite-trigger"];
  if (trig === "schedule") { const r = await core.tick(); if (r.length) log(r.join(", ")); return res.json({ ok: true, done: r }); }
  // зовнішній «будильник» (напр. cron-job.org щохвилини): GET ?tick=<secret>
  if (req.query?.tick !== undefined) {
    const s = await core.settings();
    if (!s.secret || req.query.tick !== s.secret) return res.text("forbidden", 403);
    return res.json({ ok: true, done: await core.tick() });
  }

  if (req.query?.tg !== undefined) {
    const s = await core.settings();
    if (req.headers["x-telegram-bot-api-secret-token"] !== s.secret) return res.text("forbidden", 403);
    try { await core.onUpdate(JSON.parse(req.bodyText || "{}")); } catch (e) { error("bot: " + (e?.stack || e)); }
    return res.text("ok");
  }
  if (req.method !== "POST") return res.json({ ok: true, service: "trainer" }, 200, CORS);

  let body; try { body = JSON.parse(req.bodyText || "{}"); } catch { return res.json({ ok: false, error: "Невірний запит" }, 400, CORS); }
  const host = req.headers["x-forwarded-host"] || req.host;
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  const [status, data] = await core.api(body, req.headers, { ip, baseUrl: host ? `https://${host}` : "" });
  return res.json(data, status, CORS);
};
