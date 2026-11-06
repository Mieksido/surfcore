#!/usr/bin/env python3
"""第一页框架图：三个入口 → 一个人格（人设+记忆）→ 目的 → 主动行为。

输出：01-framework.pptx（单页，16:9）+ 同名 PNG 预览。
"""
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

OUT = Path(__file__).with_name("01-framework.pptx")

BG = RGBColor(0x0B, 0x0F, 0x14)
PANEL = RGBColor(0x14, 0x1A, 0x22)
PANEL2 = RGBColor(0x1B, 0x23, 0x2D)
EDGE = RGBColor(0x2A, 0x35, 0x42)
INK = RGBColor(0xF2, 0xF5, 0xF7)
DIM = RGBColor(0x9A, 0xA6, 0xB2)
FAINT = RGBColor(0x64, 0x70, 0x7D)
BLUE = RGBColor(0x5A, 0xA9, 0xFF)
PINK = RGBColor(0xFF, 0x7A, 0xA2)
GREEN = RGBColor(0x4E, 0xD1, 0x8A)
AMBER = RGBColor(0xF2, 0xB8, 0x4B)

FONT = "Microsoft YaHei"
W, H, M = 13.333, 7.5, 0.7

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W), Inches(H)
slide = prs.slides.add_slide(prs.slide_layouts[6])


def set_run(run, size, color=INK, bold=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = FONT
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rPr, qn(tag))
        el.set("typeface", FONT)


def tx(x, y, w, h, text, size=14, color=INK, bold=False,
       align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, line=1.3):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, part in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line
        run = p.add_run()
        set_run(run, size, color, bold)
        run.text = part
    return box


def rect(x, y, w, h, fill=PANEL, line=EDGE, radius=0.08):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.adjustments[0] = radius
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    shape.shadow.inherit = False
    return shape


def bar(x, y, w, h, color):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def arrow(x, y, w, h, color=FAINT, down=False):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.DOWN_ARROW if down else MSO_SHAPE.RIGHT_ARROW,
        Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


# 背景
bgshape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(W), Inches(H))
bgshape.fill.solid()
bgshape.fill.fore_color.rgb = BG
bgshape.line.fill.background()

# 标题
tx(M, 0.42, 6, 0.28, "架构 · 一张图", 11.5, BLUE, True)
tx(M, 0.75, 11.9, 0.55, "一个人格，三个入口，一条自发的动机链", 30, INK, True)

# ── ① 三个入口 ────────────────────────────────────────────
tx(M, 1.72, 3.2, 0.3, "① 入口（也是信息源）", 11, FAINT, True)
entries = [
    ("QQ", "群 · 私聊 · 39 个工具", BLUE),
    ("B站", "视频 · 评论 · 动态 · 私信", PINK),
    ("桌宠", "对话 · 气泡 · 语音", GREEN),
]
entry_y = 2.1
for name, sub, color in entries:
    rect(M, entry_y, 2.95, 1.18, fill=PANEL)
    bar(M, entry_y, 0.1, 1.18, color)
    tx(M + 0.28, entry_y + 0.18, 2.5, 0.35, name, 20, INK, True)
    tx(M + 0.28, entry_y + 0.62, 2.5, 0.35, sub, 10.5, DIM)
    entry_y += 1.36

# ── ② 人格（人设 + 记忆） ─────────────────────────────────
CORE_X, CORE_W = 4.35, 3.5
rect(CORE_X, 1.95, CORE_W, 4.55, fill=PANEL, line=EDGE, radius=0.06)
tx(CORE_X, 2.12, CORE_W, 0.3, "② 一个人格（唯一真相）", 11, FAINT, True, PP_ALIGN.CENTER)
tx(CORE_X, 2.42, CORE_W, 0.45, "人格", 24, INK, True, PP_ALIGN.CENTER)

