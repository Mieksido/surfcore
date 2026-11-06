#!/usr/bin/env python3
"""生成 SurfCore 介绍视频用的 PPT（16:9 深色，含口播备注）。

文本里一律用「」做引号，避免和 Python 字符串引号打架。
运行：<python> build_video_deck.py → surfcore-intro.pptx
"""
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

ROOT = Path("D:/deepseekwork/surfcore")
SHOTS = ROOT / "plugins/surfcore/docs"
OUT = Path(__file__).with_name("surfcore-intro.pptx")

BG = RGBColor(0x0B, 0x0F, 0x14)
PANEL = RGBColor(0x14, 0x1A, 0x22)
PANEL2 = RGBColor(0x24, 0x2D, 0x38)
INK = RGBColor(0xF2, 0xF5, 0xF7)
DIM = RGBColor(0x9A, 0xA6, 0xB2)
FAINT = RGBColor(0x5B, 0x67, 0x74)
BLUE = RGBColor(0x5A, 0xA9, 0xFF)
PINK = RGBColor(0xFF, 0x7A, 0xA2)
GREEN = RGBColor(0x4E, 0xD1, 0x8A)

FONT = "Microsoft YaHei"
W, H = 13.333, 7.5
M = 0.75

prs = Presentation()
prs.slide_width = Inches(W)
prs.slide_height = Inches(H)
BLANK = prs.slide_layouts[6]


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


def tx(slide, x, y, w, h, text, size=20, color=INK, bold=False,
       align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, line=1.25, space_after=0):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, line_text in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line
        p.space_after = Pt(space_after)
        run = p.add_run()
        set_run(run, size, color, bold)
        run.text = line_text
    return box


def rect(slide, x, y, w, h, fill=PANEL, line=None, radius=None):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        shape.adjustments[0] = radius
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def new_slide():
    slide = prs.slides.add_slide(BLANK)
    rect(slide, 0, 0, W, H, BG)
    return slide


def prepare_art():
    """把角色图的白底去掉、裁掉透明边，缓存到 video/assets/。"""
    import shutil
    from PIL import Image, ImageDraw
    src = ROOT / "assets/deepseek娘.png"
    if not src.exists():
        return None
    dst_dir = Path(__file__).with_name("assets")
    dst_dir.mkdir(exist_ok=True)
    dst = dst_dir / "deepseek-niang.png"
    im = Image.open(src).convert("RGB")
    ImageDraw.floodfill(im, (0, 0), (255, 0, 255), thresh=40)
    ImageDraw.floodfill(im, (im.width - 1, 0), (255, 0, 255), thresh=40)
    ImageDraw.floodfill(im, (0, im.height - 1), (255, 0, 255), thresh=40)
    rgba = im.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            if px[x, y][:3] == (255, 0, 255):
                px[x, y] = (255, 255, 255, 0)
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    rgba.save(dst)
    return dst


def pic_fill(slide, path, x, y, w, h):
    """按 cover 填满框（裁掉溢出）+ 一圈描边。"""
    from PIL import Image
    img_w, img_h = Image.open(path).size
    box_ratio, img_ratio = w / h, img_w / img_h
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
    if img_ratio > box_ratio:
        crop = (1 - box_ratio / img_ratio) / 2
        pic.crop_left = pic.crop_right = crop
    else:
        crop = (1 - img_ratio / box_ratio) / 2
        pic.crop_top = pic.crop_bottom = crop
    frame = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    frame.fill.background()
    frame.line.color.rgb = PANEL2
    frame.line.width = Pt(1)
    frame.shadow.inherit = False
    return pic


def kicker(slide, text, color=BLUE, y=0.55):
    tx(slide, M, y, 10, 0.3, text, 12, color, True)


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def badge(slide, x, y, d, text, color=BLUE):
    rect(slide, x, y, d, d, fill=color, radius=0.5)
    tx(slide, x, y, d, d, text, 15, BG, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)


# ── 1 封面 ────────────────────────────────────────────────
s = new_slide()
kicker(s, "开源 · MIT · Windows", y=0.55)
tx(s, M, 1.12, 7.6, 0.4, "SurfCore", 20, PINK, True)
tx(s, M, 1.52, 7.9, 1.5, "一个有「自主意识」的\nDeepSeek 插件", 47, INK, True, line=1.12)
feature_list = [
    ("B站 QQ 串通玩", BLUE),
    ("鱼群守则：不刷屏", GREEN),
    ("可塑性记忆", PINK),
    ("即时语音 · 多皮肤桌宠", BLUE),
]
y = 3.45
for text, color in feature_list:
    rect(s, M, y + 0.1, 0.09, 0.26, fill=color)
    tx(s, M + 0.28, y, 6.6, 0.42, text, 21, INK)
    y += 0.5
