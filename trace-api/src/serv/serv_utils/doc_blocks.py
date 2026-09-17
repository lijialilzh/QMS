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
        t = "\n".join(buf).strip()
        if t:
            segs.append({"type": "text", "text": t})
        buf.clear()

    for ln in lines:
        s = ln.strip()
        if s == "{{IMG}}" and img_idx < len(images_arr):
            flush()
            segs.append({"type": "image", "url": images_arr[img_idx]})
            img_idx += 1
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
