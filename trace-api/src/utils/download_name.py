#!/usr/bin/env python
# encoding: utf-8
"""导出文件名统一规则：`文件编号 + 空格 + 文件名称 + 扩展名`。

- 文件编号为空时只写文件名称。
- 文件名称缺失时回退到调用方给的默认名称。
- 统一替换文件名非法字符，避免 Content-Disposition 出错。
"""

import re
import urllib.parse


_INVALID = r'[\/\\:*?"<>|\r\n\t]'


def safe_part(text) -> str:
    """去掉首尾空白并把文件名非法字符替换成下划线。"""
    value = str(text or "").strip()
    return re.sub(_INVALID, "_", value)


def build(file_no, name, ext="docx", fallback="") -> str:
    """按「文件编号 + 空格 + 文件名称」拼文件名（含扩展名）。

    file_no 为空时只用文件名称；文件名称也空时用 fallback。
    """
    no = safe_part(file_no)
    title = safe_part(name) or safe_part(fallback)
    if no and title:
        raw = f"{no} {title}"
    elif no:
        raw = no
    else:
        raw = title or "文件"
    suffix = str(ext or "").strip().lstrip(".")
    return f"{raw}.{suffix}" if suffix else raw


def quoted(file_no, name, ext="docx", fallback="") -> str:
    """返回已 URL 编码的文件名，直接用于 Content-Disposition。"""
    return urllib.parse.quote(build(file_no, name, ext, fallback))


def for_obj(obj, name, ext="docx", fallback="") -> str:
    """从文档对象取 file_no 拼文件名（已编码）。obj 可为 None。"""
    return quoted(getattr(obj, "file_no", None), name, ext, fallback=fallback or name)
