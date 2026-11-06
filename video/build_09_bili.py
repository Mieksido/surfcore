#!/usr/bin/env python3
"""第九页：Part 6 · B站。

用户给的框架：
  · 像真人一样会刷视频、发动态（大标题）；
  · 小字：改编自 B站 @凌羽clover；
  · 生物钟、一键抓取主人偏好并自选填入，其余由我补充。
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("09-bili.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 6 · B站", "像真人一样会刷视频、发动态")
tx(s, 0.7, 1.44, 8.0, 0.3, "有自己的作息、自己的口味、自己的额度", 14, DIM)
tx(s, 9.4, 1.47, 3.2, 0.3, "创意改编自 B站 @凌羽clover", 9, FAINT, align=PP_ALIGN.RIGHT)

# ── 左：生物钟 ────────────────────────────────────────────
rect(s, 0.7, 1.92, 6.9, 3.05, fill=PANEL)
tx(s, 0.95, 2.06, 4.0, 0.32, "生物钟", 13, INK, True)
tx(s, 0.95, 2.42, 5.2, 0.28, "一天分成几段清醒窗口，每段醒来几次，不是 24 小时待机", 8.8, FAINT)

# 0-24 小时时间轴
TX, TW, TY, TH = 0.95, 6.4, 3.02, 0.28
rect(s, TX, TY, TW, TH, fill=PANEL2)
windows = [(10, 12), (14, 16), (18, 20), (22, 24)]
for start, end in windows:
    x = TX + TW * start / 24
    w = TW * (end - start) / 24
    rect(s, x, TY, w, TH, fill=BLUE)
    tx(s, x, TY + TH + 0.06, w, 0.24, f"{start:02d}–{end:02d}", 7.5, DIM, align=PP_ALIGN.CENTER)
tx(s, TX, TY - 0.28, 2.0, 0.24, "0 点", 7.5, FAINT)
tx(s, TX + TW - 0.6, TY - 0.28, 0.9, 0.24, "24 点", 7.5, FAINT, align=PP_ALIGN.RIGHT)

tx(s, 0.95, 3.78, 6.4, 0.3, "每段窗口里醒 3 次；今天有 30% 概率干脆不醒", 9.2, DIM)
tx(s, 0.95, 4.16, 6.4, 0.3, "醒来做四件事：看视频 → 打分 → 评论回帖 → 想发才发一条动态", 9.2, DIM)

# ── 右上：偏好抓取 ────────────────────────────────────────
rect(s, 7.85, 1.92, 4.78, 1.5, fill=PANEL)
tx(s, 8.08, 2.04, 4.3, 0.3, "一键抓取主人偏好", 12, INK, True)
tx(s, 8.08, 2.36, 4.35, 0.3, "点一下，抓主人账号的公开偏好（只读），自动填进偏好表", 8.6, DIM)
for i, (label, color) in enumerate([("✓ 喜欢", GREEN), ("✕ 不喜欢", PINK)]):
    x = 8.08 + i * 2.1
    rect(s, x, 2.76, 1.95, 0.34, fill=PANEL2)
    bar(s, x, 2.76, 0.05, 0.34, color)
    tx(s, x + 0.16, 2.83, 1.7, 0.24, label, 9, INK)
tx(s, 8.08, 3.14, 4.4, 0.24, "不读浏览器 cookie，只用账号自己的公开数据", 7.8, FAINT)

# ── 右下：额度 ────────────────────────────────────────────
rect(s, 7.85, 3.6, 4.78, 1.37, fill=PANEL)
tx(s, 8.08, 3.7, 4.3, 0.3, "每天的额度", 11.5, INK, True)
quota = [("30", "个视频"), ("50", "条回复"), ("30", "个赞"), ("10", "次投币")]
for i, (num, label) in enumerate(quota):
    x = 8.08 + i * 1.12
    tx(s, x, 4.04, 1.0, 0.4, num, 18, BLUE, True)
    tx(s, x, 4.44, 1.05, 0.24, label, 8, DIM)

# ── 底部能力 ──────────────────────────────────────────────
chips = ["扫码登录（主人/她自己两个号）", "看视频 · 打分 · 收藏", "评论 / 回帖", "发动态", "私信", "分享到 QQ", "观看历史"]
cx = 0.7
cy = 5.28
for text in chips:
    w = 0.35 + len(text) * 0.115
    if cx + w > 12.6:
        cx, cy = 0.7, cy + 0.44
    rect(s, cx, cy, w, 0.36, fill=PANEL2)
    tx(s, cx + 0.14, cy + 0.07, w - 0.2, 0.24, text, 8.6, INK)
    cx += w + 0.12

bar(s, 0.7, 5.92, 11.91, 0.5, PANEL)
rect(s, 0.7, 5.92, 11.91, 0.5, fill=PANEL)
bar(s, 0.7, 5.92, 0.08, 0.5, PINK)
tx(s, 0.98, 6.04, 11.4, 0.3, "她不是「定时发广告」——她先看，再决定说什么、要不要说。", 11, INK, True)

footnote(s, "34 个命令 · 四段作息 · 额度可改；看不看、说什么，都还在她自己手里。", y=6.95)

notes(s, "Part 6 是 B站。她像一个真的用户：有自己的作息，一天分几段窗口、每段醒几次，"
         "醒来就是看视频、打分、评论，想发才发一条动态；每天还有固定额度。"
         "下面这两个小卡：一键抓取主人偏好（只读，不读浏览器 cookie），填进她自己的偏好表；"
         "以及她的每日额度。这个玩法最早来自 B站 @凌羽clover 的设想，我们把它做成了能跑的东西。")

prs.save(OUT)
print(f"saved {OUT}")