tx(s, M, 5.9, 7.4, 0.4, "Q 群友 · B站 用户 · 桌面分身：同一份记忆，同一个人格", 14, DIM)
tx(s, M, 6.85, 8.2, 0.35, "github.com/Mieksido/surfcore", 13, FAINT)
art = prepare_art()
if art:
    from PIL import Image as _I
    iw, ih = _I.open(art).size
    ph = 6.55
    pw = ph * iw / ih
    s.shapes.add_picture(str(art), Inches(W - M - pw - 0.05), Inches(H - ph - 0.25),
                         Inches(pw), Inches(ph))
notes(s, "开场：它不是一个接了大模型的 QQ 机器人。它有记忆、有作息、会自己找你。"
         "这一屏先别念功能，让观众看到小肥鱼。")

# ── 2-4 冷开场 ────────────────────────────────────────────
cold = [
    ("她不是每条都回", "这是设计，不是 bug —— 她会判断这段该不该接、什么时候收尾", "冷开场 1 / 3", "ui-qq.png"),
    ("她记得，也会忘", "记忆会衰减：重要的越记越牢，不重要的自己淡掉，80% 时提醒你整理", "冷开场 2 / 3", "ui-memory.png"),
    ("她有自己的想法", "没人叫她的时候，她会从最近的记忆里找个由头，主动冒一句话", "冷开场 3 / 3", "ui-purpose.png"),
]
for big, sub, tag, shot in cold:
    s = new_slide()
    tx(s, M, 0.62, 6, 0.3, tag, 12, FAINT, True)
    tx(s, M, 2.2, 11.8, 1.4, big, 60, INK, True)
    rect(s, M, 3.9, 1.2, 0.06, fill=PINK)
    tx(s, M, 4.25, 7.3, 1.4, sub, 20, DIM, line=1.5)
    p = SHOTS / shot
    if p.exists():
        pic_fill(s, p, 8.75, 5.05, 3.95, 2.05)
    notes(s, big + "。" + sub)

