// 「疑似被攻击 / 阴阳怪气」待审队列（2026-10-21 管理员定）
//
// 规则：
//   · 她怀疑对面在攻击或阴阳怪气**她** → **不回**，而是记进这里，等管理员晚上审
//   · 每天从 #1 开始编号（今天第 1 条 = #1，依次类推）
//   · 管理员批准（approve）之后才允许回；没批就永远不理 ✗
//   · 记进队列**不占任何发言额度**（本来就没发出去 ✓）
//
// 数据：~/.dsh/surfcore/bili/attacks.json
//   { "2026-10-21": { "seq": 2, "items": [ { seq, at, who, mid, oid, type, root, parent, bvid, text, suggest, status } ] } }
//   status: pending | approved | rejected | replied
import { accountBili, biliState, biliStateDir } from './state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { dayKey } from './clock.mjs'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const FILE = biliState('attacks.json')
export const today = () => dayKey()

export function loadAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}
export function saveAll(all) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n')
  } catch {}
}

function dayOf(all, date) {
  if (!all[date] || typeof all[date] !== 'object') all[date] = { seq: 0, items: [] }
  if (!Array.isArray(all[date].items)) all[date].items = []
  return all[date]
}

/** 记一条待审（自动分配今天的序号），返回 { seq, item } */
export function add(item) {
  const all = loadAll()
  const d = today()
  const day = dayOf(all, d)
  day.seq = Number(day.seq ?? 0) + 1
  const rec = {
    seq: day.seq,
    at: new Date().toISOString(),
    status: 'pending',
    who: String(item.who ?? '').slice(0, 40),
    mid: String(item.mid ?? ''),
    oid: String(item.oid ?? ''),
    type: String(item.type ?? '1'),
    root: String(item.root ?? ''),
    parent: String(item.parent ?? ''),
    bvid: String(item.bvid ?? ''),
    text: String(item.text ?? '').slice(0, 300),
    suggest: String(item.suggest ?? '').slice(0, 300),
  }
  day.items.push(rec)
  // 只留最近 10 天
  const keys = Object.keys(all).sort().slice(-10)
  const trimmed = {}
  for (const k of keys) trimmed[k] = all[k]
  saveAll(trimmed)
  return { seq: rec.seq, item: rec }
}

export function listByDate(date = today(), status = '') {
  const all = loadAll()
  const day = all[date]
  if (!day) return []
  const items = Array.isArray(day.items) ? day.items : []
  return status ? items.filter((x) => x.status === status) : items
}

export function findBySeq(seq, date = today()) {
  return listByDate(date).find((x) => Number(x.seq) === Number(seq)) ?? null
}

export function setStatus(seq, status, date = today()) {
  const all = loadAll()
  const day = all[date]
  if (!day) return null
  const it = (day.items ?? []).find((x) => Number(x.seq) === Number(seq))
  if (!it) return null
  it.status = status
  it.updatedAt = new Date().toISOString()
  saveAll(all)
  return it
}

/** 这条评论是不是在待审里（回复前要拦） */
export function findByParent(oid, parent, date = today()) {
  return listByDate(date).find((x) => String(x.oid) === String(oid) && String(x.parent) === String(parent)) ?? null
}

/** 找同一对象（同一 oid/parent）最近的状态 */
export function pendingCount(date = today()) {
  return listByDate(date, 'pending').length
}
