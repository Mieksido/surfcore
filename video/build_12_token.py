#!/usr/bin/env python3
"""第十二页：Part 9 · token 管理系统。

用户给的框架：设置全局 token 使用总额，防止 token 爆破。
（真实默认值取自 config.example.json 的 tokenGuard：20/10 次唤醒、2 分钟间隔、8 条/次、¥8/天）
"""
from pathlib import Path

from pptx.enum.text import PP_ALIGN
from deck_style import (
    AMBER, BLUE, DIM, FAINT, GREEN, INK, PANEL, PANEL2, PINK,
    bar, footnote, header, new_deck, new_slide, notes, rect, tx,
)

OUT = Path(__file__).with_name("12-token.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "Part 9 · Token 管理", "先设上限，再让她说话")
tx(s, 0.7, 1.44, 11.9, 0.35, "全局总额 + 四本账 + 四道防爆破闸门：花多少，你定", 14, DIM)

# ── 左：全局总额 ──────────────────────────────────────────
rect(s, 0.7, 1.9, 4.3, 2.62, fill=PANEL)
tx(s, 0.95, 2.02, 3.6, 0.3, "全局总额", 12.5, INK, True)
tx(s, 0.95, 2.32, 3.9, 0.26, "按 ¥ 或按 token，二选一", 8.5, FAINT)
accounts = [("QQ", BLUE), ("B站", PINK), ("其他", GREEN), ("总额", AMBER)]
ay = 2.66
for name, color in accounts:
    rect(s, 0.95, ay, 3.8, 0.34, fill=PANEL2)
    bar(s, 0.95, ay, 0.05, 0.34, color)
    tx(s, 1.12, ay + 0.06, 3.4, 0.24, name, 9.5, INK, name == "总额")
    ay += 0.4
tx(s, 0.95, 4.22, 3.9, 0.24, "单日花费上限：¥8（超过当天不再说话）", 8.2, FAINT)

# ── 右：额度条 ────────────────────────────────────────────
rect(s, 5.3, 1.9, 7.31, 2.62, fill=PANEL)
tx(s, 5.55, 2.02, 6.6, 0.3, "当天用量", 12.5, INK, True)
BARX, BARW, BARY, BARH = 5.55, 6.8, 2.62, 0.42
rect(s, BARX, BARY, BARW, BARH, fill=PANEL2)
rect(s, BARX, BARY, BARW * 0.68, BARH, fill=GREEN)
for ratio, color, label in [(0.8, AMBER, "80% 提醒"), (1.0, PINK, "100% 停手")]:
    x = BARX + BARW * ratio
    bar(s, x - 0.012, BARY - 0.1, 0.024, BARH + 0.2, color)
tx(s, BARX, BARY + BARH + 0.1, 2.4, 0.24, "0", 7.5, FAINT)
tx(s, BARX + BARW * 0.8 - 0.4, BARY + BARH + 0.34, 1.4, 0.24, "80% 提醒", 8, AMBER, True)
tx(s, BARX + BARW - 1.0, BARY + BARH + 0.34, 1.1, 0.24, "100% 停", 8, PINK, True, align=PP_ALIGN.RIGHT)
tx(s, 5.55, 3.62, 6.7, 0.26, "到 100%：当天不再发起任何请求，新消息留到明天，不会「接着烧」。", 9, DIM)

# ── 下：四道闸门 ──────────────────────────────────────────
tx(s, 0.7, 4.66, 6.0, 0.3, "防 token 爆破：四道闸门（真实默认值）", 9.5, FAINT, True)
gates = [
    ("20", "次 / 天", "群聊唤醒上限", BLUE),
    ("10", "次 / 天", "私聊唤醒上限", PINK),
    ("≥2", "分钟", "两次唤醒最小间隔", GREEN),
    ("8", "条 / 次", "一次醒来最多发几条", AMBER),
]
gw = 2.9
for i, (num, unit, label, color) in enumerate(gates):
    x = 0.7 + i * (gw + 0.13)
    rect(s, x, 5.04, gw, 1.0, fill=PANEL)
    bar(s, x, 5.04, 0.06, 1.0, color)
    tx(s, x + 0.22, 5.14, 1.0, 0.44, num, 21, color, True)
    tx(s, x + 1.05, 5.24, 1.6, 0.24, unit, 8, FAINT)
    tx(s, x + 0.22, 5.66, 2.5, 0.3, label, 9, DIM)

# ── 底 ────────────────────────────────────────────────────
rect(s, 0.7, 6.22, 11.91, 0.5, fill=PANEL)
bar(s, 0.7, 6.22, 0.08, 0.5, AMBER)
tx(s, 0.98, 6.34, 11.4, 0.3, "省下的不只是钱：额度也是「主动」的节流阀 —— 消息会留着，人不会消失。", 11, INK, True)

footnote(s, "控制台里还能看逐轮 / 逐群 / 峰谷消费；额度是第 6 页那四道目的闸门里的最后一道。", y=6.95)

notes(s, "Part 9 是 token 管理。先是全局总额：按钱或按 token，二选一，下面分 QQ、B站、其他和总额四本账；"
         "当天用到 80% 提醒，到 100% 就停手，新消息留到明天。"
         "然后是防爆破的四道闸门：群聊每天最多醒 20 次、私聊 10 次、两次唤醒至少隔 2 分钟、"
         "一次醒来最多发 8 条——所以不会被一条消息刷出几百次请求。")

prs.save(OUT)
print(f"saved {OUT}")
