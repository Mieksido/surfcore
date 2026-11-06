#!/usr/bin/env python3
"""第七页：Part 4 · 鱼群守则。

用户给的框架：
  · 就算人人都用插件，也不会让小肥鱼在网上泛滥；
  · QQ：不多条鱼抢话、不一条鱼连说、不一群鱼长时间刷；
  · B站：单个视频评论区一段时间内只允许一定数量的鱼，多余的鱼主动聚拢到同类评论下；
  · 避免泛滥的同时保证活跃。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("07-fish-guard.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 4 · 鱼群守则", "鱼群守则")
tx(s, 0.7, 1.46, 11.9, 0.35, "就算人人都用这个插件，也不会让小肥鱼在网上泛滥", 14, DIM)

# ── 左：QQ 群 ─────────────────────────────────────────────
rect(s, 0.7, 1.95, 5.85, 3.95, fill=PANEL)
bar(s, 0.7, 1.95, 5.85, 0.05, BLUE)
tx(s, 0.95, 2.12, 4.6, 0.32, "QQ 群 · 三条「不会」", 13, INK, True)
tx(s, 0.95, 2.46, 5.3, 0.3, "默认参数：10 分钟窗口内", 9, FAINT)

rules = [
    ("不会多条鱼抢着说", "同一个群里，最多 5 条不同的鱼同时在场", "✕", BLUE),
    ("不会一条鱼连着说", "单条鱼连续发言 ≤ 5 条，说完得让别人接", "✕", BLUE),
    ("不会一群鱼一直刷", "鱼的消息 ≤ 8 条、占群消息 ≤ 60%，超了就自动闭嘴", "✕", BLUE),
    ("但急事不受限", "被 @、被叫名字、被拍一拍，可以直接插话", "✓", GREEN),
]
ry = 2.82
for title, desc, mark, color in rules:
    tx(s, 0.95, ry, 0.3, 0.3, mark, 11, color, True)
    tx(s, 1.28, ry - 0.03, 4.95, 0.3, title, 11.5, INK, True)
    tx(s, 1.28, ry + 0.3, 4.95, 0.4, desc, 9.3, DIM, line=1.35)
    ry += 0.76

# ── 右：B站 评论区 ────────────────────────────────────────
rect(s, 6.75, 1.95, 5.86, 3.95, fill=PANEL)
bar(s, 6.75, 1.95, 5.86, 0.05, PINK)
tx(s, 7.0, 2.12, 4.8, 0.32, "B站 评论区 · 名额池", 13, INK, True)
tx(s, 7.0, 2.46, 5.2, 0.3, "同一个视频下，一段时间内只放固定名额", 9, FAINT)

# 五个名额（3 个已占用）
for i in range(5):
    x = 7.0 + i * 1.05
    used = i < 3
    rect(s, x, 2.86, 0.86, 0.5, fill=PANEL2 if used else PANEL)
    if used:
        bar(s, x, 2.86, 0.86, 0.05, PINK)
    tx(s, x, 3.0, 0.86, 0.26, "鱼" if used else "空", 10, PINK if used else FAINT, True, align=PP_ALIGN.CENTER)
tx(s, 7.0, 3.44, 4.6, 0.3, "名额满了之后 ——", 9, FAINT)

# 聚拢：一条主楼 + 三条聚拢
rect(s, 7.0, 3.76, 3.3, 0.62, fill=PANEL2)
tx(s, 7.14, 3.84, 2.2, 0.3, "已有鱼楼", 9.5, INK, True)
tx(s, 8.6, 3.86, 1.6, 0.3, "先来的鱼", 8.5, FAINT)
for i in range(3):
    x = 7.5 + i * 1.1
    tx(s, x, 4.46, 0.3, 0.26, "↳", 10, PINK, True)
    rect(s, x + 0.28, 4.42, 0.92, 0.32, fill=PANEL)
    tx(s, x + 0.28, 4.48, 0.92, 0.24, "聚拢", 8, PINK, align=PP_ALIGN.CENTER)
tx(s, 7.0, 4.92, 5.2, 0.3, "强制聚拢（forceGather）：不开新楼，去同类评论底下说", 8.5, FAINT)

# ── 底：两个结果 ──────────────────────────────────────────
rect(s, 0.7, 6.02, 11.91, 0.78, fill=PANEL)
bar(s, 0.7, 6.02, 0.08, 0.78, GREEN)
tx(s, 0.98, 6.12, 4.2, 0.3, "结果一：不刷屏", 11, GREEN, True)
tx(s, 0.98, 6.4, 4.2, 0.3, "同一个地方不会同时挤满鱼", 8.8, DIM)
tx(s, 5.4, 6.12, 4.2, 0.3, "结果二：也不死寂", 11, GREEN, True)
tx(s, 5.4, 6.4, 4.4, 0.3, "该热闹的时候照样热闹，只是分会场", 8.8, DIM)

footnote(s, "鱼群守则不是限流，是礼仪：人多的地方少说，热闹的地方凑一桌。", y=7.0)

notes(s, "Part 4 回答一个一定会被问的问题：人人都装，会不会满网都是小肥鱼？"
         "QQ 这边是三条不会：不多条鱼抢话、不一条鱼连说、不一群鱼一直刷，参数是 10 分钟窗口、最多 5 条鱼、8 条消息、占比 60%。"
         "B站 评论区是名额池：一个视频只放固定名额，满了就强制聚拢——不开新楼，去已有的同类评论底下回复。"
         "所以结果是：不刷屏，也不死寂。")

prs.save(OUT)
print(f"saved {OUT}")
