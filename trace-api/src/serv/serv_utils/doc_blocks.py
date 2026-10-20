#!/usr/bin/env python
# encoding: utf-8

# 模型/数据 Word 章节：正文、图、表交错（对齐自研软件研究报告）。
# 详见 99 R33、100 R28。

import base64
import os
import re

_FIG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "src-res", "doc_figures",
)
_CACHE = {}


def _strip_num(title):
    t = str(title or "").strip()
    t = re.sub(r"^\d+(?:\.\d+)*[、.\s]*", "", t)
    t = re.sub(r"^[（(]\d+[）)]\s*", "", t)
    return t.strip()


def _data_url(rel):
    if rel in _CACHE:
        return _CACHE[rel]
    path = os.path.join(_FIG_DIR, rel)
    data = ""
    if os.path.isfile(path):
        with open(path, "rb") as f:
            raw = f.read()
        data = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    _CACHE[rel] = data
    return data


def _files_for(doc_type, title, parents):
    if doc_type == "md_002_01" and title == "标注规则及示例":
        return ["md_002_01/fig1.png", "md_002_01/fig2.png", "md_002_01/fig3.png", "md_002_01/fig4.png"]
    if doc_type == "md_002_02" and title == "标记示例":
        return ["md_002_02/fig1.png", "md_002_02/fig2.png", "md_002_02/fig3.png", "md_002_02/fig4.png"]
    if doc_type == "md_004":
        if title == "算法主要流程":
            return ["md_004/fig1.png"]
        if "三维重建" in title:
            return ["md_004/fig2.png"]
        return None
    if doc_type == "pd_003" and title == "算法要求":
        joined = "".join(parents)
        if "肺血管" in joined:
            return ["pd_003/fig2.png"]
        if "气管" in joined:
            return ["pd_003/fig1.png"]
        if "肺叶" in joined:
            return ["pd_003/fig3.png"]
        return None
    return None


def fill_chapter_images(content, doc_type):
    if not isinstance(content, dict) or doc_type not in ("md_002_01", "md_002_02", "md_004", "pd_003"):
        return

    def walk(nodes, parents):
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            title = _strip_num(n.get("title"))
            files = _files_for(doc_type, title, parents)
            if files:
                existing = n.get("images") if isinstance(n.get("images"), list) else []
                if not any(str(x or "").strip() for x in existing):
                    urls = [u for u in (_data_url(f) for f in files) if u]
                    if urls:
                        n["images"] = urls
            walk(n.get("children") or [], parents + [title])

    walk(content.get("sections") or [], [])


_SILENT_LINES = ("{{TXT}}", "{{EMPTY}}", "{{TBL}}", "{{IMG}}")


def has_free_body_markers(body) -> bool:
    text = str(body or "")
    return any(tok in text for tok in _SILENT_LINES)


def clean_export_text(text) -> str:
    lines = [ln for ln in str(text or "").split("\n") if ln.strip() not in _SILENT_LINES]
    return "\n".join(lines).strip()


def write_body_image(document, url, caption="", add_text=None):
    raw = str(url or "").strip()
    if raw:
        try:
            from . import docx_util
            docx_util.save_img2docx(raw, document, mw=620, mh=480, page_fit=True)
        except Exception:
            pass
    cap = str(caption or "").strip()
    if cap and add_text:
        add_text(cap)


def emit_free_body(body, tables, images, add_text, add_table, add_image):
    """按编辑页顺序写出正文/图/表。{{TXT}}/{{EMPTY}}/{{TBL}}/{{IMG}} 不写入 Word。"""
    for block in split_body_blocks(body, tables, images):
        kind = block.get("type")
        if kind == "text":
            text = clean_export_text(block.get("text") or "")
            if text:
                add_text(text)
        elif kind == "image":
            add_image(block.get("url") or "", block.get("caption") or "")
        elif kind == "table":
            cap = str(block.get("caption") or "").strip()
            if cap:
                add_text(cap)
            table = block.get("table")
            if table is not None:
                add_table(table)


def split_body_blocks(body, tables=None, images=None):
    text = str(body or "")
    tables_arr = tables if isinstance(tables, list) else []
    images_arr = [u for u in (images or []) if str(u or "").strip()] if isinstance(images, list) else []
    if not text.strip() and not tables_arr and not images_arr:
        return []
    lines = text.split("\n")
    segs = []
    table_idx = 0
    img_idx = 0
    buf = []

    def flush():
        t = clean_export_text("\n".join(buf))
        if t:
            segs.append({"type": "text", "text": t})
        buf.clear()

    for ln in lines:
        s = ln.strip()
        if s in ("{{TXT}}", "{{EMPTY}}"):
            flush()
            continue
        if s == "{{IMG}}" and img_idx < len(images_arr):
            flush()
            segs.append({"type": "image", "url": images_arr[img_idx]})
            img_idx += 1
            continue
        if s == "{{IMG}}":
            continue
        if s == "{{TBL}}" and table_idx < len(tables_arr):
            flush()
            segs.append({"type": "table", "tableIndex": table_idx, "table": tables_arr[table_idx]})
            table_idx += 1
            continue
        if s == "{{TBL}}":
            continue
        if re.search(r"见下表|如下表|下表", s) and table_idx < len(tables_arr):
            buf.append(ln)
            flush()
            segs.append({"type": "table", "tableIndex": table_idx, "table": tables_arr[table_idx]})
            table_idx += 1
            continue
        if re.search(r"见表\s*\d", s) and table_idx < len(tables_arr):
            buf.append(re.sub(r"见表\s*\d+", "见下表", ln))
            flush()
            segs.append({"type": "table", "tableIndex": table_idx, "table": tables_arr[table_idx]})
            table_idx += 1
            continue
        if re.match(r"^表\s*\d", s) and table_idx < len(tables_arr):
            flush()
            segs.append({"type": "table", "tableIndex": table_idx, "table": tables_arr[table_idx], "caption": s})
            table_idx += 1
            continue
        if re.search(r"见下图|如下图|下图", s) and img_idx < len(images_arr):
            buf.append(ln)
            flush()
            segs.append({"type": "image", "url": images_arr[img_idx]})
            img_idx += 1
            continue
        if re.match(r"^图\s*\d", s) and img_idx < len(images_arr):
            flush()
            segs.append({"type": "image", "url": images_arr[img_idx], "caption": s})
            img_idx += 1
            continue
        buf.append(ln)
    flush()
    while table_idx < len(tables_arr):
        segs.append({"type": "table", "tableIndex": table_idx, "table": tables_arr[table_idx]})
        table_idx += 1
    while img_idx < len(images_arr):
        segs.append({"type": "image", "url": images_arr[img_idx]})
        img_idx += 1
    return segs
