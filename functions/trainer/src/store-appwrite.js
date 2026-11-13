// Сховище на Appwrite TablesDB (REST, без SDK). Ключ — динамічний ключ функції (x-appwrite-key).
export const DB = "trainer";

// Схема колекцій: [ключ, тип, розмір|null, за замовчуванням]
export const SCHEMA = {
  tenants: { attrs: [["phone", "string", 32], ["chat", "string", 32], ["tg_phone", "string", 32], ["data", "string", 20000]], indexes: [["phone"], ["chat"]] },
  kv: { attrs: [["value", "string", 10000]], indexes: [] },
  clients: {
    attrs: [["tid", "string", 32], ["name", "string", 200], ["phone", "string", 32], ["price", "float"], ["notes", "string", 5000],
      ["remind", "boolean", null, true], ["tg_chat_id", "string", 32], ["tg_code", "string", 32], ["archived", "boolean", null, false],
      ["program", "string", 10000], ["online", "boolean", null, false]],
    indexes: [["tid"], ["tg_code"], ["tg_chat_id"]],
  },
  packages: {
    attrs: [["tid", "string", 32], ["client_id", "string", 32], ["title", "string", 200], ["sessions_total", "integer"], ["price", "float"],
      ["paid", "boolean", null, true], ["bought_on", "string", 10], ["expires_on", "string", 10], ["used_before", "integer"]],
    indexes: [["tid"], ["client_id"]],
  },
  sessions: {
    attrs: [["tid", "string", 32], ["day", "string", 10], ["start_time", "string", 5], ["duration_min", "integer"], ["kind", "string", 16],
      ["title", "string", 200], ["status", "string", 16], ["extra_amount", "float"], ["note", "string", 2000], ["reminded", "boolean", null, false], ["series", "string", 32], ["online", "boolean", null, false]],
    indexes: [["tid"], ["day"], ["series"]],
  },
  parts: {
    attrs: [["tid", "string", 32], ["session_id", "string", 32], ["client_id", "string", 32], ["price", "float"], ["pay", "string", 16],
      ["package_id", "string", 32], ["day", "string", 10], ["status", "string", 16], ["confirm", "string", 8]],
    indexes: [["tid"], ["session_id"], ["client_id"], ["package_id"], ["day"]],
  },
  plans: {
    attrs: [["tid", "string", 32], ["day", "string", 10], ["time", "string", 5], ["duration_min", "integer"], ["title", "string", 200], ["place", "string", 200],
      ["note", "string", 2000], ["cat", "string", 16], ["remind_min", "integer"], ["reminded", "boolean", null, false], ["done", "boolean", null, false],
      ["series", "string", 32]],
    indexes: [["tid"], ["day"], ["series"]],
  },
  notes: {
    attrs: [["tid", "string", 32], ["title", "string", 200], ["body", "string", 5000], ["pinned", "boolean", null, false], ["updated", "string", 32]],
    indexes: [["tid"]],
  },
  expenses: {
    attrs: [["tid", "string", 32], ["day", "string", 10], ["amount", "float"], ["cat", "string", 16], ["note", "string", 300]],
    indexes: [["tid"], ["day"]],
  },
  measures: {
    attrs: [["tid", "string", 32], ["client_id", "string", 32], ["day", "string", 10], ["weight", "float"], ["waist", "float"], ["hips", "float"], ["chest", "float"],
      ["fat", "float"], ["note", "string", 500]],
    indexes: [["tid"], ["client_id"]],
  },
  moves: {
    attrs: [["tid", "string", 32], ["session_id", "string", 32], ["from_day", "string", 10], ["from_time", "string", 5], ["to_day", "string", 10],
      ["to_time", "string", 5], ["reason", "string", 500], ["created_day", "string", 10]],
    indexes: [["tid"], ["session_id"], ["created_day"]],
  },
};
// Поля, які зберігаються рядком, але назовні — числа (ідентифікатори)
const NUM_REF = new Set(["client_id", "package_id", "session_id"]);

