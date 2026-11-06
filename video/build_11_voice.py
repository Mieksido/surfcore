#!/usr/bin/env python3
"""第十一页：Part 8 · 语音。

用户给的框架：
  · 自选音色、即时生成、两套模型；
  · 本地：已训练好，免费、质量过关；缺点音色不可变、文件大、生成慢、少一点真实感；
  · 云端：更像真人、可自选音色训练、体积小、速度快；缺点按量付费（3 元/万字）；
  · 语音系统可同时载入 QQ 与桌宠。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("11-voice.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 8 · 语音", "自选音色，即时生成")
tx(s, 0.7, 1.44, 11.9, 0.35, "本地跑得起，云端更像人 —— 你选哪套，她就用哪套出声", 14, DIM)


def voice_card(x, title, badge, badge_color, port, pros, cons, accent):
    rect(s, x, 1.92, 5.86, 3.62, fill=PANEL)
    bar(s, x, 1.92, 5.86, 0.05, accent)
    tx(s, x + 0.25, 2.05, 3.6, 0.34, title, 15, INK, True)
    tw = 0.28 + len(badge) * 0.12
    rect(s, x + 4.0, 2.06, tw, 0.3, fill=PANEL2)
    tx(s, x + 4.0, 2.1, tw, 0.24, badge, 8.2, badge_color, True, align=PP_ALIGN.CENTER)
    tx(s, x + 0.25, 2.42, 5.2, 0.26, port, 8.5, FAINT)

    tx(s, x + 0.25, 2.74, 5.2, 0.26, "优点", 7.8, GREEN, True)
    py = 3.0
    for item in pros:
        tx(s, x + 0.25, py, 0.24, 0.24, "✓", 9, GREEN, True)
        tx(s, x + 0.5, py - 0.01, 5.1, 0.3, item, 9.2, INK)
        py += 0.32
    tx(s, x + 0.25, py + 0.04, 5.2, 0.26, "缺点", 7.8, AMBER, True)
    py += 0.3
    for item in cons:
        tx(s, x + 0.25, py, 0.24, 0.24, "·", 9, AMBER, True)
        tx(s, x + 0.5, py - 0.01, 5.1, 0.3, item, 9.2, DIM)
        py += 0.32


voice_card(
    0.7, "本地模型", "免费 · 断网可用", GREEN, "端口 8765 · 已训练好的 GPT-SoVITS 音色 · 约 7.3GB",
    ["不花钱，断网也能出声", "质量过关，日常够用", "音色固定，不用调也不跑调"],
    ["音色不可变（想换要重训）", "文件大：约 7.3GB（含运行库）", "生成慢一点（1.0–1.5 秒），语气稍平"],
    BLUE,
)

voice_card(
    6.75, "云端模型", "按量付费", AMBER, "端口 8767 · 第三方声音复刻 · 约 264MB",
    ["语气语调更像真人，停顿更自然", "可以训练自己的专属音色", "体积小、生成快（0.5–1.1 秒）"],
    ["按字符计费：约 3 元 / 万字", "断网就用不了，依赖第三方服务"],
    PINK,
)

# ── 底部：一套系统两个入口 ─────────────────────────────────
rect(s, 0.7, 5.78, 11.91, 0.62, fill=PANEL)
bar(s, 0.7, 5.78, 0.08, 0.62, GREEN)
tx(s, 0.98, 5.9, 11.4, 0.3, "一套语音系统，两个入口：QQ 里发语音、桌宠里说话，共用同一份音色设置。", 12, INK, True)
tx(s, 0.98, 6.16, 11.4, 0.24, "在设置页切换本地 / 云端，下一次合成自动生效，不用重启桌宠。", 8.2, FAINT)

footnote(s, "AI 发语音默认是关的：想让她开口，得你在设置里亲自打开。", y=6.8)

notes(s, "Part 8 是语音。两套模型：本地那套免费、断网可用，音色是训练好的、换不了，体积七点三个 G，"
         "慢一点、语气平一点；云端那套更像真人，能训练专属音色，体积两百多兆、半秒到一秒出音，"
         "但按字符计费，大约三块钱一万字。两套共用一套语音系统，QQ 和桌宠同时接，设置页切一下就行。")

prs.save(OUT)
print(f"saved {OUT}")