# ── 5 定位：四个数字 ──────────────────────────────────────
s = new_slide()
kicker(s, "它到底有多大")
tx(s, M, 0.98, 11.6, 0.9, "一个插件，装下了四套系统", 40, INK, True)
stats = [
    ("39", "个 QQ 工具", "发、看、等、收尾、表情包、语音、记忆、黑话"),
    ("14", "个设置页", "角色 / 目的 / QQ / 语音 / 桌宠 / B站 / 额度 / 记忆…"),
    ("10", "个控制台页面", "运行总览、会话审批、令牌与花费、访问安全、运维"),
    ("12", "篇逐行文档", "8,737 行，3,150 处 文件:行号 引用"),
]
for i, (num, label, desc) in enumerate(stats):
    x = M + (i % 2) * 6.15
    yy = 2.3 + (i // 2) * 2.4
    rect(s, x, yy, 5.75, 2.05, fill=PANEL)
    tx(s, x + 0.35, yy + 0.24, 1.7, 0.9, num, 46, BLUE, True)
    tx(s, x + 2.0, yy + 0.34, 3.5, 0.45, label, 19, INK, True)
    tx(s, x + 2.0, yy + 0.96, 3.5, 0.9, desc, 13, DIM, line=1.4)
notes(s, "它不是「一个功能」，是四套东西拼在一起：工具面、设置面、控制台、文档。"
         "这四个数字后面每一个都对应真实存在的页面。")

# ── 6 功能墙 ─────────────────────────────────────────────
s = new_slide()
kicker(s, "不是渲染图，是真实界面")
tx(s, M, 0.98, 11.6, 0.8, "功能多，但不乱", 38, INK, True)
grid = ["ui-characters.png", "ui-purpose.png", "ui-qq-fishguard.png", "ui-bili.png",
        "ui-tokens-full.png", "ui-watch.png", "ui-pet-chat.png", "ui-diag.png"]
gw = (W - 2 * M - 3 * 0.22) / 4
gh = gw / 1.44
for i, name in enumerate(grid):
    p = SHOTS / name
    if not p.exists():
        continue
    x = M + (i % 4) * (gw + 0.22)
    y = 2.05 + (i // 4) * (gh + 0.22)
    pic_fill(s, p, x, y, gw, gh)
tx(s, M, 7.0, 11.6, 0.3, "角色 · 目的 · 鱼群 · B站 · 额度 · 观看历史 · 桌宠 · 对齐 · 诊断", 12, FAINT)
notes(s, "九张图分别是九个真实页面，全部可以从仓库直接打开。别逐张念，让画面过，"
         "口播只说一句：「这些不是设计稿，是你能点到的界面。」")

# ── 7 39 个工具 ──────────────────────────────────────────
s = new_slide()
kicker(s, "39 个 QQ 工具")
tx(s, M, 0.98, 11.6, 0.8, "会说、会看、懂表情包、能发语音、有记忆", 33, INK, True)
groups = [
    ("说话", "6", "发一条/多条、引用、拍一拍"),
    ("看", "6", "未读、最近、图片、合并转发"),
    ("节奏", "4", "等静默、标记已读、收尾、唤醒"),
    ("表情包", "6", "收藏、偷图、发表情、写语义"),
    ("语音", "2", "现场合成 / 语音库"),
    ("记忆", "4", "记、查、删、清"),
    ("黑话", "2", "查梗、提交生词"),
    ("群与账号", "5", "状态、群、成员、历史、活跃"),
    ("元信息", "4", "提示词、会话状态、形象、反馈"),
]
cw, ch = 3.75, 1.3
for i, (name, count, desc) in enumerate(groups):
    x = M + (i % 3) * (cw + 0.22)
    y = 2.0 + (i // 3) * (ch + 0.16)
    rect(s, x, y, cw, ch, fill=PANEL)
    tx(s, x + 0.28, y + 0.2, 1.0, 0.55, count, 30, BLUE, True)
    tx(s, x + 1.15, y + 0.26, 2.4, 0.4, name, 18, INK, True)
    tx(s, x + 1.15, y + 0.78, 2.45, 0.45, desc, 11.5, DIM, line=1.3)
tx(s, M, 6.6, 11.6, 0.3, "默认只开一部分：仿真会话只给它聊天需要的，管理员模式才全开 —— 多不等于必须配。", 12.5, FAINT)
notes(s, "39 个别念。念八个动词：说、看、等、收尾、偷图、发语音、记、查黑话。"
         "最后补一句「默认只开一部分」，挡掉臃肿的评论。")


# ── 8-10 三个细节 ────────────────────────────────────────
def detail(shot, tag, title, bullets, note):
    s = new_slide()
    kicker(s, tag)
    tx(s, M, 0.98, 5.6, 1.3, title, 32, INK, True, line=1.22)
    y = 2.7
    for b in bullets:
        rect(s, M, y + 0.1, 0.08, 0.22, fill=GREEN)
        tx(s, M + 0.26, y, 5.25, 0.8, b, 14.5, DIM, line=1.45)
        y += 0.85
    p = SHOTS / shot
    if p.exists():
        pic_fill(s, p, 6.5, 1.35, 6.05, 4.2)
        labels = {"ui-bili-fishguard.png": "B站 · 鱼群保护",
                  "ui-memory.png": "记忆卡 · 衰减与告警",
                  "ui-tokens-full.png": "Token 额度 · 四本账"}
        tx(s, 6.5, 5.7, 6.05, 0.3, labels.get(shot, shot[3:-4]), 11, FAINT)
    notes(s, note)
    return s


detail("ui-bili-fishguard.png", "细节 1 / 3 · 鱼群守则", "鱼群守则：\n不刷屏",
       ["同一群短时间涌进太多「鱼」，她会先看再决定接不接",
        "被 @ / 叫名字 / 拍一拍可以绕过保护，紧急事不会漏",
        "触发原因写进控制台，事后能复盘「这次为什么没说话」"],
       "这是最难讲、也最值钱的一个细节：她不是不回，是在判断这群现在是不是在刷屏。")

detail("ui-memory.png", "细节 2 / 3 · 可塑性记忆", "记忆会衰减，\n也会自己长大",
       ["一张卡进提示词，另一张全量卡只存档、永不遗忘",
        "每 10 分钟摄取一次，重要的越记越牢，不重要的自己淡掉",
        "80% / 90% / 100% 三档告警，提醒你整理而不是爆炸"],
       "可塑性 = 会变。不是数据库，是会被使用、被淡忘的记忆。")

detail("ui-tokens-full.png", "细节 3 / 3 · 额度四本账", "花钱这件事，\n她自己也管",
       ["QQ / B站 / 其他 / 总额，四本账分开算",
        "token 与人民币双单位，换模型不用重新记",
        "到 80% 提醒，到 100% 当天停手，消息留到下一轮"],
       "很多挂机项目翻车在账单上。这一页是给认真用的人看的。")

# ── 11 三个身份 ──────────────────────────────────────────
s = new_slide()
kicker(s, "一个她，三个身份")
tx(s, M, 0.98, 11.6, 0.8, "同一份人格与记忆，在三个地方活着", 34, INK, True)
cols = [
    ("QQ 群友", "39 个工具 · 4 种模式", ["会潜水、会收尾、会引用", "表情包 / 语音 / 拍一拍", "上线自动补看错过的消息"], BLUE),
    ("B站 用户", "34 个命令 · 生物钟", ["自己挑视频、打分、写评论", "有作息窗口和每日额度", "评论 / 动态 / 私信四类动态"], PINK),
    ("桌面分身", "Electron · 多皮肤", ["桌宠气泡带「回复」按钮", "语音对话，路由跟随设置", "专注模式：不主动打扰"], GREEN),
]
for i, (title, sub, items, color) in enumerate(cols):
    x = M + i * 4.03
    rect(s, x, 2.1, 3.78, 4.2, fill=PANEL)
    rect(s, x, 2.1, 3.78, 0.08, fill=color)
    tx(s, x + 0.3, 2.42, 3.2, 0.5, title, 23, INK, True)
    tx(s, x + 0.3, 2.95, 3.2, 0.35, sub, 12.5, color)
    yy = 3.5
    for it in items:
        tx(s, x + 0.3, yy, 3.2, 0.75, "· " + it, 13.5, DIM, line=1.4)
        yy += 0.82
notes(s, "三个身份共用一个人格、一张记忆卡。切换平台不会换个人。")

# ── 12 工程证据 ─────────────────────────────────────────
s = new_slide()
kicker(s, "为什么它不是玩具")
tx(s, M, 0.98, 11.6, 0.8, "该有的工程件，一件没少", 34, INK, True)
proof = [
    ("75", "个回归脚本", "离线跑，不联网不发消息；提交前必须全绿"),
    ("3", "条更新通道", "本体走 git 快进；桌宠走版本清单；语音包拉模型"),
    ("12", "篇文档", "每篇带 文件:行号，改代码前先看它"),
    ("0", "个真实账号", "仓库里没有 QQ 号 / 群号 / 记忆，只有空壳示例"),
]
for i, (num, label, desc) in enumerate(proof):
    x = M + (i % 2) * 6.15
    y = 2.05 + (i // 2) * 2.4
    rect(s, x, y, 5.75, 2.0, fill=PANEL)
    tx(s, x + 0.32, y + 0.25, 1.5, 0.8, num, 42, GREEN, True)
    tx(s, x + 1.8, y + 0.34, 3.5, 0.4, label, 18, INK, True)
    tx(s, x + 1.8, y + 0.95, 3.5, 0.85, desc, 12.5, DIM, line=1.4)
notes(s, "证明它是认真做的：75 个测试、三条更新通道、12 篇文档、仓库零真实数据。")

# ── 13 安装 ─────────────────────────────────────────────
s = new_slide()
kicker(s, "五分钟装好")
tx(s, M, 0.98, 11.6, 0.8, "前置只有两件：Windows + DSH", 34, INK, True)
steps = [
    ("01", "git clone", "把仓库拉下来"),
    ("02", "npm install", "postinstall 自动修 SDK 的 ESM 问题"),
    ("03", "复制 config", "只填 4 处：SnowLuma、ownerQQ、白名单、令牌"),
    ("04", "setup-dsh.mjs", "装 preset + 3 个 MCP + 插件"),
    ("05", "重启 DSH", "概览点「启动 QQ」，扫码登录"),
]
for i, (num, cmd, desc) in enumerate(steps):
    y = 1.95 + i * 1.0
    badge(s, M, y, 0.62, num, BLUE if i < 4 else PINK)
    tx(s, M + 0.85, y + 0.05, 2.7, 0.4, cmd, 18, INK, True)
    tx(s, M + 3.6, y + 0.08, 8.1, 0.4, desc, 14, DIM)
tx(s, M, 6.85, 11.6, 0.3, "SnowLuma 是第三方运行时，按 EULA 不随仓库分发 —— 去官方 Releases 自己下。", 12, FAINT)
notes(s, "安装只有五步。强调 SnowLuma 要自己装，避免评论区问为什么没有 QQ 部分。")

# ── 14 结尾 ─────────────────────────────────────────────
s = new_slide()
tx(s, M, 2.0, 11.8, 1.0, "开源，MIT，现在就能跑", 46, INK, True)
tx(s, M, 3.2, 11.8, 0.9, "github.com/Mieksido/surfcore", 28, BLUE, True)
tx(s, M, 4.25, 11.4, 1.4,
   "配套：surfvoicelocal（本地语音）· surfvoicecloud（云端语音）· surfpet（桌宠）\n"
   "Release 里有安装包，仓库里有 12 篇文档 —— 想看哪一层，从 README 进。", 15, DIM, line=1.6)
rect(s, M, 6.5, 1.2, 0.06, fill=PINK)
tx(s, M, 6.7, 10, 0.4, "如果它让你觉得「这玩意儿有点东西」，点个 star。", 14, FAINT)
notes(s, "结尾只做一件事：让人去点 star。别再堆功能。")

for idx, slide in enumerate(prs.slides, start=1):
    if idx == 1:
        continue
    tx(slide, W - M - 0.6, H - 0.5, 0.6, 0.3, f"{idx:02d}", 10, FAINT, align=PP_ALIGN.RIGHT)

prs.save(OUT)
print(f"已生成 {OUT}，共 {len(prs.slides._sldIdLst)} 页")
