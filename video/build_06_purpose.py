#!/usr/bin/env python3
"""第六页：Part 3 · 目的机制。

用户给的框架：
  · 人格遇到网上的信息，结合记忆，由一套机制催生出一个目的：「我想干什么？」
  · 这是插件的核心，也是灵魂；
  · 要求：用一句简洁的话把机制讲清楚。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    arrow, bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("06-purpose.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 3 · 目的机制", "具有清晰逻辑链的主动行为系统")
tx(s, 0.7, 1.46, 11.9, 0.35, "人格 × 记忆 × 刚看到的信息 → 一个目的：「我想干什么？」", 14, DIM)

# ── 一句话解释 ────────────────────────────────────────────
rect(s, 0.7, 1.95, 11.91, 0.82, fill=PANEL)
bar(s, 0.7, 1.95, 0.08, 0.82, AMBER)
tx(s, 0.98, 2.08, 11.4, 0.3, "这套机制，一句话：", 10, AMBER, True)
tx(s, 0.98, 2.36, 11.4, 0.32,
   "把「记忆 + 新信息」压成几条候选动机，挑一条此刻能做、也值得做的，再决定在哪说。", 14, INK)

# ── 四步逻辑链 ────────────────────────────────────────────
steps = [
    ("①", "输入", "人格 · 记忆 · 她刚看到的东西", "来源：QQ / B站 / 桌宠", BLUE),
    ("②", "提炼", "压成几条候选动机", "不是从模板里抽一句", AMBER),
    ("③", "决策", "挑「此刻能做 + 值得做」的一条", "四道闸门见下", GREEN),
    ("④", "出口", "QQ 或 桌宠，二选一", "一个说了，另一个就不说", PINK),
]
cw, gap, ch = 2.72, 0.34, 1.52
for i, (num, title, desc, extra, color) in enumerate(steps):
    x = 0.7 + i * (cw + gap)
    rect(s, x, 3.0, cw, ch, fill=PANEL)
    bar(s, x, 3.0, cw, 0.05, color)
    tx(s, x + 0.2, 3.18, 0.4, 0.3, num, 12, color, True)
    tx(s, x + 0.62, 3.16, cw - 0.8, 0.35, title, 15, INK, True)
    tx(s, x + 0.2, 3.62, cw - 0.4, 0.62, desc, 9.8, DIM, line=1.4)
    tx(s, x + 0.2, 4.16, cw - 0.4, 0.3, extra, 8.5, FAINT)
    if i < 3:
        arrow(s, x + cw + 0.06, 3.68, 0.22, 0.16, FAINT)

# ── 四道硬闸门 ────────────────────────────────────────────
tx(s, 0.7, 4.74, 6.0, 0.3, "③ 的硬闸门：一条不满足，就不发这条目的", 9.5, FAINT)
gates = [("安静时段", "别半夜炸群"), ("每日上限", "不刷屏"), ("主人在忙", "不打扰"), ("token 额度", "不烧超")]
gw = 2.85
for i, (name, why) in enumerate(gates):
    gx = 0.7 + i * (gw + 0.14)
    rect(s, gx, 5.06, gw, 0.5, fill=PANEL2)
    bar(s, gx, 5.06, 0.05, 0.5, AMBER)
    tx(s, gx + 0.18, 5.14, 1.4, 0.3, name, 10.5, INK, True)
    tx(s, gx + 1.5, 5.16, gw - 1.65, 0.3, why, 8.5, FAINT, align=PP_ALIGN.RIGHT)

# ── 核心宣言 ──────────────────────────────────────────────
rect(s, 0.7, 5.9, 11.91, 0.95, fill=PANEL, line=PINK)
tx(s, 1.0, 6.02, 11.3, 0.3, "决定她像不像「活人」的，不是回复质量", 10.5, DIM)
tx(s, 1.0, 6.32, 11.3, 0.42, "而是 —— 她有没有「自己想干的事」。", 19, PINK, True)

footnote(s, "没有目的，她只是个会回复的机器人；有了目的，她才会主动来找你。", y=6.98)

notes(s, "Part 3 是整场的核心：目的机制。人格遇到信息、结合记忆，会催生一个「我想干什么」——"
         "机制一句话就能讲完：把记忆和新信息压成几条候选动机，挑一条此刻能做、也值得做的，再决定在哪说。"
         "中间有四道硬闸门（安静时段、每日上限、主人在忙、额度），所以「主动」不等于「打扰」。")

prs.save(OUT)
print(f"saved {OUT}")
