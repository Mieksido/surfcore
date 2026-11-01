#!/usr/bin/env python3
"""动画测试页（第三版）：同一页并列三种「放大 → 停 2 秒 → 缩回」的写法。"""
from pathlib import Path

from anim_util import add_trigger, finalize
from deck_style import AMBER, BLUE, DIM, GREEN, INK, PANEL, PINK, bar, header, new_deck, new_slide, notes, rect, tx
from anim_util import group_as_block

OUT = Path(__file__).with_name("anim-test.pptx")

prs = new_deck()
s = new_slide(prs)
header(s, "动画测试 v3", "三种写法，点一下告诉我哪块对")
tx(s, 0.7, 1.48, 11.9, 0.35, "期望行为：点区块 → 放大到 112% → 停 2 秒 → 缩回；三块互不影响", 12, DIM)

SW, SH = prs.slide_width, prs.slide_height
cases = [
    ("A", "autoReverse", "内建反向（不保证有 2 秒停留）", BLUE),
    ("B", "afterEffect", "同一触发里排两段：放大 + 延迟 2s 缩回", AMBER),
    ("C", "双 interactiveSeq", "两个独立序列，第二个带 2s delay", GREEN),
]
for i, (tag, name, desc, color) in enumerate(cases):
    x = 0.7 + i * 4.05
    parts = [
        rect(s, x, 2.2, 3.8, 2.5, fill=PANEL),
        bar(s, x, 2.2, 0.07, 2.5, color),
        tx(s, x + 0.3, 2.42, 3.2, 0.4, f"区块 {tag}", 20, INK, True),
        tx(s, x + 0.3, 2.92, 3.2, 0.3, name, 11, color, True),
        tx(s, x + 0.3, 3.28, 3.2, 1.0, desc, 9.5, DIM, line=1.4),
    ]
    grp = group_as_block(s, parts, SW, SH)
    add_trigger(s, grp.shape_id, {
        "from": 100, "to": 112, "grow_ms": 350, "hold_ms": 2000, "shrink_ms": 300, "variant": tag,
    })

finalize(prs)
notes(s, "三块写法不同。请逐一点击，记录哪一块是：放大 → 明显停住约 2 秒 → 缩回，且点 A 不会带动 B/C。")

prs.save(OUT)
print(f"saved {OUT}")
