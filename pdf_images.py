"""Saves the page images of a scanned PDF so Windows can read their text. Arguments: pdf path, output folder, page list ("all" or "1,4,9")."""
import json
import os
import struct
import sys
import zlib

from pypdf import PdfReader


def png_bytes(width, height, channels, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    stride = width * channels
    rows = b"".join(b"\x00" + raw[row * stride:(row + 1) * stride] for row in range(height))
    color = 0 if channels == 1 else 2
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b"")


def largest_image(page):
    best = None
    resources = page.get("/Resources")
    xobjects = resources.get("/XObject") if resources else None
    if not xobjects:
        return None
    for reference in xobjects.get_object().values():
        item = reference.get_object()
        if item.get("/Subtype") != "/Image":
            continue
        area = int(item.get("/Width", 0)) * int(item.get("/Height", 0))
        if best is None or area > best[0]:
            best = (area, item)
    return best[1] if best else None


def save_image(item, base):
    filters = item.get("/Filter")
    names = [str(name) for name in filters] if isinstance(filters, list) else [str(filters)]
    width, height = int(item.get("/Width", 0)), int(item.get("/Height", 0))
    if "/DCTDecode" in names:
        path = base + ".jpg"
        with open(path, "wb") as handle:
            handle.write(item.get_data())
        return path
    if "/JPXDecode" in names or "/CCITTFaxDecode" in names or "/JBIG2Decode" in names:
        return None
    space = str(item.get("/ColorSpace"))
    bits = int(item.get("/BitsPerComponent", 8))
    raw = item.get_data()
    if bits == 8 and "/DeviceRGB" in space:
        channels = 3
    elif bits == 8 and "/DeviceGray" in space:
        channels = 1
    elif bits == 1:
        stride = (width + 7) // 8
        raw = bytes(255 if raw[row * stride + column // 8] >> (7 - column % 8) & 1 else 0 for row in range(height) for column in range(width))
        channels = 1
    else:
        return None
    path = base + ".png"
    with open(path, "wb") as handle:
        handle.write(png_bytes(width, height, channels, raw))
    return path


def main():
    pdf, folder, wanted = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        reader = PdfReader(pdf, strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("This PDF is password-protected. Remove its password and try again.")
        total = len(reader.pages)
        pages = list(range(1, total + 1)) if wanted == "all" else [int(item) for item in wanted.split(",") if item]
        images, unreadable = [], []
        for number in pages[:200]:
            if number < 1 or number > total:
                continue
            item = largest_image(reader.pages[number - 1])
            path = save_image(item, os.path.join(folder, f"page{number}")) if item else None
            if path:
                images.append({"page": number, "file": path})
            else:
                unreadable.append(number)
        print(json.dumps({"pages": total, "images": images, "unreadable": unreadable}))
    except Exception as error:
        print(json.dumps({"error": str(error)[:500]}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
