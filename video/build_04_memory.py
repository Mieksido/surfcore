#!/usr/bin/env python3
"""第四页：Part 2 · 记忆系统 —— 可塑性记忆。

用户给的框架：
  · 只有「最早 / 最近 / 最重要」的事情保留清晰记忆；
  · 其余记忆随时间逐日淡忘，模拟人类记忆系统。

单页输出 04-memory.pptx（不带页码，合并时由 pptx_merge 统一编号）。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, bar, footnote, header,
    new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("04-memory.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 2 · 记忆系统", "可塑性记忆")
tx(s, 0.7, 1.5, 11.9, 0.4, "只记住开头、最近，和真正重要的事 —— 其余逐日淡忘", 15, DIM)

# ── 记忆清晰度曲线 ─────────────────────────────────────────
BASE_Y = 4.3
MAX_H = 2.05
X0, PITCH, BW = 0.95, 0.322, 0.16

# 36 段：最早高 → 中段低并带三个「重要」峰 → 最近回升
heights = []
heights += [1.62, 1.42, 1.24, 1.06, 0.88]                       # 最早
for i in range(5, 30):                                          # 中间：逐日淡忘
    heights.append(round(0.62 * (0.985 ** (i - 5)) + 0.08, 3))
peaks = {13: 1.5, 19: 1.36, 25: 1.58}                           # 重要的三件事
for idx, h in peaks.items():
    heights[idx] = h
for h in [0.82, 1.02, 1.24, 1.45, 1.62, 1.72]:                  # 最近
    heights.append(h)

for i, h in enumerate(heights):
    x = X0 + i * PITCH
    y = BASE_Y - h
    if i in peaks:
        color = AMBER
    elif i < 5 or i >= 30:
        color = BLUE
    else:
        color = PANEL2 if h < 0.5 else FAINT
    bar(s, x, y, BW, h, color)

# 基线
bar(s, X0 - 0.06, BASE_Y, 11.55, 0.015, PANEL2)

# 三个峰的文字标注
for idx, label in [(13, "重要"), (19, "重要"), (25, "重要")]:
    x = X0 + idx * PITCH - 0.2
    tx(s, x, BASE_Y - heights[idx] - 0.34, 0.75, 0.26, label, 8.5, AMBER, True, align=PP_ALIGN.CENTER)

# 时间轴标签
tx(s, X0 - 0.1, BASE_Y + 0.12, 1.6, 0.3, "最早", 10, BLUE, True)
tx(s, 5.55, BASE_Y + 0.12, 2.4, 0.3, "逐日淡忘 →", 10, FAINT)
tx(s, 11.35, BASE_Y + 0.12, 1.3, 0.3, "现在", 10, BLUE, True, align=PP_ALIGN.RIGHT)

# 曲线注脚
tx(s, X0 - 0.1, 1.98, 6.4, 0.3, "记忆清晰度（越矮越模糊）", 9.5, FAINT)

# ── 三张卡 ────────────────────────────────────────────────
cards = [
    ("最早 · 起点", "第一次见面、第一句话\n记得最清楚，也最不容易动", BLUE),
    ("最近 · 眼前", "刚发生的事全都还在\n越新越清楚，细节最全", GREEN),
    ("重要 · 反复用到", "被反复想起、反复用到的\n不但不忘，还会越来越牢", AMBER),
]
cw, gap = 3.85, 0.22
for i, (title, desc, color) in enumerate(cards):
    x = 0.7 + i * (cw + gap)
    rect(s, x, 4.98, cw, 1.42, fill=PANEL)
    bar(s, x, 4.98, 0.07, 1.42, color)
    tx(s, x + 0.26, 5.12, cw - 0.5, 0.32, title, 12, INK, True)
    tx(s, x + 0.26, 5.52, cw - 0.5, 0.8, desc, 9.5, DIM, line=1.4)

# ── 底注 ──────────────────────────────────────────────────
footnote(s, "记忆不是数据库：不重要的会淡出，重要的会被反复加固 —— 这是设计，不是 bug。", y=6.92)

notes(s, "Part 2 讲记忆。它不是一张只增不减的表，而是一条会变的曲线："
         "最早的事、最近的事、反复用到的三件事最清楚，其余随着日子一天天淡下去。"
         "淡出不是删除，是变模糊——这就是「可塑性」三个字的全部意思。")

prs.save(OUT)
print(f"saved {OUT}")
