/**
 * 内核支撑件：审计 / 预算 / 身份
 * ============================================================================
 * 三个小服务放一个文件，因为它们的"秘密"是同一个：**内核怎么记录事实**。
 * 每个都独立可测、无 IO 依赖（审计可注入写盘、预算纯内存、身份纯数据）。
 */

/* ── 审计：只追加，不改不改 ───────────────────────────────────────────── */
export function createAudit({ max = 500, now = () => Date.now() } = {}) {
  const rows = [];
  return {
    record(entry = {}) {
      rows.push({ at: now(), ...entry });
      if (rows.length > max) rows.splice(0, rows.length - max);
      return rows[rows.length - 1];
    },
    list() { return rows.slice(); },
    /** 只取某类 */
    of(kind) { return rows.filter((r) => r.kind === kind); },
    size() { return rows.length; },
  };
}

/* ── 预算：按类别记账 + 每日上限 ───────────────────────────────────────
 * 注意：类别名由**调用方给**（谁花钱谁定义），内核不认识任何具体渠道。
 * 唯一内建的是 'total'——"全部加起来"，这是内核自己的概念。
 */
export function createBudget({ limits = {}, now = () => Date.now() } = {}) {
  const spent = new Map();          // 任意类别名 → 已花
  const day = { value: null };

  const sum = () => { let n = 0; for (const v of spent.values()) n += v; return n; };

  function rollover() {
    const d = new Date(now());
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (day.value !== key) { day.value = key; spent.clear(); }
  }

  return {
    /** 还能不能花（超了就是超了，不偷偷放行） */
    canSpend(scope = 'other', amount = 0) {
      rollover();
      const key = String(scope);
      const used = key === 'total' ? sum() : (spent.get(key) ?? 0);
      const lim = Number(limits[key]);
      if (!Number.isFinite(lim) || lim <= 0) return { ok: true, reason: 'no-limit' };
      if (used + amount > lim) return { ok: false, reason: 'exceeded', scope: key, spent: used, limit: lim };
      return { ok: true, reason: 'ok', spent: used, limit: lim };
    },
    /** 记账：**按已发生的成本记，不按成功的产出记** */
    commit(scope = 'other', amount = 0) {
      rollover();
      const key = String(scope);
      const n = Number(amount) || 0;
      spent.set(key, (spent.get(key) ?? 0) + n);
      return { scope: key, spent: spent.get(key) };
    },
    snapshot() { rollover(); return { scopes: Object.fromEntries(spent), total: sum() }; },
    limits() { return { ...limits }; },

    /** 读盘用：把当天已花的额度恢复回来（不恢复就"重启即清零"） */
    restore(saved = {}) {
      rollover();
      const scopes = saved?.scopes && typeof saved.scopes === 'object' ? saved.scopes : {};
      spent.clear();
      for (const [k, v] of Object.entries(scopes)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) spent.set(String(k), n);
      }
      return sum();
    },
  };
}

/* ── 身份：她是谁、谁是主人、怎么称呼 ───────────────────────────────── */
export function createIdentity({ persona = {}, admin = null, adminName = '管理员' } = {}) {
  const self = {
    name: String(persona.name ?? '她'),
    core: String(persona.core ?? ''),          // 人格核心（永远注入）
    tone: String(persona.tone ?? ''),          // 语气层（群聊用）
    scenes: persona.scenes && typeof persona.scenes === 'object' ? { ...persona.scenes } : {},
  };
  const owner = admin ? String(admin) : null;
  const aliases = new Map();                    // 某人 → 她该怎么叫

  return {
    /** 她是谁（给适配器的公开版：只有名字与一句自我描述，不带全部人格） */
    describe({ maxChars = 200 } = {}) {
      const text = self.core || self.name;
      return String(text).slice(0, Math.max(20, maxChars));
    },
    /** 注入用：核心永远在，语气层可选 */
    personaLayers({ audience = 'group' } = {}) {
      const parts = [self.core];
      if (audience === 'group' && self.tone) parts.push(self.tone);
      if (audience === 'private' && self.tone) parts.push(self.tone);
      return parts.filter(Boolean);
    },
    isOwner(id) { return Boolean(owner) && String(id) === owner; },
    setOwner(id) { return owner; },   // 只读快照，改主人要走配置（不在内核里改）
    /** 称呼：主人有专门称呼，其他人各记各的 */
    aliasFor(id, { isOwner = false } = {}) {
      const key = String(id ?? '');
      if (isOwner) return adminName;
      return aliases.get(key) ?? null;
    },
    rememberAlias(id, alias) {
      const a = String(alias ?? '').trim().slice(0, 20);
      if (!a) return null;
      aliases.set(String(id), a);
      return a;
    },
    snapshot() { return { name: self.name, hasCore: Boolean(self.core), hasTone: Boolean(self.tone), owner, aliases: aliases.size }; },
  };
}
