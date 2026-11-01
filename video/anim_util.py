"""点击放大 → 停 N 毫秒 → 缩回：三种 OOXML 写法，供实测挑一种。

用法：
    add_trigger(slide, spid, {"from":100,"to":112,"grow_ms":350,"hold_ms":2000,"shrink_ms":300,"variant":"B"})
    finalize(prs)   # 保存前统一写 p:timing
"""
from lxml import etree
from pptx.oxml.ns import qn

NSDECL = ('xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"')


def _scale(tid, spid, frm, to, dur):
    return (f'<p:animScale><p:cBhvr><p:cTn id="{tid}" dur="{dur}" fill="hold"/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr>'
            f'<p:from x="{frm}" y="{frm}"/><p:to x="{to}" y="{to}"/></p:animScale>')


def _cond_click(spid, delay=0):
    return (f'<p:stCondLst><p:cond evt="onClick" delay="{delay}">'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cond></p:stCondLst>')


def _seq_wrap(seq_id, inner):
    return (f'<p:seq {NSDECL} concurrent="1" nextAc="seek">'
            f'<p:cTn id="{seq_id}" dur="indefinite" nodeType="interactiveSeq">'
            f'<p:childTnLst>{inner}</p:childTnLst></p:cTn>'
            f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            f'<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
            f'</p:seq>')


def _seq_xml(ids, item):
    spec = item["spec"]
    spid = item["trigger"]
    frm, to = int(spec["from"] * 1000), int(spec["to"] * 1000)
    grow, hold, shrink = spec["grow_ms"], spec["hold_ms"], spec["shrink_ms"]
    variant = str(spec.get("variant", "B"))

    if variant == "A":
        eff = (f'<p:par><p:cTn id="{ids.next()}" presetID="6" presetClass="emph" presetSubtype="0" '
               f'fill="hold" nodeType="clickEffect" grpId="0" autoReverse="1">'
               f'<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
               f'{_scale(ids.next(), spid, frm, to, grow)}</p:childTnLst></p:cTn></p:par>')
        inner = (f'<p:par><p:cTn id="{ids.next()}" fill="hold">{_cond_click(spid)}'
                 f'<p:childTnLst>{eff}</p:childTnLst></p:cTn></p:par>')
        return _seq_wrap(ids.next(), inner)

    grow_par = (f'<p:par><p:cTn id="{ids.next()}" presetID="6" presetClass="emph" presetSubtype="0" '
                f'fill="hold" nodeType="clickEffect" grpId="0">'
                f'<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
                f'{_scale(ids.next(), spid, frm, to, grow)}</p:childTnLst></p:cTn></p:par>')
    back_par = (f'<p:par><p:cTn id="{ids.next()}" presetID="6" presetClass="emph" presetSubtype="0" '
                f'fill="hold" nodeType="afterEffect" grpId="0">'
                f'<p:stCondLst><p:cond delay="{grow + hold}"/></p:stCondLst><p:childTnLst>'
                f'{_scale(ids.next(), spid, to, frm, shrink)}</p:childTnLst></p:cTn></p:par>')

    if variant == "B":
        inner = (f'<p:par><p:cTn id="{ids.next()}" fill="hold">{_cond_click(spid)}'
                 f'<p:childTnLst>{grow_par}{back_par}</p:childTnLst></p:cTn></p:par>')
        return _seq_wrap(ids.next(), inner)

    # variant C：两个独立 seq
    inner_grow = (f'<p:par><p:cTn id="{ids.next()}" fill="hold">{_cond_click(spid)}'
                  f'<p:childTnLst>{grow_par}</p:childTnLst></p:cTn></p:par>')
    inner_back = (f'<p:par><p:cTn id="{ids.next()}" fill="hold">{_cond_click(spid, grow + hold)}'
                  f'<p:childTnLst>{back_par}</p:childTnLst></p:cTn></p:par>')
    return _seq_wrap(ids.next(), inner_grow) + _seq_wrap(ids.next(), inner_back)


class IdGen:
    def __init__(self, start=1):
        self.n = start

    def next(self):
        self.n += 1
        return self.n


def add_trigger(slide, trigger_spid, spec):
    slide.__dict__.setdefault("_anim_items", []).append({"trigger": str(trigger_spid), "spec": spec})


def finalize(prs):
    for slide in prs.slides:
        items = slide.__dict__.get("_anim_items")
        if not items:
            continue
        sld = slide._element
        old = sld.find(qn("p:timing"))
        if old is not None:
            sld.remove(old)
        ids = IdGen(1)
        seqs = "".join(_seq_xml(ids, item) for item in items)
        xml = (f'<p:timing {NSDECL}><p:tnLst>'
               f'<p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
               f'<p:childTnLst>{seqs}</p:childTnLst></p:cTn></p:par>'
               f'</p:tnLst></p:timing>')
        sld.append(etree.fromstring(xml))


def group_as_block(slide, shapes, slide_w_emu, slide_h_emu):
    """把若干形状装进一个「整页大小、子坐标=绝对坐标」的组，返回组形状。"""
    grp = slide.shapes.add_group_shape()
    element = grp._element
    grpSpPr = element.find(qn("p:grpSpPr"))
    xfrm = grpSpPr.find(qn("a:xfrm"))
    if xfrm is None:
        xfrm = etree.SubElement(grpSpPr, qn("a:xfrm"))
    for tag in ("a:off", "a:ext", "a:chOff", "a:chExt"):
        el = xfrm.find(qn(tag))
        if el is not None:
            xfrm.remove(el)
    off = etree.SubElement(xfrm, qn("a:off")); off.set("x", "0"); off.set("y", "0")
    ext = etree.SubElement(xfrm, qn("a:ext")); ext.set("cx", str(slide_w_emu)); ext.set("cy", str(slide_h_emu))
    choff = etree.SubElement(xfrm, qn("a:chOff")); choff.set("x", "0"); choff.set("y", "0")
    chext = etree.SubElement(xfrm, qn("a:chExt")); chext.set("cx", str(slide_w_emu)); chext.set("cy", str(slide_h_emu))

    tree = grp.shapes._spTree
    for shape in shapes:
        tree.append(shape._element)
    return grp
