#!/usr/bin/env python3
"""第二页：Part 1 · 角色系统（灵魂）。

用户给的框架：
  · 本质 = 一份目录下的人设卡 + 记忆卡；
  · 载入自拟人设卡 → 生成新角色 + 一张空白记忆卡；
  · 不同目录不同角色，可载入多个角色；
  · 角色是插件的「意识」：人格遇到三平台记录的信息 → 产生独特目的 → 行为反馈到三平台。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, EDGE, FAINT, GREEN, INK, MONO, PANEL, PANEL2, PINK,
    arrow, bar, dashed_arrow, footnote, header, new_deck, new_slide, notes, page_number, rect, tx,
)

OUT = Path(__file__).with_name("02-character-system.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 1 · 角色系统（灵魂）", "一份目录，一个意识")

# ── 上半：目录 → 载入 → 多角色 ───────────────────────────────
tx(s, 0.7, 1.52, 4.0, 0.3, "① 本质：人设卡 + 记忆卡", 11, FAINT, True)

rect(s, 0.7, 1.85, 3.55, 2.4, fill=PANEL)
tx(s, 0.92, 1.98, 3.1, 0.3, "一个目录 = 一个角色", 13, INK, True)
tree = (
    "characters/\n"
    " └─ char-a/\n"
    "     ├─ persona.md   人设卡\n"
    "     ├─ memory/      记忆卡\n"
    "     └─ bili/        行为账本"
)
tx(s, 0.92, 2.34, 3.1, 1.5, tree, 9.8, DIM, font=MONO, line=1.42)
tx(s, 0.92, 3.86, 3.1, 0.3, "目录名就是角色，互不干扰", 9.5, FAINT)

arrow(s, 4.38, 2.88, 0.26, 0.16, DIM)

tx(s, 4.75, 1.52, 3.4, 0.3, "② 载入人设卡", 11, FAINT, True)
rect(s, 4.75, 1.85, 3.35, 2.4, fill=PANEL)
tx(s, 4.97, 1.98, 2.9, 0.3, "用户自拟一张卡", 12.5, INK, True)
flow = [("persona.md", "写你想让她是谁", BLUE), ("新角色", "生成一份独立角色包", AMBER), ("空白记忆卡", "从零开始记她的事", GREEN)]
fy = 2.4
for i, (name, sub, color) in enumerate(flow):
    rect(s, 4.97, fy, 2.9, 0.5, fill=PANEL2)
    bar(s, 4.97, fy, 0.06, 0.5, color)
    tx(s, 5.14, fy + 0.08, 2.5, 0.35, f"{name} · {sub}", 9.8, INK)
    if i < 2:
        arrow(s, 6.32, fy + 0.54, 0.14, 0.1, DIM, down=True)
    fy += 0.66

arrow(s, 8.22, 2.88, 0.26, 0.16, DIM)

tx(s, 8.6, 1.52, 4.1, 0.3, "③ 可载入多个角色", 11, FAINT, True)
rect(s, 8.6, 1.85, 4.05, 2.4, fill=PANEL)
chars = [("角色 A", "人设 · 记忆 · 账本", True), ("角色 B", "人设 · 记忆 · 账本", False), ("角色 C", "人设 · 记忆 · 账本", False)]
cy = 2.0
for name, sub, active in chars:
    rect(s, 8.8, cy, 3.65, 0.62, fill=PANEL2 if active else PANEL, line=BLUE if active else EDGE)
    tx(s, 9.0, cy + 0.08, 1.2, 0.3, name, 11.5, INK, True)
    tx(s, 10.1, cy + 0.12, 2.2, 0.3, sub, 9.3, DIM)
    if active:
        tx(s, 11.55, cy + 0.14, 0.75, 0.3, "激活", 9, BLUE, True, align=PP_ALIGN.CENTER)
    cy += 0.74
tx(s, 8.8, 3.9, 3.7, 0.3, "切换 = 整包切换，不是换一句提示词", 9.5, FAINT)

# ── 下半：意识闭环 ─────────────────────────────────────────
bar(s, 0.7, 4.62, 1.0, 0.05, PINK)
tx(s, 0.7, 4.72, 8.0, 0.35, "④ 它为什么会自己动：人格 × 信息 → 目的 → 行为", 13, INK, True)

node_y, node_h = 5.22, 1.35
# 人格
rect(s, 0.7, node_y, 2.25, node_h, fill=PANEL, line=BLUE)
tx(s, 0.9, node_y + 0.16, 1.9, 0.3, "人格（意识）", 11, BLUE, True)
tx(s, 0.9, node_y + 0.52, 1.9, 0.7, "人设 + 记忆\n一个角色只有一份", 9.5, DIM, line=1.35)

tx(s, 3.02, node_y + 0.48, 0.25, 0.3, "+", 16, DIM, True, align=PP_ALIGN.CENTER)

# 信息
rect(s, 3.3, node_y, 2.35, node_h, fill=PANEL, line=AMBER)
tx(s, 3.5, node_y + 0.16, 2.0, 0.3, "信息", 11, AMBER, True)
tx(s, 3.5, node_y + 0.52, 2.0, 0.7, "三平台记录下来的\n消息 / 见闻 / 互动", 9.5, DIM, line=1.35)

arrow(s, 5.72, node_y + 0.58, 0.3, 0.18, DIM)

# 目的
rect(s, 6.08, node_y, 2.3, node_h, fill=PANEL2, line=AMBER)
tx(s, 6.28, node_y + 0.16, 1.95, 0.3, "目的", 11, AMBER, True)
tx(s, 6.28, node_y + 0.52, 1.95, 0.7, "只属于这个角色\n的动机（不是模板）", 9.5, DIM, line=1.35)

arrow(s, 8.45, node_y + 0.58, 0.3, 0.18, DIM)

# 行为
rect(s, 8.82, node_y, 3.8, node_h, fill=PANEL)
tx(s, 9.02, node_y + 0.16, 3.4, 0.3, "行为 · 反馈回三平台", 11, GREEN, True)
chips = [("QQ 开口", BLUE, 0.9), ("B站 动态/评论", PINK, 1.35), ("桌宠 冒话", GREEN, 0.85)]
cx = 9.02
for name, color, w in chips:
    rect(s, cx, node_y + 0.62, w, 0.34, fill=PANEL2)
    bar(s, cx, node_y + 0.62, 0.05, 0.34, color)
    tx(s, cx + 0.12, node_y + 0.69, w - 0.16, 0.26, name, 8.3, INK)
    cx += w + 0.12
tx(s, 9.02, node_y + 1.02, 3.4, 0.26, "同一份人格，三个出口", 9, FAINT)

# 回环：行为 → 信息
dashed_arrow(s, 10.7, node_y + node_h + 0.06, 4.5, node_y + node_h + 0.06, FAINT)
tx(s, 5.3, node_y + node_h + 0.12, 4.6, 0.26, "这些行为又会被三平台记下来，回到记忆", 9, FAINT, align=PP_ALIGN.CENTER)

footnote(s, "角色不是「一个提示词」：它是一份目录 —— 人设、记忆、行为账本，整包切换、整包回档。", y=6.95)

notes(s, "Part 1 讲角色系统：一个角色 = 一个目录（persona.md + memory/ + bili/）。"
         "用户自己写一张人设卡，载入就生成一个角色和一张空白记忆卡；不同目录就是不同角色，可以并存、整包切换。"
         "它就是这个插件的意识：人格遇上三平台记下来的信息，长出这个角色独有的目的，再以行为回到三个平台。")
page_number(s, 2)

prs.save(OUT)
print(f"saved {OUT}")
