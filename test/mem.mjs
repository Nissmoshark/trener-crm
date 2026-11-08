export function memStore() {
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

