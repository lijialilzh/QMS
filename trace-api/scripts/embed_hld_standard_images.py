#!/usr/bin/env python
# encoding: utf-8
"""将 standard_nodes.json 中 img_url 本地路径转为 data URL，便于跨服务器部署。"""

import base64
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STANDARD_PATH = ROOT.parent / "trace-web/trace/src/pages/hld_doc/data/standard_nodes.json"

_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
}


def _resolve_local_path(url: str) -> str | None:
    raw = str(url or "").strip()
    if not raw or raw.startswith("data:"):
        return None
    clean = raw.split("?", 1)[0].strip().lstrip("/")
    candidates = [clean]
    if clean.startswith("data.trace/"):
        candidates.append(clean)
    else:
        candidates.append(os.path.join("data.trace", clean))
    for candidate in candidates:
        path = ROOT / candidate if not os.path.isabs(candidate) else Path(candidate)
        if path.is_file():
            return str(path)
    return None


def _to_data_url(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    mime = _MIME_BY_EXT.get(ext, "image/png")
    bys = Path(path).read_bytes()
    return f"data:{mime};base64,{base64.b64encode(bys).decode('ascii')}"


def coerce(url: str | None) -> str:
    if not url:
        return ""
    s = str(url).strip()
    if s.startswith("data:image/"):
        return s
    local = _resolve_local_path(s)
    if not local:
        return s
    return _to_data_url(local)


def walk(nodes):
    for node in nodes or []:
        if node.get("img_url"):
            node["img_url"] = coerce(node.get("img_url"))
        walk(node.get("children") or [])


def main():
    data = json.loads(STANDARD_PATH.read_text(encoding="utf-8"))
    walk(data)
    STANDARD_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=4), encoding="utf-8")
    print(f"updated {STANDARD_PATH}")


if __name__ == "__main__":
    main()
