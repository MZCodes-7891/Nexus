import json
import sys

from pypdf import PdfReader


def main():
    file_path = sys.argv[1]
    character_limit = max(1, int(sys.argv[2]))
    try:
        reader = PdfReader(file_path, strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("This PDF is password-protected. Remove its password and try again.")

        parts = []
        remaining = character_limit
        truncated = False
        text_pages = 0
        processed_pages = 0
        not_processed_pages = []
        blank_pages = []
        replacement_pages = []
        for page_number, page in enumerate(reader.pages, start=1):
            processed_pages = page_number
            try:
                page_text = page.extract_text(extraction_mode="layout") or ""
            except (TypeError, ValueError):
                page_text = page.extract_text() or ""
            if not page_text.strip():
                page_text = page.extract_text() or ""
            page_text = page_text.replace("\x00", "").strip()
            if not page_text:
                blank_pages.append(page_number)
                continue
            text_pages += 1
            if "\ufffd" in page_text:
                replacement_pages.append(page_number)
            page_block = f"[PDF PAGE {page_number}]\n{page_text}"
            if len(page_block) > remaining:
                parts.append(page_block[:remaining])
                truncated = True
                not_processed_pages = list(range(page_number + 1, len(reader.pages) + 1))
                break
            parts.append(page_block)
            remaining -= len(page_block)
            if remaining <= 0:
                truncated = True
                not_processed_pages = list(range(page_number + 1, len(reader.pages) + 1))
                break

        text = "\n\n".join(parts).strip()
        if not text:
            raise ValueError("No selectable text was found. This may be a scanned or image-only PDF; use an OCR version or export it with selectable text.")

        print(json.dumps({
            "text": text,
            "pages": len(reader.pages),
            "textPages": text_pages,
            "processedPages": processed_pages,
            "notProcessedPages": not_processed_pages[:100],
            "blankPages": blank_pages[:100],
            "replacementPages": replacement_pages[:100],
            "truncated": truncated,
        }))
    except Exception as error:
        print(json.dumps({"error": str(error)[:500]}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