# 人设
rect(CORE_X + 0.28, 3.0, CORE_W - 0.56, 1.18, fill=PANEL2)
tx(CORE_X + 0.48, 3.12, 2.6, 0.35, "人设 · 角色卡", 14.5, INK, True)
tx(CORE_X + 0.48, 3.5, 2.7, 0.55, "身份 / 语气 / 雷点 / 称呼表", 10.5, DIM)

# 记忆（共享）
rect(CORE_X + 0.28, 4.32, CORE_W - 0.56, 1.55, fill=PANEL2, line=AMBER)
tx(CORE_X + 0.48, 4.44, 2.7, 0.35, "记忆系统（共享）", 14.5, AMBER, True)
tx(CORE_X + 0.48, 4.82, 2.75, 0.9, "衰减卡进提示词\n全量卡只存档 · 三端读写同一张", 10.5, DIM, line=1.35)

tx(CORE_X, 6.05, CORE_W, 0.3, "QQ 写的，B站/桌宠 读得到 —— 反之亦然", 9.5, FAINT, False, PP_ALIGN.CENTER)

# 入口 → 人格
for i in range(3):
    arrow(M + 3.02, 2.62 + i * 1.36, 0.26, 0.16, DIM)

# ── ③ 目的 ───────────────────────────────────────────────
GOAL_X, GOAL_W = 8.25, 2.45
rect(GOAL_X, 2.55, GOAL_W, 2.5, fill=PANEL, line=EDGE, radius=0.06)
tx(GOAL_X, 2.7, GOAL_W, 0.3, "③ 自发催生", 11, FAINT, True, PP_ALIGN.CENTER)
tx(GOAL_X, 2.98, GOAL_W, 0.5, "目的", 24, INK, True, PP_ALIGN.CENTER)
tx(GOAL_X + 0.18, 3.52, GOAL_W - 0.36, 0.3, "人格 + 记忆 + 信息", 11.5, AMBER, True, PP_ALIGN.CENTER)
tx(GOAL_X + 0.18, 3.98, GOAL_W - 0.36, 1.0,
   "最近记住的事\n＋ 当下的消息\n→ 我想弄明白 / 想做点什么", 10, DIM, line=1.4, align=PP_ALIGN.CENTER)

# 人格 → 目的
arrow(CORE_X + CORE_W + 0.12, 3.72, 0.3, 0.18, AMBER)

# ── ④ 主动行为 ────────────────────────────────────────────
ACT_X = 10.95
rect(ACT_X, 2.55, W - M - ACT_X, 3.4, fill=PANEL, line=EDGE, radius=0.06)
tx(ACT_X, 2.7, 1.9, 0.3, "④ 结果", 11, FAINT, True, PP_ALIGN.CENTER)
tx(ACT_X, 2.98, 1.9, 0.5, "主动行为", 20, INK, True, PP_ALIGN.CENTER)
acts = [("群里开口", BLUE), ("桌宠冒话", GREEN), ("发动态 / 评论", PINK)]
ay = 3.62
for name, color in acts:
    rect(ACT_X + 0.18, ay, W - M - ACT_X - 0.36, 0.62, fill=PANEL2)
    bar(ACT_X + 0.18, ay, 0.07, 0.62, color)
    tx(ACT_X + 0.42, ay + 0.16, 1.6, 0.35, name, 11.5, INK, True)
    ay += 0.76

# 目的 → 主动行为
arrow(GOAL_X + GOAL_W + 0.1, 3.72, 0.3, 0.18, AMBER)

# 底注
bar(M, 6.62, 1.1, 0.05, PINK)
tx(M, 6.75, 11.8, 0.4, "三端不是三份人设：一个角色、一张记忆卡，只是三个说话的地方。", 12, DIM)

# 备注（口播）
slide.notes_slide.notes_text_frame.text = (
    "这一页讲清楚它跟普通机器人的区别：QQ、B站、桌宠不是三个 bot，是同一个人的三个入口；"
    "人设和记忆只有一份，三端共享。人格 + 记忆 + 新信息会自己长出目的，目的再变成主动行为——"
    "所以她会自己找你，而不是等你叫。")

prs.save(OUT)
print(f"saved {OUT}")