export function appwriteStore({ endpoint, project, key, fetchImpl = fetch }) {
  const H = { "content-type": "application/json", "x-appwrite-project": project, "x-appwrite-key": key };
  async function req(method, path, body) {
    const r = await fetchImpl(endpoint + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ }
    if (!r.ok) { const e = new Error(`appwrite ${method} ${path}: ${r.status} ${j?.message ?? t}`); e.status = r.status; e.type = j?.type; throw e; }
    return j;
  }
  const cpath = (c) => `/tablesdb/${DB}/tables/${c}`;
  const out = (d) => {
    if (!d) return null;
    const o = { id: /^\d+$/.test(d.$id) ? Number(d.$id) : d.$id, created_at: d.$createdAt };
    for (const k of Object.keys(d)) if (!k.startsWith("$")) o[k] = NUM_REF.has(k) && d[k] != null && /^\d+$/.test(d[k]) ? Number(d[k]) : d[k];
    return o;
  };
  const inp = (data) => {
    const o = {};
    for (const [k, v] of Object.entries(data)) { if (k === "id" || k === "created_at") continue; o[k] = NUM_REF.has(k) && v != null ? String(v) : v; }
    return o;
  };
  const q = (method, attribute, values) => JSON.stringify(attribute ? { method, attribute, values } : { method, values });
  const conv = (f, v) => (NUM_REF.has(f) || f === "$id") && v != null ? String(v) : v;
  function toQueries(filters) {
    const qs = [];
    for (const [f, op, v] of filters) {
      const a = f === "id" ? "$id" : f;
      if (op === "eq") qs.push(q("equal", a, [conv(a, v)]));
      else if (op === "in") qs.push(q("equal", a, v.map((x) => conv(a, x))));
      else if (op === "ne") qs.push(q("notEqual", a, [conv(a, v)]));
      else if (op === "gte") qs.push(q("greaterThanEqual", a, [v]));
      else if (op === "lte") qs.push(q("lessThanEqual", a, [v]));
      else if (op === "null") qs.push(q("isNull", a));
    }
    return qs;
  }
  return {
    async get(c, id) {
      try { return out(await req("GET", `${cpath(c)}/rows/${encodeURIComponent(String(id))}`)); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async list(c, filters = []) {
      // фільтр "in" з довгим списком ділимо на частини по 100
      const big = filters.find(([, op, v]) => op === "in" && v.length > 100);
      if (big) {
        const res = [];
        for (let i = 0; i < big[2].length; i += 100)
          res.push(...await this.list(c, filters.map((f) => f === big ? [f[0], "in", big[2].slice(i, i + 100)] : f)));
        return res;
      }
      if (filters.some(([, op, v]) => op === "in" && !v.length)) return [];
      const all = [];
      let cursor = null;
      for (;;) {
        const qs = [...toQueries(filters), q("limit", null, [500]), q("orderAsc", "$id", [])];
        if (cursor) qs.push(q("cursorAfter", null, [cursor]));
        const p = "?" + qs.map((x) => "queries[]=" + encodeURIComponent(x)).join("&");
        const j = await req("GET", `${cpath(c)}/rows${p}`);
        all.push(...j.rows);
        if (j.rows.length < 500) break;
        cursor = j.rows[j.rows.length - 1].$id;
      }
      return all.map(out);
    },
    async create(c, data, id) {
      return out(await req("POST", `${cpath(c)}/rows`, { rowId: String(id ?? data.id), data: inp(data) }));
    },
    async update(c, id, data) {
      return out(await req("PATCH", `${cpath(c)}/rows/${encodeURIComponent(String(id))}`, { data: inp(data) }));
    },
    async remove(c, id) {
      try { await req("DELETE", `${cpath(c)}/rows/${encodeURIComponent(String(id))}`); }
      catch (e) { if (e.status !== 404) throw e; }
    },
    // Створити базу й колекції, якщо їх ще немає
    async ensureSchema(log = () => {}) {
      // швидкий шлях: схема вже актуальна
      const ver = String(Object.keys(SCHEMA).length) + ":" + Object.values(SCHEMA).reduce((n, d) => n + d.attrs.length + d.indexes.length, 0);
      try { if ((await req("GET", `${cpath("kv")}/rows/schema_ver`))?.value === ver) return; } catch { /* перевіримо повністю */ }
      await this.ensureSchemaFull(log);
      try { await req("POST", `${cpath("kv")}/rows`, { rowId: "schema_ver", data: { value: ver } }); }
      catch (e) { try { if (e.status === 409) await req("PATCH", `${cpath("kv")}/rows/schema_ver`, { data: { value: ver } }); } catch { /* наступного разу */ } }
    },
    async ensureSchemaFull(log = () => {}) {
      try { await req("GET", `/tablesdb/${DB}`); }
      catch (e) { if (e.status !== 404) throw e; await req("POST", "/tablesdb", { databaseId: DB, name: "Тренування" }); log("db created"); }
      const pendingIdx = [];
      for (const [c, def] of Object.entries(SCHEMA)) {
        try { await req("GET", cpath(c)); }
        catch (e) {
          if (e.status !== 404) throw e;
          await req("POST", `/tablesdb/${DB}/tables`, { tableId: c, name: c, permissions: [], rowSecurity: false });
          log("table " + c);
        }
        const have = new Set((await req("GET", `${cpath(c)}/columns?queries[]=${encodeURIComponent(q("limit", null, [100]))}`)).columns.map((a) => a.key));
        for (const [k, type, size, def0] of def.attrs) {
          if (have.has(k)) continue;
          const body = { key: k, required: false };
          if (type === "string") body.size = size;
          if (def0 !== undefined) body.default = def0;
          await req("POST", `${cpath(c)}/columns/${type}`, body);
          log(`attr ${c}.${k}`);
        }
        pendingIdx.push([c, def.indexes]);
      }
      // індекси — коли атрибути готові
      for (const [c, idx] of pendingIdx) {
        if (!idx.length) continue;
        for (let i = 0; i < 40; i++) {
          const a = (await req("GET", `${cpath(c)}/columns?queries[]=${encodeURIComponent(q("limit", null, [100]))}`)).columns;
          if (a.every((x) => x.status === "available")) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        const have = new Set((await req("GET", `${cpath(c)}/indexes`)).indexes.map((x) => x.key));
        for (const cols of idx) {
          const key = "ix_" + cols.join("_");
          if (have.has(key)) continue;
          await req("POST", `${cpath(c)}/indexes`, { key, type: "key", columns: cols });
          log("index " + c + "." + key);
        }
      }
    },
  };
}
