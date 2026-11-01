#!/usr/bin/env python3
"""第十页：Part 7 · 桌宠。

用户给的框架：
  · 五个皮肤，均载入完整 Live2D 工程文件；
  · 文本与语音互动；
  · 互动内容写入记忆卡。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from pptx.util import Inches
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    arrow, bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("10-pet.pptx")
SKINS = Path("D:/deepseekwork/pet/skins")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 7 · 桌宠", "五个皮肤，一个她")
tx(s, 0.7, 1.44, 11.9, 0.35, "透明置顶 · 点击穿透 · 文本与语音对话 · 聊过的都写进记忆卡", 14, DIM)

# ── 左：五个皮肤 ──────────────────────────────────────────
rect(s, 0.7, 1.9, 7.35, 2.62, fill=PANEL)
tx(s, 0.95, 2.02, 6.6, 0.3, "五个皮肤 · 均载入完整 Live2D 工程文件", 12.5, INK, True)
skins = [
    ("01", "今天元气一点", "半身前倾"),
    ("02", "今天少女一点", "全身站姿"),
    ("03", "今天Q弹一点", "Q 版半身"),
    ("04", "今天穿暖和点", "冬装毛领"),
    ("05", "今天硬气一点", "扣着汤盆"),
]
for i, (num, name, form) in enumerate(skins):
    x = 0.95 + i * 1.42
    rect(s, x, 2.38, 0.95, 0.95, fill=PANEL2, line=BLUE if i == 2 else PANEL2)
    preview = SKINS / f"feiyu-{num}" / "preview.png"
    if preview.exists():
        s.shapes.add_picture(str(preview), Inches(x + 0.02), Inches(2.4), Inches(0.91), Inches(0.91))
    tx(s, x, 3.4, 1.2, 0.24, name, 8.5, INK, True)
    tx(s, x, 3.66, 1.2, 0.24, form, 7.8, FAINT)
tx(s, 0.95, 4.12, 6.9, 0.28, "右键「穿什么呢」即时换装，选择会记住；五套共用同一套骨骼与交互逻辑", 8.8, FAINT)

# ── 右：互动方式 ──────────────────────────────────────────
rect(s, 8.3, 1.9, 4.33, 2.62, fill=PANEL)
tx(s, 8.53, 2.02, 3.9, 0.3, "怎么互动", 12.5, INK, True)
ways = [
    ("文本对话", "右键一句，她回一句"),
    ("语音对话", "路由跟随 SurfCore 的语音设置"),
    ("气泡 + 回复", "她说的话在头顶，点「回复」直接接"),
    ("专注模式", "不主动打扰，只留对话入口"),
]
wy = 2.42
for name, desc in ways:
    bar(s, 8.53, wy + 0.06, 0.05, 0.3, PINK)
    tx(s, 8.68, wy, 1.6, 0.26, name, 10, INK, True)
    tx(s, 10.15, wy + 0.02, 2.35, 0.24, desc, 7.8, FAINT, align=PP_ALIGN.LEFT)
    wy += 0.52

# ── 下：聊过的去哪了 ──────────────────────────────────────
tx(s, 0.7, 4.72, 8.0, 0.3, "聊过的都去哪了：写进同一张记忆卡", 11, FAINT, True)

rect(s, 0.7, 5.12, 3.1, 1.02, fill=PANEL)
tx(s, 0.92, 5.26, 2.7, 0.3, "桌宠里的对话", 11, INK, True)
tx(s, 0.92, 5.62, 2.7, 0.4, "和你说的话，单独一段「私下相处」", 8.2, DIM)

arrow(s, 3.92, 5.5, 0.3, 0.2, DIM)

rect(s, 4.35, 5.12, 3.25, 1.02, fill=PANEL2, line=AMBER)
tx(s, 4.57, 5.26, 2.9, 0.3, "记忆卡（和 QQ / B站 同一张）", 10, AMBER, True)
tx(s, 4.57, 5.62, 2.9, 0.4, "衰减规则一样：会记，也会淡", 8.2, DIM)

arrow(s, 7.72, 5.5, 0.3, 0.2, DIM)

rect(s, 8.15, 5.12, 4.48, 1.02, fill=PANEL)
tx(s, 8.37, 5.26, 4.0, 0.3, "她在别处也知道了", 11, INK, True)
tx(s, 8.37, 5.62, 4.0, 0.4, "QQ 上提一句、B站 写进评论，都是同一段记忆", 8.2, DIM)

footnote(s, "桌宠不是挂件：它是她的另一个身体，也是同一份记忆的另一个入口。", y=6.7)

notes(s, "Part 7 是桌宠。五套皮肤都是完整的 Live2D 工程，右键就能换，换的是素材不是逻辑；"
         "能文本聊、能语音聊，她说的话会冒气泡，点「回复」就接得上。"
         "最关键的是最后这条：桌宠里聊的内容会写进同一张记忆卡——所以她在 QQ 或 B站 那边也会知道。")

prs.save(OUT)
print(f"saved {OUT}")
