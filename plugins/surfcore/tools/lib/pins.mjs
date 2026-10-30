// 「今天这条动态用哪个视频」的钦定表（2026-10-21 加）
//
// 为什么要有：管理员会先看候选再拍板。他说"就发这条"之后，脚本要**照办**，
//   而不是等她晚上自己从候选池里再挑一次（很可能挑成别的）。
//
// 数据：~/.dsh/surfcore/bili/dynamic-pins.json
//   { "2026-10-21": { "gaming": "BV1Menj62Eig", "game": "BV15Dng6rEPw" } }
import { accountBili, biliState, biliStateDir } from './state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { dayKey } from './clock.mjs'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const FILE = biliState('dynamic-pins.json')
const today = () => dayKey()

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}
function save(o) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(o, null, 2) + '\n')
  } catch {}
}

/** 今天这一类钦定了哪个 BV（没有就 ''） */
export function pinOf(kind, date = today()) {
  return String(load()?.[date]?.[kind] ?? '')
}

/** 管理员对这条动态的"要点"（会原样塞进她的唤醒提示） */
export function noteOf(kind, date = today()) {
  return String(load()?.[date]?.[`_note_${kind}`] ?? '')
}
export function setNote(kind, text, date = today()) {
  const all = load()
  all[date] = { ...(all[date] ?? {}), [`_note_${kind}`]: String(text ?? '') }
  const keys = Object.keys(all).sort().slice(-10)
  const trimmed = {}
  for (const k of keys) trimmed[k] = all[k]
  save(trimmed)
  return trimmed[date]
}

/** 钦定一条（kind = best|game|anime|gaming） */
export function setPin(kind, bv, date = today()) {
  const all = load()
  all[date] = { ...(all[date] ?? {}), [kind]: String(bv) }
  const keys = Object.keys(all).sort().slice(-10)
  const trimmed = {}
  for (const k of keys) trimmed[k] = all[k]
  save(trimmed)
  return trimmed[date]
}

/** 清掉某类的钦定（发出去之后调，免得明天还认） */
export function clearPin(kind, date = today()) {
  const all = load()
  let changed = false
  if (all?.[date]?.[kind]) { delete all[date][kind]; changed = true }
  if (all?.[date]?.[`_note_${kind}`]) { delete all[date][`_note_${kind}`]; changed = true }
  if (changed) save(all)
}
