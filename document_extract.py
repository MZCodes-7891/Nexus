"""Local text extraction for Nexus. Uses pypdf for PDFs and only the standard library for Office files."""
import csv
import json
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def docx_text(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    lines = []
    for block in root.iter(W + "p"):
        text = "".join((node.text or "") if node.tag == W + "t" else ("\t" if node.tag == W + "tab" else "") for node in block.iter())
        if text.strip():
            lines.append(text)
    return "\n".join(lines), {}


def pptx_text(path):
    with zipfile.ZipFile(path) as archive:
        names = sorted(
            (n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)),
        )
        parts = []
        for index, name in enumerate(names, start=1):
            root = ET.fromstring(archive.read(name))
            paragraphs = ["".join(t.text or "" for t in p.iter(A + "t")) for p in root.iter(A + "p")]
            parts.append(f"[SLIDE {index}]\n" + "\n".join(p for p in paragraphs if p.strip()))
    return "\n\n".join(parts), {"pages": len(names)}


def xlsx_text(path):
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall(S + "si"):
                shared.append("".join(t.text or "" for t in item.iter(S + "t")))
        names = []
        if "xl/workbook.xml" in archive.namelist():
            names = [s.get("name") for s in ET.fromstring(archive.read("xl/workbook.xml")).iter(S + "sheet")]
        sheets = sorted(
            (n for n in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
            key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)),
        )
        parts = []
        for index, sheet in enumerate(sheets):
            rows = []
            for row in ET.fromstring(archive.read(sheet)).iter(S + "row"):
                cells = []
                for cell in row.findall(S + "c"):
                    value = cell.find(S + "v")
                    kind = cell.get("t")
                    if kind == "s" and value is not None:
                        cells.append(shared[int(value.text)])
                    elif kind == "inlineStr":
                        cells.append("".join(t.text or "" for t in cell.iter(S + "t")))
                    else:
                        cells.append(value.text if value is not None and value.text else "")
                if any(cells):
                    rows.append(" | ".join(cells))
            title = names[index] if index < len(names) else f"Sheet {index + 1}"
            parts.append(f"[SHEET {title}]\n" + "\n".join(rows))
    return "\n\n".join(parts), {"pages": len(sheets)}


def pdf_text(path):
    from pypdf import PdfReader

    reader = PdfReader(path, strict=False)
    if reader.is_encrypted and not reader.decrypt(""):
        raise ValueError("This PDF is password-protected. Remove its password and try again.")
    parts, blank = [], []
    for number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").replace("\x00", "").strip()
        if text:
            parts.append(f"[PDF PAGE {number}]\n{text}")
        else:
            blank.append(number)
    return "\n\n".join(parts), {"pages": len(reader.pages), "blankPages": blank[:200]}


def plain_text(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return raw.decode(encoding), {}
        except UnicodeError:
            continue
    return raw.decode("utf-8", "replace"), {}


def csv_text(path):
    text, _ = plain_text(path)
    return "\n".join(" | ".join(row) for row in csv.reader(text.splitlines())), {}


def html_text(path):
    text, _ = plain_text(path)
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    return re.sub(r"[ \t]+", " ", re.sub(r"<[^>]+>", " ", text)).strip(), {}


READERS = {".pdf": pdf_text, ".docx": docx_text, ".pptx": pptx_text, ".xlsx": xlsx_text, ".csv": csv_text, ".html": html_text, ".htm": html_text}


def main():
    path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 2000000
    extension = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    try:
        if extension in (".doc", ".ppt", ".xls"):
            raise ValueError(f"The older {extension} format needs converting. Save it as {extension}x in Office, then add it again.")
        text, meta = READERS.get(extension, plain_text)(path)
        if not text.strip():
            raise ValueError("No readable text was found. It may be a scanned or image-only file.")
        print(json.dumps({"text": text[:limit], "truncated": len(text) > limit, **meta}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"error": str(error)[:500]}, ensure_ascii=True))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
