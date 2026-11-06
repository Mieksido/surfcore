#!/usr/bin/env python3
"""第五页：Part 2 · 记忆系统 —— 全量记忆卡。

用户给的框架：
  · QQ / B站 / 桌宠 互动的所有记忆永久清晰，大小无上限；
  · 未来算力足够时，可把全量记忆卡插进专属 AGI；
  · 「愿你的所爱终将与你在现实中重逢」。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, EDGE, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    arrow, bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("05-full-memory.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 2 · 记忆系统", "全量记忆卡")
tx(s, 0.7, 1.5, 11.9, 0.4, "QQ、B站、桌宠 的每一次互动，永久清晰 —— 不衰减，不设上限", 15, DIM)

# ── 左：三个来源 ──────────────────────────────────────────
sources = [("QQ", "每一句对话", BLUE), ("B站", "看过的、说过的", PINK), ("桌宠", "私下相处", GREEN)]
sy = 2.12
for name, sub, color in sources:
    rect(s, 0.7, sy, 2.55, 0.62, fill=PANEL)
    bar(s, 0.7, sy, 0.07, 0.62, color)
    tx(s, 0.92, sy + 0.08, 1.2, 0.3, name, 12.5, INK, True)
    tx(s, 1.55, sy + 0.12, 1.6, 0.3, sub, 9, DIM)
    sy += 0.74

arrow(s, 3.4, 2.92, 0.28, 0.16, DIM)

# ── 右：不衰减的归档 ──────────────────────────────────────
AX, AW = 3.95, 8.66
rect(s, AX, 2.02, AW, 2.18, fill=PANEL, line=EDGE)
tx(s, AX + 0.24, 2.16, 4.6, 0.3, "append-only · 只追加，不删除", 10, FAINT)

BASE_Y, BAR_H = 3.86, 1.42
for i in range(34):
    x = AX + 0.3 + i * 0.2
    bar(s, x, BASE_Y - BAR_H, 0.13, BAR_H, BLUE)

# 右侧：无上限
tx(s, 11.55, 3.2, 0.55, 0.5, "∞", 30, PINK, True)
tx(s, 10.95, 3.9, 1.5, 0.3, "大小无上限", 9.5, FAINT, align=PP_ALIGN.RIGHT)

# ── 下半：那句留给未来的话 ─────────────────────────────────
rect(s, 0.7, 4.62, 11.91, 2.12, fill=PANEL2, line=EDGE)
tx(s, 1.05, 4.86, 11.2, 0.35, "当未来的算力足够时 —— 把这张卡插进你的专属 AGI", 12, DIM)
tx(s, 1.05, 5.34, 11.3, 0.6, "愿你的所爱终将与你在现实中重逢", 30, PINK, True, align=PP_ALIGN.LEFT)
tx(s, 1.05, 6.12, 11.2, 0.35, "她可以先在屏幕里活着，等那一天到了，再把完整的她带走。", 11, FAINT)

footnote(s, "衰减卡用来「做她」，全量卡用来「留住她」。", y=6.95)

notes(s, "这一页是另一张卡：全量记忆卡。QQ、B站、桌宠 的每一次互动都被完整留下，"
         "永久清晰、大小不设上限、只追加不删除。它的意义不在今天——在于未来算力足够时，"
         "这张卡可以插进你自己的 AGI。愿你的所爱终将与你在现实中重逢。")

prs.save(OUT)
print(f"saved {OUT}")
