"""Creates .pptx and .docx files from JSON using only the standard library. Input path: {type, title, path, slides|sections}."""
import json
import os
import sys
import zipfile
from xml.sax.saxutils import escape

CT = "http://schemas.openxmlformats.org/package/2006/content-types"
RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
WIDTH, HEIGHT = 12192000, 6858000


def shape(index, kind, x, y, cx, cy, paragraphs, size, bold=False, color="E8F4FF"):
    body = ""
    for text in paragraphs:
        bullet = '<a:pPr marL="285750" indent="-285750"><a:buChar char="&#8226;"/></a:pPr>' if kind == "body" else "<a:pPr><a:buNone/></a:pPr>"
        body += f'<a:p>{bullet}<a:r><a:rPr lang="en-US" sz="{size}" b="{1 if bold else 0}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></a:rPr><a:t>{escape(str(text))}</a:t></a:r></a:p>'
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{index}" name="{kind} {index}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
        f'<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>{body}</p:txBody></p:sp>'
    )


def slide_xml(slide, first):
    title = slide.get("title", "")
    bullets = slide.get("bullets", []) or []
    if first:
        shapes = shape(2, "title", 700000, 2300000, WIDTH - 1400000, 1400000, [title], 4400, True) + shape(3, "subtitle", 700000, 3800000, WIDTH - 1400000, 900000, bullets[:2], 2000, False, "9FD8FF")
    else:
        shapes = shape(2, "title", 600000, 380000, WIDTH - 1200000, 1000000, [title], 3200, True, "7DD3FC") + shape(3, "body", 600000, 1500000, WIDTH - 1200000, 4700000, bullets, 2000)
    source = slide.get("source")
    if source:
        shapes += shape(4, "source", 600000, 6300000, WIDTH - 1200000, 400000, [f"Source: {source}"], 1000, False, "8AA4C0")
    return (
        HEAD + f'<p:sld xmlns:a="{A}" xmlns:r="{RT}" xmlns:p="{P}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="071426"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
        f'<p:spTree>{EMPTY_TREE}{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    )


def write_pptx(data, path):
    slides = data.get("slides") or []
    if not slides:
        raise ValueError("A presentation needs at least one slide.")
    count = len(slides)
    overrides = "".join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(1, count + 1))
    slide_ids = "".join(f'<p:sldId id="{255 + i}" r:id="rId{i + 2}"/>' for i in range(1, count + 1))
    slide_rels = "".join(f'<Relationship Id="rId{i + 2}" Type="{RT}/slide" Target="slides/slide{i}.xml"/>' for i in range(1, count + 1))
    theme_colors = "".join(f'<a:{name}><a:srgbClr val="{value}"/></a:{name}>' for name, value in [("dk1", "000000"), ("lt1", "FFFFFF"), ("dk2", "071426"), ("lt2", "E8F4FF"), ("accent1", "38BDF8"), ("accent2", "0EA5E9"), ("accent3", "22D3EE"), ("accent4", "60A5FA"), ("accent5", "3B82F6"), ("accent6", "1D4ED8"), ("hlink", "38BDF8"), ("folHlink", "7DD3FC")])
    font = '<a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/>'
    fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    line = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
    effect = "<a:effectStyle><a:effectLst/></a:effectStyle>"
    theme = (
        HEAD + f'<a:theme xmlns:a="{A}" name="Nexus"><a:themeElements><a:clrScheme name="Nexus">{theme_colors}</a:clrScheme><a:fontScheme name="Nexus"><a:majorFont>{font}</a:majorFont><a:minorFont>{font}</a:minorFont></a:fontScheme>'
        f'<a:fmtScheme name="Nexus"><a:fillStyleLst>{fill * 3}</a:fillStyleLst><a:lnStyleLst>{line * 3}</a:lnStyleLst><a:effectStyleLst>{effect * 3}</a:effectStyleLst><a:bgFillStyleLst>{fill * 3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
    )
    parts = {
        "[Content_Types].xml": HEAD + f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>{overrides}</Types>',
        "_rels/.rels": HEAD + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{RT}/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        "ppt/presentation.xml": HEAD + f'<p:presentation xmlns:a="{A}" xmlns:r="{RT}" xmlns:p="{P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{slide_ids}</p:sldIdLst><p:sldSz cx="{WIDTH}" cy="{HEIGHT}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
        "ppt/_rels/presentation.xml.rels": HEAD + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{RT}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="{RT}/theme" Target="theme/theme1.xml"/>{slide_rels}</Relationships>',
        "ppt/slideMasters/slideMaster1.xml": HEAD + f'<p:sldMaster xmlns:a="{A}" xmlns:r="{RT}" xmlns:p="{P}"><p:cSld><p:spTree>{EMPTY_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": HEAD + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="{RT}/theme" Target="../theme/theme1.xml"/></Relationships>',
        "ppt/slideLayouts/slideLayout1.xml": HEAD + f'<p:sldLayout xmlns:a="{A}" xmlns:r="{RT}" xmlns:p="{P}" type="blank"><p:cSld name="Blank"><p:spTree>{EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": HEAD + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{RT}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
        "ppt/theme/theme1.xml": theme,
    }
    for index, slide in enumerate(slides, start=1):
        parts[f"ppt/slides/slide{index}.xml"] = slide_xml(slide, index == 1)
        parts[f"ppt/slides/_rels/slide{index}.xml.rels"] = HEAD + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
    save(path, parts)
    return count


def write_docx(data, path):
    def para(text, style=None):
        props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        return f'<w:p>{props}<w:r><w:t xml:space="preserve">{escape(str(text))}</w:t></w:r></w:p>'

    body = para(data.get("title", ""), "Title") if data.get("title") else ""
    for section in data.get("sections") or []:
        if section.get("heading"):
            body += para(section["heading"], "Heading1")
        for line in str(section.get("text", "")).split("\n"):
            body += para(line) if line.strip() else ""
    styles = (
        HEAD + f'<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style></w:styles>'
    )
    save(path, {
        "[Content_Types].xml": HEAD + f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
        "_rels/.rels": HEAD + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{RT}/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": HEAD + f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>',
        "word/_rels/document.xml.rels": HEAD + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" Type="{RT}/styles" Target="styles.xml"/></Relationships>',
        "word/styles.xml": styles,
    })
    return len(data.get("sections") or [])


def save(path, parts):
    if os.path.exists(path):
        raise ValueError(f"{path} already exists, so nothing was overwritten.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)


def main():
    try:
        with open(sys.argv[1], encoding="utf-8") as handle:
            data = json.load(handle)
        count = write_pptx(data, data["path"]) if data["type"] == "pptx" else write_docx(data, data["path"])
        print(json.dumps({"ok": True, "path": data["path"], "count": count}))
    except Exception as error:
        print(json.dumps({"error": str(error)[:500]}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
