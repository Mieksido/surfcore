#!/usr/bin/env python3
"""给每页的每个「叶子面板」成组 + 挂点击放大（B 写法：放大 112% → 停 2 秒 → 缩回）。

用法：
    python apply_animations.py <输入.pptx> <输出.pptx>
"""
import sys
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from anim_util import add_trigger, finalize, group_as_block

GROW_MS, HOLD_MS, SHRINK_MS = 350, 2000, 300
TO_PCT = 112
MIN_AREA = 0.6          # 平方英寸，过滤掉小装饰块
MAX_AREA_RATIO = 0.55   # 超过整页 55% 的当背景，不动


def bbox(shape):
    try:
        return (shape.left, shape.top, shape.left + shape.width, shape.top + shape.height)
    except Exception:
        return None


def center_in(inner, outer, pad=0):
    cx = (inner[0] + inner[2]) / 2
    cy = (inner[1] + inner[3]) / 2
    return outer[0] - pad <= cx <= outer[2] + pad and outer[1] - pad <= cy <= outer[3] + pad


def is_panel(shape):
    if shape.shape_type != MSO_SHAPE_TYPE.AUTO_SHAPE:
        return False
    try:
        if shape.auto_shape_type is None or "ROUNDED_RECTANGLE" not in str(shape.auto_shape_type):
            return False
    except Exception:
        return False
    return shape.width > 0 and shape.height > 0


def main(src, dst):
    prs = Presentation(src)
    sw, sh = prs.slide_width, prs.slide_height
    slide_area = sw * sh
    total_blocks = 0

    for slide in prs.slides:
        shapes = list(slide.shapes)
        panels = []
        for sp in shapes:
            if not is_panel(sp):
                continue
            area = sp.width * sp.height
            if area < MIN_AREA * 914400 * 914400:
                continue
            if area > slide_area * MAX_AREA_RATIO:
                continue
            panels.append(sp)
        boxes = {id(sp): bbox(sp) for sp in panels}

        for panel in panels:
            pb = boxes[id(panel)]
            if pb is None:
                continue
            # 只处理「叶子」面板：里面不能再套另一个面板
            if any(other is not panel and bboxes_nested(boxes[id(other)], pb) for other in panels):
                continue
            children = []
            for sp in shapes:
                if sp is panel:
                    continue
                if id(sp) in boxes:
                    continue  # 其它面板（包括嵌套的）不并进来
                bb = bbox(sp)
                if bb is None:
                    continue
                if center_in(bb, pb, pad=-40000):
                    children.append(sp)
            if not children:
                continue

            order = {id(sp): i for i, sp in enumerate(shapes)}
            children.sort(key=lambda sp: order[id(sp)])
            parts = [panel] + children
            # 关键：组要放到「组内最高的那一层」的位置，否则会把文字压到底板下面
            parent_tree = panel._element.getparent()
            idx = max(list(parent_tree).index(sp._element) for sp in parts)
            grp = group_as_block(slide, parts, sw, sh)
            parent = grp._element.getparent()
            parent.remove(grp._element)
            parent.insert(idx, grp._element)
            add_trigger(slide, grp.shape_id, {
                "from": 100, "to": TO_PCT, "grow_ms": GROW_MS,
                "hold_ms": HOLD_MS, "shrink_ms": SHRINK_MS, "variant": "B",
            })
            total_blocks += 1

    finalize(prs)
    prs.save(dst)
    print(f"完成：{dst}｜共 {len(prs.slides)} 页、{total_blocks} 个可点区块")


def bboxes_nested(inner, outer, pad=20000):
    """inner 是否整体落在 outer 内（用于判断外层面板）。"""
    return (inner[0] >= outer[0] - pad and inner[1] >= outer[1] - pad
            and inner[2] <= outer[2] + pad and inner[3] <= outer[3] + pad)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
