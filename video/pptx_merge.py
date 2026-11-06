#!/usr/bin/env python3
"""把「单页 pptx」追加进主文件 surfcore-video.pptx。

铁律：**只追加，不重排、不重生成**——已有页面的内容（包括用户手工改过的）一个字节都不动，
只给新加进来的页补页码。

用法：
    python pptx_merge.py append 04-memory.pptx
"""
import sys
from copy import deepcopy
from io import BytesIO
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

HERE = Path(__file__).parent
MASTER = HERE / "surfcore-video.pptx"
W, H = 13.333, 7.5


def _notes_text(slide):
    try:
        if not slide.has_notes_slide:
            return ""
        tf = slide.notes_slide.notes_text_frame
        return tf.text if tf is not None else ""
    except Exception:
        return ""


def _copy_notes(dest_slide, src_slide):
    """直接搬备注页里的形状：新建的空白页 notes_text_frame 可能是 None，写不进去。"""
    try:
        if not src_slide.has_notes_slide:
            return
        src_ns = src_slide.notes_slide
        dst_ns = dest_slide.notes_slide
        for sp in src_ns.shapes:
            if sp.has_text_frame and sp.text_frame.text.strip():
                dst_ns.shapes._spTree.append(deepcopy(sp._element))
                return
    except Exception:
        pass


def copy_slide(master, src_slide):
    dest = master.slides.add_slide(master.slide_layouts[6])
    tree = dest.shapes._spTree
    for el in src_slide.shapes._spTree.iterchildren():
        if el.tag in (qn("p:nvGrpSpPr"), qn("p:grpSpPr")):
            continue
        tree.append(deepcopy(el))

    # 图片：复制二进制到目标包，重新挂关系
    for blip in tree.iter(qn("a:blip")):
        rid = blip.get(qn("r:embed"))
        if not rid:
            continue
        try:
            src_part = src_slide.part.related_part(rid)
        except KeyError:
            continue
        _, new_rid = dest.part.get_or_add_image_part(BytesIO(src_part.blob))
        blip.set(qn("r:embed"), new_rid)

    _copy_notes(dest, src_slide)
    return dest


def add_page_number(slide, idx):
    box = slide.shapes.add_textbox(Inches(W - 1.3), Inches(H - 0.5), Inches(0.6), Inches(0.3))
    tf = box.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = 3
    run = p.add_run()
    run.text = f"{idx:02d}"
    run.font.size = Pt(10)
    run.font.name = "Microsoft YaHei"
    run.font.color.rgb = RGBColor(0x64, 0x70, 0x7D)


def append(path):
    master = Presentation(MASTER)
    before = len(master.slides)
    src = Presentation(HERE / path)
    added = [copy_slide(master, slide) for slide in src.slides]
    for offset, slide in enumerate(added):
        add_page_number(slide, before + offset + 1)
    master.save(MASTER)
    print(f"已追加 {len(added)} 页 → 共 {len(master.slides)} 页（原有 {before} 页未改动）")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "append":
        append(sys.argv[2])
    else:
        print(__doc__)
