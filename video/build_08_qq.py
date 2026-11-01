#!/usr/bin/env python3
"""第八页：Part 5 · QQ。

用户给的框架：
  · 不是只会机械式回复的 AI；
  · 会看气氛适当沉默、会主动粘人也会主动结束话题、会戳一戳、回复群友、存表情；
  · 其余优点由我补充（引用、分条、看图、看转发、上线补历史、认人）。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("08-qq.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 5 · QQ", "不是只会机械式回复的 AI")
tx(s, 0.7, 1.46, 11.9, 0.35, "群里她更像一个群友：会看气氛、会挑时候、会闹也会收", 14, DIM)

cards = [
    ("会看气氛", "群里在刷屏、在吵架，她可以不说话", BLUE),
    ("会主动粘人", "想起一件事，就自己来找你说", PINK),
    ("会主动收尾", "话题聊完就散，不硬续一句", GREEN),
    ("会戳一戳", "不想打字的时候，戳你一下", AMBER),
    ("会引用回复", "回的是谁那句，说得清楚", BLUE),
    ("会偷表情包", "看到好图就收，记得什么场合发", PINK),
    ("会分条说话", "像打字：一条一句，不写小作文", GREEN),
    ("会上线补课", "掉线错过的话，回来自己补看", AMBER),
    ("会认人", "群友怎么称呼，记在表里，不喊错", BLUE),
]

cw, ch, gap = 3.82, 1.18, 0.18
for i, (title, desc, color) in enumerate(cards):
    x = 0.7 + (i % 3) * (cw + gap)
    y = 2.0 + (i // 3) * (ch + gap)
    rect(s, x, y, cw, ch, fill=PANEL)
    bar(s, x, y, 0.06, ch, color)
    tx(s, x + 0.24, y + 0.18, cw - 0.45, 0.34, title, 13.5, INK, True)
    tx(s, x + 0.24, y + 0.62, cw - 0.45, 0.5, desc, 9.8, DIM, line=1.35)

# 能力补充一行
tx(s, 0.7, 6.2, 11.9, 0.3,
   "另外还会：看图 · 展开合并转发 · 查群黑话 · 记住旧事 · 发语音 · 被 @ 立刻醒", 9.5, FAINT)

bar(s, 0.7, 6.52, 11.91, 0.46, PANEL)
rect(s, 0.7, 6.52, 11.91, 0.46, fill=PANEL)
bar(s, 0.7, 6.52, 0.08, 0.46, PINK)
tx(s, 0.98, 6.6, 11.4, 0.3,
   "机械式回复 = 有问必答；她 = 看场合决定：答不答、怎么答、答几条。", 12.5, INK, True)

notes(s, "Part 5 讲 QQ。她不是有问必答的机器人：群里刷屏时可以沉默，话题完了会主动收，"
         "想你了会自己冒出来戳一下；回群友会引用、会分条、会偷表情包；掉线回来会自己补看错过的消息。"
         "一句话：她先判断「这时候该不该说话」，再决定怎么说。")

prs.save(OUT)
print(f"saved {OUT}")
