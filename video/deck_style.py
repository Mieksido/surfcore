"""SurfCore 视频 PPT 的公共样式（所有页共用一套网格/颜色）。"""
from lxml import etree
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

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
MONO = "Consolas"
W, H, M = 13.333, 7.5, 0.7


def new_deck():
    from pptx import Presentation
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(W), Inches(H)
    return prs


def new_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(W), Inches(H))
    bg.fill.solid()
    bg.fill.fore_color.rgb = BG
    bg.line.fill.background()
    bg.shadow.inherit = False
    return slide


def set_run(run, size, color=INK, bold=False, font=FONT):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rPr, qn(tag))
        el.set("typeface", font)


def tx(slide, x, y, w, h, text, size=14, color=INK, bold=False, font=FONT,
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
        set_run(run, size, color, bold, font)
        run.text = part
    return box


def rect(slide, x, y, w, h, fill=PANEL, line=EDGE, radius=0.08, dash=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.adjustments[0] = radius
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
        if dash:
            shape.line.dash_style = dash
    shape.shadow.inherit = False
    return shape


def bar(slide, x, y, w, h, color):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def arrow(slide, x, y, w, h, color=FAINT, down=False):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.DOWN_ARROW if down else MSO_SHAPE.RIGHT_ARROW,
        Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def dashed_arrow(slide, x1, y1, x2, y2, color=FAINT, width=1.2):
    conn = slide.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    conn.line.color.rgb = color
    conn.line.width = Pt(width)
    conn.line.dash_style = 4
    ln = conn.line._get_or_add_ln()
    tail = etree.SubElement(ln, qn("a:tailEnd"))
    tail.set("type", "triangle")
    tail.set("w", "med")
    tail.set("h", "med")
    return conn


def header(slide, kicker_text, title, kicker_color=BLUE):
    tx(slide, M, 0.42, 8, 0.28, kicker_text, 11.5, kicker_color, True)
    tx(slide, M, 0.74, 11.9, 0.6, title, 30, INK, True)


def footnote(slide, text, y=6.92, color=DIM, size=12):
    bar(slide, M, y - 0.16, 1.0, 0.05, PINK)
    tx(slide, M, y, 11.9, 0.4, text, size, color)


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def page_number(slide, num):
    tx(slide, W - M - 0.6, H - 0.5, 0.6, 0.3, f"{num:02d}", 10, FAINT, align=PP_ALIGN.RIGHT)
