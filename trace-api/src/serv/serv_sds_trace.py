import logging
import re
import sys
import json
import hashlib
from typing import Dict, List, Optional, Tuple, Union
from sqlalchemy import select, or_, and_, case, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..obj.tobj_role import Roles
from ..obj.node import Node
from ..obj.tobj_sds_doc import SdsNodeForm
from ..model.srs_type import SrsType
from ..model.sds_doc import SdsDoc, SdsNode
from ..model.product import Product, UserProd
from ..model.srs_doc import SrsDoc, SrsNode
from ..model.srs_req import SrsReq
from ..model.sds_trace import SdsTrace
from ..obj.tobj_sds_trace import SdsTraceForm
from ..obj.vobj_sds_trace import SdsTraceObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from .serv_utils.tree_util import find_parent, fix_chapter
from ..obj import Page, Resp
from . import msg_err_db
from .serv_product import product_scope_filter

logger = logging.getLogger(__name__)

default_types ={
    "1": "标准需求",
    "2": "其他需求"
}

NAME_DICT = {
    "图像接收": "DataProcessing",
    "图像存储": "DLServer",
    "图像处理": "RePACS",
    "图像显示": "NeoViewer",
    "图像预测": "DLServer",
}

FIXED_RCN300_TRACES = {
    "SRS-RCN300-001": [
        ("SDS-RCN300-005", "RePACS", "5"),
    ],
    "SRS-RCN300-002": [
        ("SDS-RCN300-006", "DLServer", "4"),
        ("SDS-RCN300-005", "RePACS", "5"),
        ("SDS-RCN300-007", "NeoViewer", "6"),
    ],
    "SRS-RCN300-003": [
        ("SDS-RCN300-004", "DataProcessing", "3"),
        ("SDS-RCN300-006", "DLServer", "4"),
        ("SDS-RCN300-005", "RePACS", "5"),
        ("SDS-RCN300-007", "NeoViewer", "6"),
    ],
    "SRS-RCN300-004": [
        ("SDS-RCN300-004", "DataProcessing", "3"),
    ],
    "SRS-RCN300-005": [
        ("SDS-RCN300-005", "RePACS", "5"),
    ],
    "SRS-RCN300-006": [
        ("SDS-RCN300-004", "DataProcessing", "3"),
        ("SDS-RCN300-006", "DLServer", "4"),
        ("SDS-RCN300-005", "RePACS", "5"),
    ],
    "SRS-RCN300-007": [
        ("SDS-RCN300-007", "NeoViewer", "6"),
    ],
    "SRS-RCN300-008": [
        ("SDS-RCN300-008", "文档需求", "8"),
    ],
    "SRS-RCN300-009": [
        ("SDS-RCN300-009", "法规符合性需求", "9"),
    ],
    "SRS-RCN300-010": [
        ("SDS-RCN300-010", "外部连接", "10"),
    ],
}

_REQ_CODE_RE = re.compile(r"^SRS-([A-Z]+?)(\d+)-(\d+)$", re.I)

# SDS 内列表和章节均不读取的模块：基本要求、数据库要求、文档需求。
# 这三类需求不返回 2.4 列表行，也不再解析成章节名、不再自动补一级章节。
SDS_EXCLUDED_MODULES = ("基本要求", "数据库要求", "文档需求")


def is_sds_excluded_module(module: str) -> bool:
    return str(module or "").strip() in SDS_EXCLUDED_MODULES

# 其他需求设计类型。名称和编号都还是预置值时，详细设计仍用原来的英文章节名。
OTHER_REQ_DESIGN_ROLES = {
    "dataprocessing": {"preset_module": "图像接收", "english": "DataProcessing", "tail": "004"},
    "interface": {"preset_module": "图像存储", "english": "RePACS", "tail": "005"},
    "dlserver": {"preset_module": "图像处理", "english": "DLServer", "tail": "006"},
    "function": {"preset_module": "图像显示", "english": "NeoViewer", "tail": "007"},
    "document": {"preset_module": "文档需求", "english": "文档需求", "tail": "008"},
    "regulation": {"preset_module": "法规符合需求", "english": "法规符合性需求", "tail": "009"},
    "external": {"preset_module": "外部连接", "english": "外部连接", "tail": "010"},
}
_OTHER_REQ_ROLE_LABELS = {
    "DataProcessing": "dataprocessing",
    "dataprocessing": "dataprocessing",
    "接口设计": "interface",
    "RePACS": "interface",
    "interface": "interface",
    "DLServer": "dlserver",
    "dlserver": "dlserver",
    "功能设计": "function",
    "NeoViewer": "function",
    "function": "function",
    "外部连接": "external",
    "external": "external",
}
_OTHER_REQ_ROLE_BY_MODULE = {
    spec["preset_module"]: key for key, spec in OTHER_REQ_DESIGN_ROLES.items()
}


def other_req_design_role_is_explicit(value: str) -> bool:
    label = re.sub(r"\s+", "", str(value or ""))
    return label in _OTHER_REQ_ROLE_LABELS


def normalize_other_req_design_role(value: str, module: str = "", code: str = "") -> str:
    """其他需求设计类型。没填开关时，编号末段仍是 004、005、006、007、010 就按末段认原来的模版章。"""
    module_name = str(module or "").strip()
    # 改回这四个预置模块名时，固定用原来的英文模版，不看下拉里选过的类型。
    if module_name in ("图像接收", "图像存储", "图像处理", "图像显示"):
        by_preset = _OTHER_REQ_ROLE_BY_MODULE.get(module_name)
        if by_preset:
            return by_preset
    label = re.sub(r"\s+", "", str(value or ""))
    if label in _OTHER_REQ_ROLE_LABELS:
        return _OTHER_REQ_ROLE_LABELS[label]
    by_module = _OTHER_REQ_ROLE_BY_MODULE.get(str(module or "").strip())
    if by_module:
        return by_module
    module_text = re.sub(r"\s+", "", str(module or ""))
    if any(key in module_text for key in ("数据库要求", "性能要求", "基本要求", "文档需求", "法规符合", "外部连接")):
        return ""
    matched = re.search(r"300-(\d+)$", re.sub(r"\s+", "", str(code or "")).upper())
    if not matched:
        return ""
    tail = f"{int(matched.group(1)):03d}"
    # 文档需求、法规符合不靠编号末段去改详细设计章节。
    if tail in ("008", "009"):
        return ""
    for key, spec in OTHER_REQ_DESIGN_ROLES.items():
        if spec["tail"] == tail:
            return key
    return ""


def other_req_role_is_changed(code: str, module: str, role: str) -> bool:
    """名称或编号离开预置值时，章节改读这一行现在的中文名和编号。"""
    spec = OTHER_REQ_DESIGN_ROLES.get(role or "")
    if not spec:
        return False
    if str(module or "").strip() != spec["preset_module"]:
        return True
    matched = re.search(r"300-(\d+)$", re.sub(r"\s+", "", str(code or "")).upper())
    if not matched:
        return True
    return f"{int(matched.group(1)):03d}" != spec["tail"]


def other_req_role_display_name(module: str, role: str) -> str:
    spec = OTHER_REQ_DESIGN_ROLES.get(role or "") or {}
    if str(module or "").strip() == spec.get("preset_module"):
        return spec.get("english") or str(module or "").strip()
    return str(module or "").strip() or spec.get("english") or ""


def fixed_rcn300_trace_for_code(code: str):
    """300-001～010 按固定对照取设计编号和模块。代号字母变了只改设计编号里的同样字母，模块名和行内顺序不动。"""
    normalized = re.sub(r"\s+", "", str(code or "")).upper()
    exact = FIXED_RCN300_TRACES.get(normalized)
    if exact:
        return list(exact)
    matched = _REQ_CODE_RE.match(normalized)
    if not matched:
        return None
    prefix, series, seq = matched.group(1), matched.group(2), int(matched.group(3))
    if series != "300" or seq < 1 or seq > 10:
        return None
    template = FIXED_RCN300_TRACES.get(f"SRS-RCN300-{seq:03d}")
    if not template:
        return None
    if prefix == "RCN":
        return list(template)
    rewritten = []
    for sds_code, chapter, location in template:
        new_code = re.sub(r"^SDS-RCN", f"SDS-{prefix}", str(sds_code), count=1, flags=re.I)
        rewritten.append((new_code, chapter, location))
    return rewritten


def requirement_number_key(code: str) -> str:
    """SRS/SDS 编号只取数字段，字母不同视为同一条。例如 ACN300-004 与 RCN300-004 都是 300-004。"""
    normalized = re.sub(r"\s+", "", str(code or "")).upper()
    normalized = re.sub(r"^(SDS|SRS)-", "SRS-", normalized, count=1)
    matched = _REQ_CODE_RE.match(normalized)
    if not matched:
        return ""
    return f"{matched.group(2)}-{int(matched.group(3)):03d}"


def split_design_code_lines(value: str) -> list:
    return [re.sub(r"\s+", "", line).upper() for line in re.split(r"[\r\n]+", str(value or "")) if re.sub(r"\s+", "", line)]


def design_code_number_keys(value: str) -> list:
    return [requirement_number_key(line) for line in split_design_code_lines(value) if requirement_number_key(line)]


def _design_code_keys(lines) -> list:
    keys = []
    for line in lines or []:
        key = requirement_number_key(line)
        if key:
            keys.append(key)
    return keys


def _series_shifted_only_by_stem(left: str, right: str) -> bool:
    """300-001 与 400-001：末段序号相同，系列号只差产品代号前面那几位。"""
    left_matched = re.fullmatch(r"(\d+)-(\d+)", left or "")
    right_matched = re.fullmatch(r"(\d+)-(\d+)", right or "")
    if not left_matched or not right_matched or left_matched.group(2) != right_matched.group(2):
        return False
    left_series, right_series = left_matched.group(1), right_matched.group(1)
    shared = 0
    while shared < len(left_series) and shared < len(right_series) and left_series[-1 - shared] == right_series[-1 - shared]:
        shared += 1
    return shared >= 2 and left_series[-shared:].isdigit()


def _number_keys_same_slot(stored_keys, auto_keys) -> bool:
    if stored_keys == auto_keys:
        return True
    if len(stored_keys) != len(auto_keys):
        return False
    for left, right in zip(stored_keys, auto_keys):
        if left == right or _series_shifted_only_by_stem(left, right):
            continue
        return False
    return True


def design_codes_are_manual(stored: str, auto_lines, also_auto=None) -> bool:
    """其他需求的设计编号若和自动结果不是同一组数字，就视为手改。字母不同不算手改。产品代号只换版本号前面一段、末段序号不变时也不算手改。"""
    stored_keys = design_code_number_keys(stored)
    if not stored_keys:
        return False
    for lines in (auto_lines, also_auto):
        if lines is None:
            continue
        if _number_keys_same_slot(stored_keys, _design_code_keys(lines)):
            return False
    return True


_MODULE_PRESET_TAIL = (
    ("文档需求", "008"),
    ("法规符合", "009"),
    ("外部连接", "010"),
)


def stored_is_module_preset_tail(stored: str, module: str) -> bool:
    """库里还是文档需求 008、法规符合 009、外部连接 010 时，这是原来的自动编号，不是手改。"""
    text = re.sub(r"\s+", "", str(module or ""))
    tail = ""
    for key, value in _MODULE_PRESET_TAIL:
        if key in text:
            tail = value
            break
    if not tail:
        return False
    keys = design_code_number_keys(stored)
    if len(keys) != 1:
        return False
    return keys[0].rsplit("-", 1)[-1] == tail


def other_req_keeps_design_code(stored: str, module: str, auto_lines, also_auto=None) -> bool:
    """手改过的设计编号保留。自动编号（含产品代号换段的同一序号）不算手改，跟当前需求编号走。"""
    if stored_is_module_preset_tail(stored, module):
        return False
    return design_codes_are_manual(stored, auto_lines, also_auto)


def _dedupe_design_lines(lines) -> str:
    seen = set()
    kept = []
    for line in lines or []:
        code = re.sub(r"\s+", "", str(line or "")).upper()
        if not code or code in seen:
            continue
        seen.add(code)
        kept.append(code)
    return "\n".join(kept)


def rewrite_own_design_code(stored: str, derived: str, living_req_codes) -> str:
    """多行设计编号里，和本条需求对应、但已经对不上当前编号的那一条换成当前编号。指向其他仍存在需求的编号保留。"""
    derived_norm = re.sub(r"\s+", "", str(derived or "")).upper()
    derived_key = requirement_number_key(derived_norm)
    if not derived_norm or not derived_key:
        return str(stored or "")
    living_keys = {requirement_number_key(code) for code in (living_req_codes or [])}
    living_keys.discard("")
    lines = split_design_code_lines(stored)
    if not lines:
        return derived_norm
    if any(requirement_number_key(line) == derived_key for line in lines):
        return _dedupe_design_lines([
            derived_norm if requirement_number_key(line) == derived_key else line
            for line in lines
        ])
    new_lines = []
    replaced = False
    for line in lines:
        key = requirement_number_key(line)
        if not replaced and key and key not in living_keys:
            new_lines.append(derived_norm)
            replaced = True
            continue
        new_lines.append(line)
    if not replaced:
        # 这一格指向的都是仍在的需求编号（用户手改成别的行），原样保留，不把本条编号插回来
        return _dedupe_design_lines(lines)
    return _dedupe_design_lines(new_lines)


def align_sds_node_code(doc_id: int, stored: str, derived: str, module: str = ""):
    """设计编号只是产品代号变了时，章节上的同一编号一起换。手改成别的序号不动。"""
    stored_text = str(stored or "")
    derived_text = str(derived or "").strip()
    stored_norm = re.sub(r"\s+", "", stored_text).upper()
    derived_norm = re.sub(r"\s+", "", derived_text).upper()
    if not doc_id or not stored_norm or not derived_norm or stored_norm == derived_norm:
        return
    if "\n" in stored_text or "," in stored_text or "，" in stored_text:
        return
    if other_req_keeps_design_code(stored_norm, module, [derived_norm]):
        return
    nodes = db.session.execute(
        select(SdsNode).where(SdsNode.doc_id == doc_id, SdsNode.sds_code.isnot(None))
    ).scalars().all()
    for node in nodes:
        node_code = re.sub(r"\s+", "", str(node.sds_code or "")).upper()
        if node_code == stored_norm:
            node.sds_code = derived_norm


def other_req_fixed_trace_is_cross_map(code: str, trace) -> bool:
    """旧对照把 001 对到 005、002 对到多条别的编号。这种跨编号对照不再用于其他需求。"""
    own = requirement_number_key(code)
    if not trace or not own:
        return False
    keys = [requirement_number_key(item[0]) for item in trace if requirement_number_key(item[0])]
    return keys != [own]


def other_req_stored_follows_cross_map(stored: str, code: str, trace) -> bool:
    """库里留下的旧对照，或删掉其中已不存在的编号之后剩下的那几条，都不是手改。"""
    if not other_req_fixed_trace_is_cross_map(code, trace):
        return False
    stored_keys = design_code_number_keys(stored)
    if not stored_keys:
        return False
    legacy_keys = {requirement_number_key(item[0]) for item in trace if requirement_number_key(item[0])}
    return all(key in legacy_keys for key in stored_keys)


def filter_fixed_trace_to_living(trace, living_codes):
    """其他需求删掉后，同号设计编号不再出现在追溯表。删掉 300-004，各行里的 SDS-*-300-004 都去掉。"""
    if not trace:
        return [] if trace is not None else trace
    living = {requirement_number_key(code) for code in (living_codes or [])}
    living.discard("")
    if not living:
        return list(trace)
    kept = []
    for item in trace:
        key = requirement_number_key(item[0])
        if key and key not in living:
            continue
        kept.append(item)
    return kept


RCN300_TAIL_NAME_KEYS = ("文档需求", "法规符合", "外部连接")
RCN300_TAIL_SDS_SUFFIX = {
    "文档需求": "008",
    "法规符合": "009",
    "外部连接": "010",
}
_STANDALONE_SDS_CODE_RE = re.compile(r"^\s*(?:设计编号\s*[:：]\s*)?SDS-[A-Z]+300-\d+\s*$", re.I)
_TAIL_DESIGN_CODE_RE = re.compile(r"^SDS-([A-Z]+)300-(\d+)$")


def rcn300_tail_name_key(chapter: str) -> str:
    text = str(chapter or "")
    for key in RCN300_TAIL_NAME_KEYS:
        if key in text:
            return key
    return ""


def live_rcn300_tail_chapters(nodes) -> dict:
    """按目录实际章号取 文档需求 / 法规符合 / 外部连接。没有对应章节则不给号。"""
    found = {}

    def skipped(node) -> bool:
        ref = str(getattr(node, "ref_type", "") or "")
        title = str(getattr(node, "title", "") or getattr(node, "label", "") or "").strip()
        compact = re.sub(r"\s+", "", title)
        if ref in ("sds_reqds", "sds_traces", "img_flow"):
            return True
        if compact == "目录" or "软件详细设计" in compact or "文件修订记录" in compact:
            return True
        if re.match(r"^\s*图\s*\d+", title) or re.match(r"^\s*导入表格\d*$", title):
            return True
        return False

    def unnumbered(node) -> bool:
        ref = str(getattr(node, "ref_type", "") or "")
        compact = re.sub(r"\s+", "", str(getattr(node, "title", "") or ""))
        raw = str(getattr(node, "title", "") or "")
        if ref == "review" or compact in ("评审记录", "附件一评审结论") or compact.startswith("附件一"):
            return True
        return bool(re.match(r"^\s*表\d+([、.\s　]|$)", raw))

    def consider(title: str, num: str):
        name = re.sub(
            r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            "",
            str(title or ""),
        ).strip()
        for key in RCN300_TAIL_NAME_KEYS:
            if key not in name:
                continue
            prev = found.get(key)
            if not prev or num.count(".") < prev.count("."):
                found[key] = num

    def walk(items, prefix: str):
        idx = 0
        for node in items or []:
            if skipped(node):
                continue
            children = getattr(node, "children", None) or []
            if unnumbered(node):
                walk(children, prefix)
                continue
            idx += 1
            num = f"{prefix}.{idx}" if prefix else str(idx)
            consider(getattr(node, "title", "") or "", num)
            walk(children, num)

    walk(nodes or [], "")
    return found


def nav_directory_chapters(nodes) -> dict:
    """与编辑页左侧目录同一套章号。by_code / by_name 取较浅的章，by_code_deep 取较深的章。"""
    by_code = {}
    by_name = {}
    by_code_name = {}
    by_code_deep = {}

    def shallower(prev, num):
        return (not prev) or str(num).count(".") < str(prev).count(".")

    def skipped(node) -> bool:
        ref = str(getattr(node, "ref_type", "") or "")
        title = str(getattr(node, "title", "") or getattr(node, "label", "") or "").strip()
        compact = re.sub(r"\s+", "", title)
        if ref in ("sds_reqds", "sds_traces", "img_flow"):
            return True
        if compact == "目录" or "软件详细设计" in compact or "文件修订记录" in compact:
            return True
        if re.match(r"^\s*图\s*\d+", title) or re.match(r"^\s*导入表格\d*$", title) or re.match(r"^\s*导入图片\d*$", title):
            return True
        return False

    def unnumbered(node) -> bool:
        ref = str(getattr(node, "ref_type", "") or "")
        compact = re.sub(r"\s+", "", str(getattr(node, "title", "") or ""))
        raw = str(getattr(node, "title", "") or "")
        if ref == "review" or compact in ("评审记录", "附件一评审结论") or compact.startswith("附件一"):
            return True
        return bool(re.match(r"^\s*表\d+([、.\s　]|$)", raw))

    def strip_name(title: str) -> str:
        return re.sub(
            r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            "",
            str(title or ""),
        ).strip()

    def walk(items, prefix: str):
        idx = 0
        for node in items or []:
            if skipped(node):
                continue
            children = getattr(node, "children", None) or []
            if unnumbered(node):
                walk(children, prefix)
                continue
            idx += 1
            num = f"{prefix}.{idx}" if prefix else str(idx)
            name = strip_name(getattr(node, "title", "") or "")
            compact = re.sub(r"\s+", "", name)
            if compact and shallower(by_name.get(compact), num):
                by_name[compact] = num
            code = re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "")).upper()
            if code:
                if shallower(by_code.get(code), num):
                    by_code[code] = num
                    by_code_name[code] = name
                prev = by_code_deep.get(code)
                if not prev or str(num).count(".") >= str(prev.get("num") or "").count("."):
                    by_code_deep[code] = {"name": name, "num": num}
            walk(children, num)

    walk(nodes or [], "")
    return {
        "by_code": by_code,
        "by_name": by_name,
        "by_code_name": by_code_name,
        "by_code_deep": by_code_deep,
    }


def live_heading_for_exact_title(nodes, module: str) -> str:
    """目录里还有同名章节时返回它的章号。没有这章就空着，不再套模板里的旧章号。"""
    target = re.sub(r"\s+", "", str(module or ""))
    if not target:
        return ""
    found = {}

    def consider(title: str, num: str):
        name = re.sub(
            r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            "",
            str(title or ""),
        )
        name = re.sub(r"\s+", "", name)
        if name != target:
            return
        prev = found.get("hit")
        if not prev or num.count(".") < prev.count("."):
            found["hit"] = num

    def skipped(node) -> bool:
        ref = str(getattr(node, "ref_type", "") or "")
        title = str(getattr(node, "title", "") or "").strip()
        compact = re.sub(r"\s+", "", title)
        if ref in ("sds_reqds", "sds_traces", "img_flow"):
            return True
        if compact == "目录" or "软件详细设计" in compact or "文件修订记录" in compact:
            return True
        return bool(re.match(r"^\s*图\s*\d+", title) or re.match(r"^\s*导入表格\d*$", title))

    def walk(items, prefix: str):
        idx = 0
        for node in items or []:
            if skipped(node):
                continue
            children = getattr(node, "children", None) or []
            idx += 1
            num = f"{prefix}.{idx}" if prefix else str(idx)
            consider(getattr(node, "title", "") or "", num)
            walk(children, num)

    walk(nodes or [], "")
    return found.get("hit") or ""


def design_letter_for_tail(nodes) -> str:
    """300 系列里，008/009/010 以外的设计编号用哪个字母，法规符合和外部连接就用哪个字母。"""
    counts = {}

    def walk(items):
        for node in items or []:
            code = re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "")).upper()
            matched = _TAIL_DESIGN_CODE_RE.match(code)
            if matched and int(matched.group(2)) not in (8, 9, 10):
                letter = matched.group(1)
                counts[letter] = counts.get(letter, 0) + 1
            walk(getattr(node, "children", None) or [])

    walk(nodes or [])
    if not counts:
        return "RCN"
    return max(counts.items(), key=lambda item: (item[1], item[0] != "RCN"))[0]


def tail_sds_code(name_key: str, letter: str) -> str:
    suffix = RCN300_TAIL_SDS_SUFFIX.get(name_key or "")
    if not suffix:
        return ""
    return f"SDS-{letter or 'RCN'}300-{suffix}"


def displayed_tail_design_code(stored: str, module: str, req_code: str) -> str:
    """章节编号框用追溯表这一行正在显示的设计编号。手改过的保留，原来的 009/008/010 跟着当前需求编号。"""
    derived = re.sub(r"^SRS", "SDS", re.sub(r"\s+", "", str(req_code or "")), count=1, flags=re.I)
    if not other_req_keeps_design_code(stored, module, [derived]):
        return derived
    lines = [
        re.sub(r"\s+", "", line).upper()
        for line in re.split(r"[\r\n,，]+", str(stored or ""))
        if line.strip()
    ]
    derived_key = requirement_number_key(derived)
    for line in lines:
        if requirement_number_key(line) == derived_key:
            return line
    return lines[0] if lines else derived


def living_tail_chapter_codes(doc_id: int) -> dict:
    """文档需求 / 法规符合 / 外部连接这一章，编号框跟当前追溯表。"""
    if not doc_id:
        return {}
    rows = db.session.execute(
        select(SdsTrace, SrsReq)
        .join(SrsReq, SrsReq.id == SdsTrace.req_id)
        .where(SdsTrace.doc_id == doc_id, SrsReq.type_code == "2")
    ).all()
    found = {}
    for trace, req in rows:
        key = rcn300_tail_name_key(getattr(req, "module", "") or "")
        if not key or key in found:
            continue
        code = displayed_tail_design_code(getattr(trace, "sds_code", "") or "", getattr(req, "module", "") or "", getattr(req, "code", "") or "")
        if code:
            found[key] = code
    return found


def align_rcn300_tail_node_codes(nodes, code_by_name=None) -> bool:
    """法规符合 / 外部连接 / 文档需求的设计编号与追溯表一致，字母跟着同套 300 编号，正文不再重复写编号。"""
    changed = False
    letter = design_letter_for_tail(nodes)
    code_by_name = code_by_name or {}

    def strip_code_lines(text: str) -> str:
        lines = str(text or "").replace("\r", "").split("\n")
        kept = [line for line in lines if not _STANDALONE_SDS_CODE_RE.match(line or "")]
        return "\n".join(kept).lstrip("\n")

    def walk(items):
        nonlocal changed
        for node in items or []:
            title = str(getattr(node, "title", "") or "")
            name = re.sub(
                r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
                "",
                title,
            ).strip()
            name_key = rcn300_tail_name_key(name)
            code = code_by_name.get(name_key) or tail_sds_code(name_key, letter)
            if code:
                current = re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "")).upper()
                if current != code:
                    node.sds_code = code
                    changed = True
                text = str(getattr(node, "text", "") or "")
                next_text = strip_code_lines(text)
                if next_text != text:
                    node.text = next_text
                    changed = True
            walk(getattr(node, "children", None) or [])

    walk(nodes or [])
    return changed


def align_rcn300_tail_locations(chapter: str, location: str, nodes, tree_ready: bool = True) -> str:
    names = [line.strip() for line in re.split(r"[\r\n]+", str(chapter or ""))]
    locations = [line.strip() for line in re.split(r"[\r\n]+", str(location or ""))]
    if not tree_ready or not any(rcn300_tail_name_key(name) for name in names):
        return location
    live = live_rcn300_tail_chapters(nodes)
    adjusted = []
    for idx, name in enumerate(names):
        key = rcn300_tail_name_key(name)
        if key:
            adjusted.append(live.get(key, ""))
        else:
            adjusted.append(locations[idx] if idx < len(locations) else "")
    return "\n".join(adjusted)


def fixed_rcn300_sds_codes() -> set:
    codes = set()
    for items in FIXED_RCN300_TRACES.values():
        for token, *_rest in items:
            code = re.sub(r"\s+", "", str(token or "").upper())
            if code:
                codes.add(code)
    return codes

class Server(object):
    @staticmethod
    def __normalize_hierarchy_part(value: str) -> str:
        txt = re.sub(r"\s+", " ", str(value or "").strip())
        return txt

    @staticmethod
    def __normalize_srs_code(value: str) -> str:
        txt = re.sub(r"\s+", "", str(value or "").strip().upper())
        return txt.replace("_", "-")

    @staticmethod
    def __resolve_srs_req_table_columns(headers: list) -> dict:
        col_idx = {}
        for header in headers or []:
            if not isinstance(header, dict):
                continue
            name = str(header.get("name") or "").strip()
            code = header.get("code")
            if not code:
                continue
            norm = name.lower()
            if "需求编号" in name or norm in {"code", "编号"}:
                col_idx["code"] = code
            elif "子功能" in name:
                col_idx["sub_function"] = code
            elif "功能" in name:
                col_idx["function"] = code
            elif "模块" in name:
                col_idx["module"] = code
            elif "章节" in name or "位置" in name or norm == "location":
                col_idx["location"] = code
        return col_idx

    @staticmethod
    def __usable_req_chapter_name(value: str) -> str:
        txt = str(value or "").strip()
        if not txt or txt in {"/", "\\", "-", "--", "—", "N/A", "n/a", "无", "暂无"}:
            return ""
        if re.fullmatch(r"\d+", txt):
            return ""
        return txt

    def __load_srs_req_hierarchy_map(self, srs_doc_id: int) -> Dict[str, dict]:
        """从 SRS 文档「产品需求列表」读取层级，避免 srs_req 表合并单元格继承污染。"""
        result: Dict[str, dict] = {}
        if not srs_doc_id:
            return result
        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == srs_doc_id).where(SrsNode.table.isnot(None))
        ).scalars().all()
        code_pattern = re.compile(r"^SRS[-_A-Za-z0-9.]+$", re.I)
        for node in nodes:
            raw_table = node.table
            if not raw_table:
                continue
            try:
                table = json.loads(raw_table) if isinstance(raw_table, str) else raw_table
            except Exception:
                continue
            headers = table.get("headers") or []
            rows = table.get("rows") or []
            if not rows:
                cells = table.get("cells") or []
                body_cells = cells[1:] if len(cells) > 1 else []
                rows = []
                for cell_row in body_cells:
                    row_obj = {}
                    for idx, header in enumerate(headers or []):
                        if not isinstance(header, dict):
                            continue
                        col_code = header.get("code")
                        if not col_code:
                            continue
                        cell = cell_row[idx] if isinstance(cell_row, list) and idx < len(cell_row) else None
                        row_obj[col_code] = (cell or {}).get("value") if isinstance(cell, dict) else ""
                    if row_obj:
                        rows.append(row_obj)
            if not headers or not rows:
                continue
            col_idx = self.__resolve_srs_req_table_columns(headers)
            if "code" not in col_idx or "module" not in col_idx:
                continue

            def read_cell(row: dict, field: str) -> str:
                key = col_idx.get(field)
                if not key:
                    return ""
                return self.__normalize_hierarchy_part(row.get(key))

            last_values: Dict[str, str] = {}
            for row in rows:
                if not isinstance(row, dict):
                    continue
                code = self.__normalize_srs_code(read_cell(row, "code"))
                if not code or not code_pattern.match(code):
                    continue
                raw_module = read_cell(row, "module")
                raw_function = read_cell(row, "function")
                raw_sub_function = read_cell(row, "sub_function")
                if raw_module:
                    last_values["module"] = raw_module
                    last_values.pop("function", None)
                    last_values.pop("sub_function", None)
                if raw_function:
                    last_values["function"] = raw_function
                    last_values.pop("sub_function", None)
                if raw_sub_function:
                    last_values["sub_function"] = raw_sub_function
                result[code] = {
                    "module": last_values.get("module", ""),
                    "function": last_values.get("function", ""),
                    "sub_function": last_values.get("sub_function", ""),
                }
        return result

    @staticmethod
    def hierarchy_for_req(row_req: SrsReq = None, hierarchy_map: Dict[str, dict] = None, code: str = None) -> dict:
        req_code = (code or (getattr(row_req, "code", None) if row_req is not None else None) or "").strip().upper()
        item = (hierarchy_map or {}).get(req_code) if req_code else None
        if item:
            return item
        return {
            "module": getattr(row_req, "module", None) if row_req is not None else None,
            "function": getattr(row_req, "function", None) if row_req is not None else None,
            "sub_function": getattr(row_req, "sub_function", None) if row_req is not None else None,
        }

    def __ensure_traces_from_imported_srs_trace_table(self, sds_doc_id: int, srs_doc_id: int) -> bool:
        """SDS 页面兜底：SRS 需求表未生成时，从已导入 Word 的追溯表直接生成追溯数据。"""
        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == srs_doc_id).order_by(SrsNode.priority, SrsNode.n_id)
        ).scalars().all()
        if not nodes:
            return False

        def normalize_code(value: str) -> str:
            return re.sub(r"\s+", "", str(value or "").strip().upper())

        def clean_chapter(value: str) -> str:
            txt = str(value or "").strip()
            txt = re.sub(r"（章节\s*[^）]*）", "", txt)
            txt = re.sub(r"\(章节\s*[^)]*\)", "", txt)
            return txt.strip()

        rows_to_import = []
        seen = set()
        for node in nodes:
            table = getattr(node, "table", None)
            if isinstance(table, str):
                try:
                    table = json.loads(table)
                except Exception:
                    table = None
            if not isinstance(table, dict):
                continue
            headers = table.get("headers") or []
            rows = table.get("rows") or []
            if not headers or not rows:
                continue

            columns = {}
            for header in headers:
                if not isinstance(header, dict):
                    continue
                code = str(header.get("code") or "")
                name = re.sub(r"\s+", "", str(header.get("name") or ""))
                if ("需求编号" in name or name.lower() in ["srscode", "code"]) and "srs_code" not in columns:
                    columns["srs_code"] = code
                elif ("设计编号" in name or name.lower() in ["sdscode"]) and "sds_code" not in columns:
                    columns["sds_code"] = code
                elif ("需求/代码" in name or "需求代码" in name or "章节" in name) and "chapter" not in columns:
                    columns["chapter"] = code
            if "srs_code" not in columns or "sds_code" not in columns:
                continue

            for row in rows:
                if not isinstance(row, dict):
                    continue
                srs_code = normalize_code(row.get(columns.get("srs_code")) or "")
                sds_code = normalize_code(row.get(columns.get("sds_code")) or "")
                chapter = clean_chapter(row.get(columns.get("chapter")) or "")
                if not srs_code or not sds_code:
                    continue
                key = (srs_code, sds_code)
                if key in seen:
                    continue
                seen.add(key)
                rows_to_import.append({
                    "srs_code": srs_code,
                    "sds_code": sds_code,
                    "chapter": chapter or srs_code,
                })

        if not rows_to_import:
            return False

        req_values = [
            dict(
                doc_id=srs_doc_id,
                code=row["srs_code"],
                function=row["chapter"],
                type_code="1",
            )
            for row in rows_to_import
        ]
        db.session.execute(pg_insert(SrsReq).values(req_values).on_conflict_do_nothing())
        db.session.flush()

        req_rows = db.session.execute(
            select(SrsReq).where(SrsReq.doc_id == srs_doc_id, SrsReq.code.in_([row["srs_code"] for row in rows_to_import]))
        ).scalars().all()
        req_by_code = {normalize_code(row.code): row for row in req_rows}
        trace_values = []
        for row in rows_to_import:
            req = req_by_code.get(row["srs_code"])
            if not req:
                continue
            trace_values.append(
                dict(
                    doc_id=sds_doc_id,
                    req_id=req.id,
                    sds_code=row["sds_code"],
                    chapter=row["chapter"],
                )
            )
        if not trace_values:
            return False
        insert_stmt = pg_insert(SdsTrace).values(trace_values)
        db.session.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=["doc_id", "req_id"],
                set_=dict(
                    sds_code=insert_stmt.excluded.sds_code,
                    chapter=insert_stmt.excluded.chapter,
                )
            )
        )
        return True

    @staticmethod
    def __normalize_change_req_type_name(value: str):
        name = re.sub(r"\s+", " ", str(value or "").replace("：", ":")).rstrip(":").strip()
        return name or "变更需求"

    @staticmethod
    def __normalize_change_req_type_key(value: str):
        name = Server.__normalize_change_req_type_name(value)
        return re.sub(r"\s+", "", name)

    def __ensure_reqs_from_imported_srs_tables(self, srs_doc_id: int) -> bool:
        """SDS 同步前补齐 SRS Word 中导入的标准/其他/变更需求表。"""
        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == srs_doc_id).where(SrsNode.table.isnot(None))
        ).scalars().all()
        if not nodes:
            return False

        type_code_by_name = {}
        for row in db.session.execute(select(SrsType).where(SrsType.doc_id == srs_doc_id)).scalars().all():
            key = self.__normalize_change_req_type_key(row.type_name)
            if key and key not in type_code_by_name:
                type_code_by_name[key] = row.type_code
        type_values = {}
        req_values = {}
        for node in nodes:
            table = getattr(node, "table", None)
            if isinstance(table, str):
                try:
                    table = json.loads(table)
                except Exception:
                    table = None
            if not isinstance(table, dict):
                continue
            headers = table.get("headers") or []
            rows = table.get("rows") or []
            col_idx = self.__resolve_srs_req_table_columns(headers)
            if "code" not in col_idx or "module" not in col_idx:
                continue
            has_function_col = "function" in col_idx
            has_sub_function_col = "sub_function" in col_idx
            has_location_col = "location" in col_idx
            table_name = self.__normalize_change_req_type_name(table.get("name") or getattr(node, "title", ""))
            if "变更" in table_name:
                table_name_key = self.__normalize_change_req_type_key(table_name)
                type_code = type_code_by_name.get(table_name_key)
                if not type_code:
                    type_code = f"change_{hashlib.md5(table_name.encode('utf-8')).hexdigest()[:12]}"
                    if table_name_key:
                        type_code_by_name[table_name_key] = type_code
                type_values[type_code] = dict(doc_id=srs_doc_id, type_code=type_code, type_name=table_name)
            elif has_function_col or has_sub_function_col:
                type_code = "1"
            elif has_location_col:
                type_code = "2"
            else:
                continue
            last_values: Dict[str, str] = {}
            for row in rows:
                if not isinstance(row, dict):
                    continue
                code = self.__normalize_srs_code(row.get(col_idx.get("code")))
                if not code or not re.match(r"^SRS[-_A-Za-z0-9.]+$", code, re.I):
                    continue
                fields = {}
                for key in ["module", "function", "sub_function", "location"]:
                    col = col_idx.get(key)
                    value = self.__normalize_hierarchy_part(row.get(col)) if col else ""
                    if value:
                        last_values[key] = value
                        if key == "module":
                            last_values.pop("function", None)
                            last_values.pop("sub_function", None)
                        elif key == "function":
                            last_values.pop("sub_function", None)
                    fields[key] = last_values.get(key, "")
                req_values[(type_code, code)] = dict(
                    doc_id=srs_doc_id,
                    code=code,
                    type_code=type_code,
                    module=fields.get("module"),
                    function=fields.get("function"),
                    sub_function=fields.get("sub_function"),
                    location=fields.get("location"),
                )

        if type_values:
            insert_stmt = pg_insert(SrsType).values(list(type_values.values()))
            db.session.execute(
                insert_stmt.on_conflict_do_update(
                    index_elements=["doc_id", "type_code"],
                    set_=dict(type_name=insert_stmt.excluded.type_name),
                )
            )
        if req_values:
            insert_stmt = pg_insert(SrsReq).values(list(req_values.values()))
            db.session.execute(
                insert_stmt.on_conflict_do_update(
                    index_elements=["doc_id", "type_code", "code"],
                    set_=dict(
                        module=insert_stmt.excluded.module,
                        function=insert_stmt.excluded.function,
                        sub_function=insert_stmt.excluded.sub_function,
                        location=insert_stmt.excluded.location,
                    ),
                )
            )
        return bool(req_values)

    @staticmethod
    def compose_srs_req_chapter(
        row_req: SrsReq = None,
        module: str = None,
        function: str = None,
        sub_function: str = None,
        hierarchy_map: Dict[str, dict] = None,
        code: str = None,
    ) -> str:
        """需求/代码：有子功能取子功能，无子功能取功能，无功能取模块。"""
        fields = Server.hierarchy_for_req(row_req, hierarchy_map, code=code)
        module = module if module is not None else fields.get("module")
        function = function if function is not None else fields.get("function")
        sub_function = sub_function if sub_function is not None else fields.get("sub_function")
        candidates = [sub_function, function, module]
        if row_req is not None:
            candidates.extend([
                getattr(row_req, "sub_function", None),
                getattr(row_req, "function", None),
                getattr(row_req, "module", None),
            ])
        for val in candidates:
            txt = Server.__usable_req_chapter_name(val)
            if txt:
                return txt
        return ""

    @classmethod
    def resolve_trace_chapter(
        cls,
        stored_chapter: str = None,
        row_req: SrsReq = None,
        srs_code: str = None,
        hierarchy_map: Dict[str, dict] = None,
        **fields,
    ) -> str:
        """展示用章节名：优先按 SRS 层级字段实时计算，仅固定映射/多行追溯保留库内值。"""
        req_code = srs_code or (getattr(row_req, "code", None) if row_req is not None else None)
        code = (req_code or "").strip().upper()
        fixed = fixed_rcn300_trace_for_code(code)
        if fixed:
            return "\n".join(item[1] for item in fixed)
        composed = cls.compose_srs_req_chapter(row_req, hierarchy_map=hierarchy_map, code=req_code, **fields)
        stored = (stored_chapter or "").strip()
        stored_lines = [ln.strip() for ln in re.split(r"[\r\n]+", stored) if ln and ln.strip()]
        if len(stored_lines) > 1:
            return stored
        return composed or (stored_lines[0] if stored_lines else "")

    @classmethod
    def trace_chapter_lines(
        cls,
        stored_chapter: str = None,
        row_req: SrsReq = None,
        srs_code: str = None,
        hierarchy_map: Dict[str, dict] = None,
        **fields,
    ) -> List[str]:
        """追溯表「需求/代码」列：单行需求用层级字段，固定多行映射保留各行原文。

        基本要求、数据库要求、文档需求这三类章节在 SDS 内不读取：其他行手填的编号即使
        指向这三章，也不解析成它们的章节名，留空占位，不影响同一编号在其他章节下的行。
        """
        req_code = srs_code or (getattr(row_req, "code", None) if row_req is not None else None)
        code = (req_code or "").strip().upper()
        fixed = fixed_rcn300_trace_for_code(code)
        if fixed:
            return [item[1] for item in fixed]
        composed = cls.compose_srs_req_chapter(row_req, hierarchy_map=hierarchy_map, code=req_code, **fields)
        stored_lines = [ln.strip() for ln in re.split(r"[\r\n]+", (stored_chapter or "")) if ln and ln.strip()]
        lines = [composed] if composed else (stored_lines or [""])
        return [
            "" if is_sds_excluded_module(line) else line
            for line in lines
        ]

    def __ensure_sds_traces(self, prod_id: int = None, doc_id: int = None, force: bool = False):
        """补齐追溯行。

        force=False（列表/刷新/打开/导出）：design_manual=True 的行一律跳过，库里手改的设计编号原样保留。
        force=True（点「获取SRS追溯」）：清掉手改标记，按当前 SRS 重新取。
        """
        if not prod_id and not doc_id:
            return
        try:
            sql_docs = select(SdsDoc.id, SdsDoc.srsdoc_id).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            if doc_id:
                sql_docs = sql_docs.where(SdsDoc.id == doc_id)
            if prod_id:
                sql_docs = sql_docs.where(SrsDoc.product_id == prod_id)
            docs = db.session.execute(sql_docs).all()
            for sds_doc_id, srs_doc_id in docs:
                # 获取SRS追溯：先清掉手改标记，让下面的逻辑按 SRS 重算
                if force:
                    db.session.execute(
                        update(SdsTrace)
                        .where(SdsTrace.doc_id == sds_doc_id)
                        .where(SdsTrace.design_manual.is_(True))
                        .values(design_manual=False)
                    )
                hierarchy_map = self.__load_srs_req_hierarchy_map(srs_doc_id)
                self.__ensure_reqs_from_imported_srs_tables(srs_doc_id)
                reqs = db.session.execute(
                    select(SrsReq.id, SrsReq.code, SrsReq.module, SrsReq.function, SrsReq.sub_function, SrsReq.type_code)
                    .where(SrsReq.doc_id == srs_doc_id)
                    .where(SrsReq.type_code != "reqd")
                ).all()
                if not reqs:
                    if self.__ensure_traces_from_imported_srs_trace_table(sds_doc_id, srs_doc_id):
                        continue
                    continue
                values = []
                fixed_values = []
                living_codes = [code for _req_id, code, _module, _function, _sub_function, _type_code in reqs]
                existing_rows = {
                    req_id: (sds_code, bool(design_manual))
                    for req_id, sds_code, design_manual in db.session.execute(
                        select(SdsTrace.req_id, SdsTrace.sds_code, SdsTrace.design_manual)
                        .where(SdsTrace.doc_id == sds_doc_id)
                    ).all()
                }
                existing_codes = {req_id: code for req_id, (code, _manual) in existing_rows.items()}
                # 手改过的追溯行：库里设计编号原样保留，本次补齐一律跳过（force 已在上方清掉标记）
                manual_req_ids = {req_id for req_id, (_code, manual) in existing_rows.items() if manual}

                def persist_own_design_code(req_id, stored, derived_code, module_name):
                    rewritten = rewrite_own_design_code(stored, derived_code, living_codes)
                    stored_norm = _dedupe_design_lines(split_design_code_lines(stored))
                    if not rewritten or rewritten == stored_norm:
                        return
                    trace = db.session.execute(
                        select(SdsTrace).where(SdsTrace.doc_id == sds_doc_id, SdsTrace.req_id == req_id)
                    ).scalars().first()
                    if trace is not None:
                        trace.sds_code = rewritten
                    old_lines = set(split_design_code_lines(stored))
                    new_lines = set(split_design_code_lines(rewritten))
                    for old in old_lines - new_lines:
                        align_sds_node_code(sds_doc_id, old, derived_code, module_name)

                for req_id, code, module, function, sub_function, type_code in reqs:
                    # 手改过设计编号的行一律不参与自动补算，库里这一条原样保留
                    if req_id in manual_req_ids:
                        continue
                    fields = self.hierarchy_for_req(None, hierarchy_map, code=code)
                    if not fields.get("module") and not fields.get("function") and not fields.get("sub_function"):
                        fields = {"module": module, "function": function, "sub_function": sub_function}
                    fixed_trace = fixed_rcn300_trace_for_code(code)
                    filtered_trace = filter_fixed_trace_to_living(fixed_trace, living_codes) if fixed_trace is not None else None
                    if str(type_code) == "2":
                        derived_code = (code or "").replace("SRS", "SDS").strip()
                        role = normalize_other_req_design_role("", module, code)
                        legacy_lines = [item[0] for item in (fixed_trace or [])]
                        cross_map = other_req_fixed_trace_is_cross_map(code, fixed_trace)
                        if role and other_req_role_is_changed(code, module, role):
                            if other_req_keeps_design_code(existing_codes.get(req_id), module, [derived_code], legacy_lines):
                                persist_own_design_code(req_id, existing_codes.get(req_id), derived_code, module)
                                continue
                            align_sds_node_code(sds_doc_id, existing_codes.get(req_id), derived_code, module)
                            values.append(
                                dict(
                                    doc_id=sds_doc_id,
                                    req_id=req_id,
                                    sds_code=derived_code,
                                    chapter=other_req_role_display_name(module, role),
                                )
                            )
                            continue
                        if cross_map or fixed_trace is None:
                            legacy_follow = other_req_stored_follows_cross_map(existing_codes.get(req_id), code, fixed_trace)
                            if not legacy_follow and other_req_keeps_design_code(existing_codes.get(req_id), module, [derived_code], legacy_lines):
                                persist_own_design_code(req_id, existing_codes.get(req_id), derived_code, module)
                                continue
                            align_sds_node_code(sds_doc_id, existing_codes.get(req_id), derived_code, module)
                            fixed_values.append(
                                dict(
                                    doc_id=sds_doc_id,
                                    req_id=req_id,
                                    sds_code=derived_code,
                                    chapter=other_req_role_display_name(module, role) if role else (module or ""),
                                    location="",
                                )
                            )
                            continue
                        if fixed_trace is not None:
                            kept = filtered_trace or []
                            if other_req_keeps_design_code(
                                existing_codes.get(req_id),
                                module,
                                [item[0] for item in kept],
                                legacy_lines,
                            ):
                                persist_own_design_code(req_id, existing_codes.get(req_id), derived_code, module)
                                continue
                        elif other_req_keeps_design_code(existing_codes.get(req_id), module, [derived_code]):
                            persist_own_design_code(req_id, existing_codes.get(req_id), derived_code, module)
                            continue
                    if fixed_trace is not None:
                        kept = filtered_trace or []
                        fixed_values.append(
                            dict(
                                doc_id=sds_doc_id,
                                req_id=req_id,
                                sds_code="\n".join([item[0] for item in kept]),
                                chapter="\n".join([item[1] for item in kept]),
                                location="\n".join([item[2] for item in kept]),
                            )
                        )
                        continue
                    values.append(
                        dict(
                            doc_id=sds_doc_id,
                            req_id=req_id,
                            sds_code=(code or "").replace("SRS", "SDS"),
                            chapter=(
                                self.compose_srs_req_chapter(
                                    None, hierarchy_map=hierarchy_map, code=code, **fields
                                )
                                or self.__usable_req_chapter_name(sub_function)
                                or self.__usable_req_chapter_name(function)
                                or self.__usable_req_chapter_name(module)
                                or "/"
                            ),
                        )
                    )
                if values:
                    insert_stmt = pg_insert(SdsTrace).values(values)
                    stored_code = SdsTrace.sds_code
                    multi_code = or_(
                        stored_code.contains("\n"),
                        stored_code.contains(","),
                        stored_code.contains("，"),
                    )
                    db.session.execute(
                        insert_stmt.on_conflict_do_update(
                            index_elements=["doc_id", "req_id"],
                            set_=dict(
                                chapter=insert_stmt.excluded.chapter,
                                # 单行设计编号跟当前需求编号走；多行手写编号保留
                                sds_code=case(
                                    (
                                        or_(stored_code.is_(None), stored_code == "", ~multi_code),
                                        insert_stmt.excluded.sds_code,
                                    ),
                                    else_=stored_code,
                                ),
                            ),
                        )
                    )
                for item in fixed_values:
                    insert_stmt = pg_insert(SdsTrace).values(item)
                    db.session.execute(
                        insert_stmt.on_conflict_do_update(
                            index_elements=["doc_id", "req_id"],
                            set_=dict(
                                sds_code=insert_stmt.excluded.sds_code,
                                chapter=insert_stmt.excluded.chapter,
                                location=insert_stmt.excluded.location,
                            ),
                        )
                    )
            db.session.commit()
        except Exception:
            logger.exception("ensure_sds_traces_failed")
            db.session.rollback()

    @staticmethod
    def __normalize_name(value: str):
        txt = (value or "").strip()
        matched = re.match(
            r"^((?:\d+(?:\.\d+)+|\d{1,2}))(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            txt,
        )
        if matched:
            prefix = matched.group(1)
            if "." in prefix or len(prefix) <= 2:
                txt = txt[matched.end():].strip()
        txt = re.sub(r"[\s:：\-_，。；;、,.()（）]+", "", txt)
        return txt.lower()
    
    async def update_sds_trace(self, form: SdsTraceForm):
        try:
            if not form.id:
                row = SdsTrace(**form.dict())
                db.session.add(row)
            else:
                row = db.session.execute(select(SdsTrace).where(SdsTrace.id == form.id)).scalars().first()
                if not row:
                    return Resp.resp_err(msg=ts("msg_obj_null"))
                logger.info("location: %s", form.location)
                # 设计编号被改动时打上手改标记：此后刷新/打开/导出都保留库里这一条，
                # 只有「获取SRS追溯」才会清除标记重新取。
                code_changed = (
                    form.sds_code is not None
                    and str(form.sds_code or "").strip() != str(row.sds_code or "").strip()
                )
                for key, value in form.dict().items():
                    logger.info("update: %s: %s", key, value)
                    if key == "id" or value is None:
                        continue
                    setattr(row, key, value)
                if code_changed:
                    row.design_manual = True
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    def __query_srs_types(self, req_ids):
        results = dict()
        if req_ids:
            sql = select(SrsReq, SrsType).where(SrsReq.type_code == SrsType.type_code).where(SrsReq.id.in_(req_ids))
            rows = db.session.execute(sql).all()
            for row_req, row_type in rows:
                results[row_req.id] = row_type.type_name
        return results
    
    @staticmethod
    def __normalize_req_code(value: str):
        return re.sub(r"\s+", "", str(value or "").strip().upper())

    def __query_srs_doc_req_order(self, doc_ids: List[int]) -> Dict[Tuple[int, str], int]:
        if not doc_ids:
            return {}
        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode)
            .where(SrsNode.doc_id.in_(doc_ids), SrsNode.table.isnot(None))
            .order_by(SrsNode.doc_id, SrsNode.priority, SrsNode.n_id)
        ).scalars().all()
        order_map: Dict[Tuple[int, str], int] = {}
        seq_by_doc: Dict[int, int] = {}
        for node in nodes:
            table = node.table
            if isinstance(table, str):
                try:
                    table = json.loads(table)
                except Exception:
                    table = None
                if isinstance(table, str):
                    try:
                        table = json.loads(table)
                    except Exception:
                        table = None
            if not isinstance(table, dict):
                continue
            rows = table.get("rows") or []
            if not isinstance(rows, list):
                continue
            for item in rows:
                if not isinstance(item, dict):
                    continue
                code = ""
                for value in item.values():
                    txt = self.__normalize_req_code(value)
                    if re.match(r"^SRS-[A-Z]+\d+-\d+$", txt):
                        code = txt
                        break
                if not code:
                    continue
                key = (node.doc_id, code)
                if key in order_map:
                    continue
                seq_by_doc[node.doc_id] = seq_by_doc.get(node.doc_id, 0) + 1
                order_map[key] = seq_by_doc[node.doc_id]
        return order_map

    def __query_srs_doc_change_type_order(self, doc_ids: List[int]) -> Dict[Tuple[int, str], int]:
        if not doc_ids:
            return {}
        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode)
            .where(SrsNode.doc_id.in_(doc_ids), SrsNode.table.isnot(None))
            .order_by(SrsNode.doc_id, SrsNode.priority, SrsNode.n_id)
        ).scalars().all()
        order_map: Dict[Tuple[int, str], int] = {}
        seq_by_doc: Dict[int, int] = {}
        for node in nodes:
            table = node.table
            if isinstance(table, str):
                try:
                    table = json.loads(table)
                except Exception:
                    table = None
            if not isinstance(table, dict):
                continue
            table_name = self.__normalize_change_req_type_name(table.get("name") or getattr(node, "title", ""))
            if "变更" not in table_name:
                continue
            key = (node.doc_id, self.__normalize_change_req_type_key(table_name))
            if key in order_map:
                continue
            seq_by_doc[node.doc_id] = seq_by_doc.get(node.doc_id, 0) + 1
            order_map[key] = seq_by_doc[node.doc_id]
        return order_map

    def __resort_rows(self, rows: List[Tuple[SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product]]):
        order_map = self.__query_srs_doc_req_order(list({row_srsdoc.id for _, _, _, _, row_srsdoc, _ in rows if row_srsdoc}))
        change_type_order_map = self.__query_srs_doc_change_type_order(
            list({row_srsdoc.id for _, _, row_type, _, row_srsdoc, _ in rows if row_srsdoc and row_type})
        )
        sorted_rows = []
        for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            type_id = row_type.id if row_type else sys.maxsize
            type_id = -1 if row_req.type_code == "1" else type_id
            type_id = 0 if row_req.type_code == "2" else type_id
            if row_req.type_code not in ["1", "2"] and row_srsdoc and row_type:
                type_order = change_type_order_map.get((
                    row_srsdoc.id,
                    self.__normalize_change_req_type_key(row_type.type_name),
                ))
                if type_order is not None:
                    type_id = type_order
            doc_order = order_map.get((row_srsdoc.id if row_srsdoc else 0, self.__normalize_req_code(row_req.code)), sys.maxsize)
            key = (-row_sdsdoc.id, type_id, doc_order, self.__srs_code_sort_key(row_req.code))
            sorted_rows.append((key, (row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product)))
        sorted_rows.sort(key=lambda x: x[0])
        return [x[1] for x in sorted_rows]

    @staticmethod
    def __srs_code_sort_key(value: str):
        txt = str(value or "").replace(" ", "").upper()
        matched = re.match(r"^SRS-[A-Z]+(\d+)-(\d+)$", txt)
        if matched:
            series_raw = matched.group(1)
            seq = int(matched.group(2))
            if series_raw.startswith("3") and len(series_raw) > 1:
                series = int(series_raw[1:])
            else:
                series = int(series_raw)
            return (series, seq, txt)
        return (sys.maxsize, sys.maxsize, txt)

    def __sort_objs_by_srs_manage_order(self, objs: List[SdsTraceObj]):
        return objs or []
    

    def __find_path(self, level: int, sdscode: str, nodes: List[SdsNodeForm], paths: List[str] = None):
        target_codes = set(self.__extract_code_tokens(sdscode))
        for node in nodes or []:
            npaths = [node.title] if level == 0 else paths + [node.title]
            node_codes = set(self.__extract_code_tokens(getattr(node, "sds_code", None)))
            is_exact_match = (node.sds_code or "").strip() == (sdscode or "").strip()
            has_code_overlap = bool(target_codes and node_codes and (target_codes & node_codes))
            if is_exact_match or has_code_overlap:
                return npaths, node
            cpaths, cnode = self.__find_path(level + 1, sdscode, node.children, npaths)
            if cnode:
                return cpaths, cnode
        return paths, None
    
    def __find_chapter(self, paths: List[str] = None):
        for path in reversed(paths or []):
            chapter = self.__extract_chapter_code(path)
            if chapter:
                return chapter

    @staticmethod
    def __extract_chapter_code(value: str):
        txt = (value or "").strip()
        if not txt:
            return None
        # 仅提取“标题前缀章节号”，避免把正文中的普通数字误识别为章节号（如“数据上传1111”）
        # 兼容前置符号/换行（如 "-7. 法规符合性需求"）
        candidates = [line.strip() for line in re.split(r'[\r\n]+', txt) if line and line.strip()]
        if not candidates:
            candidates = [txt]
        for line in candidates:
            normalized = re.sub(r'^[\s\u3000•·▪■◆●○□◇\-–—_~()（）\[\]【】]+', "", line)
            matched = re.match(r'^(\d+(?:\.\d+)*)(?:[\s、.．:：\-–—]+|(?=[\u4e00-\u9fffA-Za-z])|$)', normalized)
            if not matched:
                continue
            chapter = matched.group(1)
            # 单级章节号限制为 1~2 位，降低把年份/流水号误判为章节号的概率
            if "." not in chapter and len(chapter) > 2:
                continue
            return chapter
        return None

    @staticmethod
    def __extract_code_tokens(value: str):
        txt = (value or "").strip().upper()
        if not txt:
            return []
        parts = re.split(r'[\s,，;；、|/\\\n\r\t]+', txt)
        return [part for part in parts if part]

    @staticmethod
    def __build_match_names(*raw_values: str):
        names = []
        for raw in raw_values:
            txt = (raw or "").strip()
            if not txt:
                continue
            variants = [txt]
            mapped = NAME_DICT.get(txt)
            if mapped:
                variants.append(mapped)
            for item in variants:
                for norm in Server.__name_match_variants(item):
                    if norm and norm not in names:
                        names.append(norm)
        return names

    @staticmethod
    def __shift_chapter_major(chapter: str, offset: int):
        txt = (chapter or "").strip()
        if not txt or not offset:
            return txt
        parts = txt.split(".")
        if not parts:
            return txt
        try:
            major = int(parts[0])
        except Exception:
            return txt
        shifted_major = major - offset
        if shifted_major <= 0:
            return txt
        parts[0] = str(shifted_major)
        return ".".join(parts)

    def __get_doc_chapter_offset(self, tree: List[SdsNodeForm] = None):
        for node in tree or []:
            title = (getattr(node, "title", "") or "").strip()
            if "软件详细设计" in title:
                chapter = self.__extract_chapter_code(title)
                if not chapter:
                    return 0
                try:
                    return int(str(chapter).split(".")[0])
                except Exception:
                    return 0
        return 0

    @staticmethod
    def __name_match_variants(value: str):
        txt = (value or "").strip()
        if not txt:
            return []
        variants = [txt]
        # 去掉标题中的括号补充说明，如 “法规符合性需求(网络安全)” -> “法规符合性需求”
        no_bracket = re.sub(r"[（(][^）)]*[）)]", "", txt).strip()
        if no_bracket and no_bracket not in variants:
            variants.append(no_bracket)
        # 业务常见同义写法归一（SRS 与 SDS 文案不完全一致）
        if "法规符合需求" in txt:
            variants.append(txt.replace("法规符合需求", "法规符合性需求"))
        if "法规符合性需求" in txt:
            variants.append(txt.replace("法规符合性需求", "法规符合需求"))
        normalized = []
        for item in variants:
            n = Server.__normalize_name(item)
            if n and n not in normalized:
                normalized.append(n)
        return normalized

    def __find_path_by_names(self, level: int, names: List[str], nodes: List[SdsNodeForm], paths: List[str] = None, exact_only: bool = True):
        for node in nodes or []:
            title = getattr(node, "title", "") or ""
            label = getattr(node, "label", "") or ""
            clean_title = self.__clean_path_title(title)
            title_norms = self.__name_match_variants(clean_title)
            label_norms = self.__name_match_variants(label)
            merged_norm = self.__normalize_name(f"{clean_title}{label}")
            npaths = [node.title] if level == 0 else paths + [node.title]
            if exact_only:
                hit = any(name and ((name in title_norms) or (name in label_norms)) for name in names or [])
            else:
                hit = any(
                    name and (
                        (name in title_norms)
                        or (name in label_norms)
                        or (merged_norm == name)
                        or (name in merged_norm)
                        or (merged_norm in name)
                    )
                    for name in names or []
                )
            if hit:
                return npaths, node
            cpaths, cnode = self.__find_path_by_names(level + 1, names, node.children, npaths, exact_only)
            if cnode:
                return cpaths, cnode
        return paths, None

    def __find_sds_node_for_trace(self, sdscode: str, row_req: SrsReq, nodes: List[SdsNodeForm]):
        """在 SDS 树中定位需求节点：仅 sds_code / 正文设计编号。"""
        target_codes = set(self.__extract_code_tokens(sdscode))

        def walk_by_code(items: List[SdsNodeForm]):
            for node in items or []:
                for code in self.__extract_node_sds_codes(node):
                    if code in target_codes:
                        return node
                found = walk_by_code(getattr(node, "children", None) or [])
                if found:
                    return found
            return None

        _, node = self.__find_path(0, sdscode, nodes or [], [])
        if node:
            return node
        return walk_by_code(nodes or [])

    def __location_from_sds_node(self, node: SdsNodeForm) -> str:
        return self.__extract_chapter_code(getattr(node, "title", "") or "") or ""

    def __resolve_sds_tree_location(
        self,
        sdscode: str,
        row_req: SrsReq,
        nodes: List[SdsNodeForm],
        by_code: dict = None,
        by_title: dict = None,
    ) -> str:
        """章节号只取 SDS 树上与 sds_code 绑定的节点，不用子功能名兜底（避免同名串号）。"""
        by_code = by_code or {}
        locations = []
        for token in self.__extract_code_tokens(sdscode):
            loc = by_code.get(token)
            if not loc and nodes:
                node = self.__find_sds_node_for_trace(token, row_req, nodes)
                if node:
                    loc = self.__location_from_sds_node(node)
            if loc:
                locations.append(loc)
        seen = set()
        ordered = []
        for item in locations:
            if item and item not in seen:
                seen.add(item)
                ordered.append(item)
        return "\n".join(ordered)

    @staticmethod
    def __is_placeholder_name(value: str):
        txt = (value or "").strip()
        return txt in ["", "/", "\\", "-", "--", "—", "N/A", "n/a", "无", "暂无"]

    @staticmethod
    def __is_empty_location(value: str):
        txt = (value or "").strip()
        return txt in ["", "-", "--", "—", "/", "\\", "无", "暂无", "N/A", "n/a"]

    @staticmethod
    def __extract_sds_code_token(txt: str) -> str:
        matched = re.search(
            r"SDS\s*-\s*[A-Za-z0-9._-]+(?:\s*[-_]\s*[A-Za-z0-9._-]+)*",
            str(txt or ""),
            flags=re.I,
        )
        return re.sub(r"\s+", "", matched.group(0)).upper() if matched else ""

    @classmethod
    def __extract_node_sds_codes(cls, node: SdsNodeForm) -> List[str]:
        codes: List[str] = []
        seen = set()

        def add(raw: str):
            code = re.sub(r"\s+", "", str(raw or "").strip().upper())
            if code and code not in seen:
                seen.add(code)
                codes.append(code)

        field = str(getattr(node, "sds_code", "") or "")
        for token in re.split(r"[\r\n,，;；]+", field):
            add(token)
        lines = str(getattr(node, "text", "") or "").replace("\r", "").split("\n")
        for idx, line in enumerate(lines):
            matched = re.match(r"设计编号\s*[：:]\s*(.*)$", str(line or "").strip())
            if not matched:
                continue
            part = str(matched.group(1) or "").strip()
            token = cls.__extract_sds_code_token(part)
            if not token and idx + 1 < len(lines):
                token = cls.__extract_sds_code_token(f"{part}\n{lines[idx + 1]}")
            if token:
                add(token)
        return codes

    @staticmethod
    def __heading_depth(value: str) -> int:
        txt = str(value or "").strip()
        return len(txt.split(".")) if txt else 0

    def __build_sds_location_map(self, nodes: List[SdsNodeForm]):
        result = {}

        def walk(items: List[SdsNodeForm]):
            for node in items or []:
                chapter = self.__extract_chapter_code(getattr(node, "title", "") or "")
                if not chapter:
                    walk(getattr(node, "children", None) or [])
                    continue
                for token in self.__extract_node_sds_codes(node):
                    prev = result.get(token)
                    if not prev or self.__heading_depth(chapter) >= self.__heading_depth(prev):
                        result[token] = chapter
                walk(getattr(node, "children", None) or [])

        walk(nodes or [])
        return result

    @staticmethod
    def __code_numbers(code: str):
        return [int(item) for item in re.findall(r"\d+", (code or "").upper())]

    @classmethod
    def __compare_code(cls, code: str):
        return cls.__code_numbers(code), (code or "").upper()

    @staticmethod
    def __increment_chapter(chapter: str):
        parts = (chapter or "").strip().split(".")
        if not parts:
            return ""
        try:
            parts[-1] = str(int(parts[-1]) + 1)
        except Exception:
            return ""
        return ".".join(parts)

    def __is_function_stopper_title(self, title: str):
        text = self.__normalize_name(self.__clean_path_title(title))
        return "限制条件" in text or "尚未解决的问题" in text

    @staticmethod
    def __is_front_matter_root(title: str) -> bool:
        body = re.sub(r"\s+", "", str(title or "")).lower()
        return any(
            key in body
            for key in ("软件详细设计", "概述", "系统结构", "目录", "需求规格说明", "文件修订记录")
        )

    def __find_design_chapter_roots(self, nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
        out: List[SdsNodeForm] = []
        for node in nodes or []:
            title = getattr(node, "title", "") or ""
            if self.__is_front_matter_root(title):
                continue
            if self.__extract_chapter_code(title):
                out.append(node)
        return out

    @staticmethod
    def __rcn_series_num(code: str):
        matched = re.search(r"RCN(\d+)", str(code or "").upper())
        return int(matched.group(1)) if matched else None

    def __resolve_product_major_for_req(self, code: str, type_code: str = None) -> Optional[int]:
        series = self.__rcn_series_num(code)
        type_code = str(type_code or "").strip()
        if series == 307 or (type_code and type_code not in ("1", "2", "reqd")):
            return 6
        if series is not None and 301 <= series <= 306:
            return 7
        return None

    def __find_product_root_by_major(self, nodes: List[SdsNodeForm], major: int):
        for root in self.__find_design_chapter_roots(nodes):
            heading = self.__extract_chapter_code(getattr(root, "title", "") or "")
            try:
                if heading and int(heading.split(".")[0]) == major:
                    return root
            except Exception:
                continue
        return None

    def __find_change_req_base_heading(self, product_root: SdsNodeForm) -> str:
        """变更需求默认挂在 RePACS 6.8 之后：6.8.1 / 6.8.2 …"""
        for child in getattr(product_root, "children", None) or []:
            heading = self.__extract_chapter_code(getattr(child, "title", "") or "")
            if heading == "6.8":
                return "6.8"
        return ""

    def __code_heading_in_product(self, code: str, major: int, tree: List[SdsNodeForm], by_code: dict) -> str:
        loc = (by_code or {}).get(code) or ""
        if loc:
            try:
                loc_major = int(str(loc).split(".")[0])
            except Exception:
                loc_major = None
            if loc_major != major:
                loc = ""
        if not loc:
            for token in self.__extract_code_tokens(code):
                node = self.__find_sds_node_for_trace(token, None, tree or [])
                if not node:
                    continue
                loc = self.__location_from_sds_node(node)
                if not loc:
                    continue
                try:
                    if int(loc.split(".")[0]) != major:
                        loc = ""
                        continue
                except Exception:
                    loc = ""
                    continue
                break
        if not loc:
            return ""
        expected_major = self.__resolve_product_major_for_req(code, None)
        if expected_major is not None and expected_major != major:
            return ""
        if self.__rcn_series_num(code) == 307:
            return loc if str(loc).startswith("6.8.") else ""
        return loc

    def __find_function_area_insert_heading(self, nodes: List[SdsNodeForm], product_root: SdsNodeForm = None):
        roots_to_search = [product_root] if product_root else self.__find_design_chapter_roots(nodes)
        for node in roots_to_search:
            if node is None:
                continue
            title = getattr(node, "title", "") or ""
            heading = self.__extract_chapter_code(title)
            is_product_root = bool(heading and "." not in heading)
            is_function_area = is_product_root or heading == "6" or "功能设计" in self.__normalize_name(self.__clean_path_title(title))
            if is_function_area:
                child_infos = []
                for child in getattr(node, "children", None) or []:
                    child_heading = self.__extract_chapter_code(getattr(child, "title", "") or "")
                    if child_heading:
                        child_infos.append((getattr(child, "title", "") or "", child_heading))
                for child_title, child_heading in child_infos:
                    if self.__is_function_stopper_title(child_title):
                        return child_heading
                normal_headings = [child_heading for child_title, child_heading in child_infos if not self.__is_function_stopper_title(child_title)]
                if normal_headings:
                    return self.__increment_chapter(normal_headings[-1])
                return f"{heading}.1" if heading else ""
            child_heading = self.__find_function_area_insert_heading(getattr(node, "children", None) or [], product_root=None)
            if child_heading:
                return child_heading
        return ""

    def __req_hierarchy_titles(self, row_req: SrsReq):
        titles = []
        for value in [row_req.module, row_req.function, row_req.sub_function]:
            txt = (value or "").strip()
            if not self.__is_placeholder_name(txt):
                norm = self.__normalize_name(txt) or txt.lower()
                if norm and norm not in [item[0] for item in titles]:
                    titles.append((norm, txt))
        return [item[1] for item in titles]

    def __build_virtual_location_map(self, rows: List[Tuple[SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product]], doc_trees, doc_sds_locations):
        result = {}
        groups = {}
        for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            if row_req.type_code in ["1", "2"]:
                continue
            code = ((row_req.code or "").replace("SRS", "SDS")).strip().upper()
            if not code:
                continue
            major = self.__resolve_product_major_for_req(code, row_req.type_code)
            if major is None:
                continue
            doc_id = row_sdsdoc.id
            tree = doc_trees.get(doc_id) or []
            by_code = doc_sds_locations.get(doc_id) or {}
            if self.__code_heading_in_product(code, major, tree, by_code):
                continue
            saved_loc = (getattr(row_reqd, "location", "") or "").strip().split("\n")[0].strip()
            if saved_loc and not self.__is_empty_location(saved_loc):
                try:
                    if int(saved_loc.split(".")[0]) == major:
                        continue
                except Exception:
                    pass
            is_change = row_req.type_code not in ("1", "2", "reqd") or self.__rcn_series_num(code) == 307
            type_key = "change" if is_change else "functional"
            groups.setdefault((doc_id, major, type_key), []).append((code, row_req))

        for (doc_id, major, type_key), items in groups.items():
            tree = doc_trees.get(doc_id) or []
            product_root = self.__find_product_root_by_major(tree, major)
            if product_root is None:
                continue
            if type_key == "change" and major == 6:
                base = self.__find_change_req_base_heading(product_root)
                if base:
                    for index, (code, _row_req) in enumerate(sorted(items, key=lambda item: self.__compare_code(item[0]))):
                        result[code] = f"{base}.{index + 1}"
                    continue
                insert_heading = self.__find_function_area_insert_heading(tree, product_root)
                if insert_heading:
                    parent_heading = ".".join(insert_heading.split(".")[:-1])
                    try:
                        start_index = int(insert_heading.split(".")[-1])
                    except Exception:
                        start_index = 6
                    for index, (code, _row_req) in enumerate(sorted(items, key=lambda item: self.__compare_code(item[0]))):
                        if parent_heading:
                            result[code] = f"{parent_heading}.{start_index + index}"
                        else:
                            result[code] = f"{major}.{start_index + index}"
                    continue
            insert_heading = self.__find_function_area_insert_heading(tree, product_root)
            if not insert_heading:
                continue
            parent_heading = ".".join(insert_heading.split(".")[:-1])
            try:
                start_index = int(insert_heading.split(".")[-1])
            except Exception:
                continue
            roots = []
            for code, row_req in sorted(items, key=lambda item: self.__compare_code(item[0])):
                level_nodes = roots
                titles = self.__req_hierarchy_titles(row_req)
                if not titles:
                    titles = [code]
                for index, title in enumerate(titles):
                    norm = self.__normalize_name(title) or (title or "").strip().lower()
                    target = None
                    for node in level_nodes:
                        if node["norm"] == norm:
                            target = node
                            break
                    if target is None:
                        target = {"norm": norm, "title": title, "children": [], "code": None}
                        level_nodes.append(target)
                    if index == len(titles) - 1 and not target["code"]:
                        target["code"] = code
                    level_nodes = target["children"]

            def assign(nodes, base_heading):
                for index, node in enumerate(nodes):
                    heading = f"{base_heading}.{index + 1}" if base_heading else str(start_index + index)
                    if base_heading == parent_heading:
                        heading = f"{parent_heading}.{start_index + index}" if parent_heading else str(start_index + index)
                    if node.get("code") and node["code"] not in result:
                        result[node["code"]] = heading
                    assign(node.get("children") or [], heading)

            assign(roots, parent_heading)
        return result

    def build_sync_location_map(self, doc_id: int, roots: List[SdsNodeForm]) -> dict:
        """为同步功能章节准备 location：树上已有 + 虚拟章节 + 追溯表已存 location。"""
        by_code = self.__build_sds_location_map(roots or [])
        result = dict(by_code)
        sql = (
            select(SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product)
            .join(SrsReq, SrsReq.id == SdsTrace.req_id)
            .outerjoin(SrsType, SrsReq.type_code == SrsType.type_code)
            .join(SdsDoc, SdsDoc.id == SdsTrace.doc_id)
            .join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            .join(Product, SrsDoc.product_id == Product.id)
            .where(SdsDoc.id == doc_id)
        )
        rows = db.session.execute(sql).all()
        virtual = self.__build_virtual_location_map(rows, {doc_id: roots or []}, {doc_id: by_code})
        result.update(virtual or {})
        for trace, req, *_rest in rows:
            loc = (getattr(trace, "location", "") or "").strip()
            if not loc or self.__is_empty_location(loc):
                continue
            for token in self.__extract_code_tokens(getattr(trace, "sds_code", "") or ""):
                token = re.sub(r"\s+", "", token).upper()
                expected_major = self.__resolve_product_major_for_req(token, getattr(req, "type_code", None))
                loc_head = loc.split("\n")[0].strip()
                if expected_major is not None:
                    try:
                        if int(loc_head.split(".")[0]) != expected_major:
                            continue
                    except Exception:
                        continue
                if token in virtual:
                    continue
                result.setdefault(token, loc_head)
        return result

    def __resolve_sds_locations(self, row_reqd: SdsTrace, doc_id: int, doc_sds_locations, virtual_sds_locations):
        saved_locations = [
            item.strip()
            for item in re.split(r"[\r\n]+", getattr(row_reqd, "location", "") or "")
            if item.strip() and not self.__is_empty_location(item)
        ]
        if saved_locations:
            return "\n".join(saved_locations)
        locations = []
        has_code = False
        for token in self.__extract_code_tokens(getattr(row_reqd, "sds_code", "") or ""):
            has_code = True
            location = (doc_sds_locations.get(doc_id) or {}).get(token) or virtual_sds_locations.get(token) or ""
            locations.append(location)
        if not has_code:
            return None
        return "\n".join(locations) or None

    @staticmethod
    def __clean_path_title(value: str):
        txt = (value or "").strip()
        if not txt:
            return ""
        # 去掉前置章节号，如 "6.7.12 新增科室"
        txt = re.sub(r"^\s*\d+(?:\.\d+)*\s*", "", txt).strip()
        return txt

    def __pick_req_display_name(self, row_req: SrsReq, paths: List[str] = None):
        for txt in [row_req.sub_function, row_req.function, row_req.module]:
            if not self.__is_placeholder_name(txt):
                return (txt or "").strip()

        # SRS字段全是占位值时，回退到SDS树路径中的标题文本
        candidates = []
        for path in reversed(paths or []):
            name = self.__clean_path_title(path)
            if self.__is_placeholder_name(name):
                continue
            if self.__extract_chapter_code(name) == name:
                continue
            candidates.append(name)
        return candidates[0] if candidates else "/"

    def __fix_location(self, objs:List[SdsTraceObj]):
        doc_dict = dict()
        n_dict = dict()
        p_dict = dict()
        for obj in objs:
            doc_dict.setdefault(obj.doc_id, []).append(obj)

        doc_ids = list(doc_dict.keys())
        sql = select(SdsNode).where(SdsNode.ref_type == "sds_reqds").where(SdsNode.doc_id.in_(doc_ids))
        key_nodes = db.session.execute(sql).scalars().all()
        key_nodes_dict = dict()
        for node in key_nodes:
            key_nodes_dict[node.doc_id] = node.title
        
        for doc_id, objs in doc_dict.items():
            p_title = key_nodes_dict.get(doc_id) or ""
            parents = dict()
            for obj in objs:
                with_chapter = 1 if obj.sub_function else 0
                title = obj.name if obj.sub_function else None
                node = Node(ref_id=obj.id, with_chapter=with_chapter, title=title, children=[])
                p_node = find_parent(SdsNodeForm, [obj.module, obj.function, obj.sub_function], parents)
                p_node.children.append(node)
                p_dict[node.ref_id] = p_node
                n_dict[node.ref_id] = node
            p_nodes = [node for key, node in parents.items() if node.level == 0]
            fix_chapter(p_title, p_nodes)
            for obj in objs:
                if obj.location or obj.type_code == "2":
                    continue
                n_node = n_dict.get(obj.id)
                p_node = p_dict.get(obj.id)
                paths = [n_node.title]
                while p_node:
                    paths.append(p_node.title)
                    p_node = p_dict.get(p_node.ref_id)
                obj.location = self.__find_chapter(paths)
                logger.info("location: %s %s", obj.sds_code, obj.location)

    def __query_doc_tree(self, doc_ids):
        doc_trees = dict()
        if not doc_ids:
            return doc_trees
        
        sql = select(SdsNode).where(SdsNode.doc_id.in_(doc_ids)).order_by(SdsNode.priority)
        nodes: List[SdsNode] = db.session.execute(sql).scalars().all()
        doc_nodes = dict()
        for node in nodes:
            doc_nodes.setdefault(node.doc_id, []).append(node)

        for doc_id, nodes in doc_nodes.items():
            tree = []
            objs_dict = dict()
            objs = []
            for node in nodes:
                obj = SdsNodeForm(children=[], doc_id=node.doc_id, n_id=node.n_id, p_id=node.p_id,
                                title=node.title, label=node.label, img_url=node.img_url, text=node.text, ref_type=node.ref_type, sds_code=node.sds_code)
                objs_dict[obj.n_id] = obj
                objs.append(obj)
            for obj in objs:
                if obj.p_id == 0:
                    tree.append(obj)
                else:
                    p_obj = objs_dict.get(obj.p_id)
                    if not p_obj:
                        logger.warning("ignoreNode:: %s %s %s", obj.doc_id, obj.p_id, obj.n_id)
                        continue
                    p_obj.children.append(obj)
            doc_trees[doc_id] = tree
        return doc_trees

    async def list_sds_trace(self, op_user: UserObj, prod_id: int = None, doc_id: int = None, type_code: str = None, page_index: int = 0, page_size: int = 10, from_sync: bool = False):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
        self.__ensure_sds_traces(prod_id=prod_id, doc_id=doc_id)

        sql = select(SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product)
        sql = sql.outerjoin(SrsType, SrsReq.type_code == SrsType.type_code)
        sql = sql.outerjoin(SrsDoc, SrsReq.doc_id == SrsDoc.id)
        sql = sql.outerjoin(Product, SrsDoc.product_id == Product.id)
        
        sql = sql.where(SdsTrace.doc_id == SdsDoc.id).where(SdsTrace.req_id == SrsReq.id).where(SdsDoc.srsdoc_id == SrsDoc.id)
        sql = sql.where(or_(SrsType.doc_id == SrsReq.doc_id, SrsReq.type_code.in_(["1", "2"])))
        if prod_id:
            sql = sql.where(Product.id == prod_id)
        if doc_id:
            sql = sql.where(SdsDoc.id == doc_id)
        if type_code:
            sql = sql.where(SrsReq.type_code == type_code)
        scope = product_scope_filter(op_user)
        if scope is not None:
            sql = sql.where(scope)

        sql = sql.order_by(desc(Product.id), desc(SdsDoc.id), SrsReq.code)
        rows: List[Tuple[SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product]] = db.session.execute(sql).all()
        # SDS 内列表不读取基本要求、数据库要求、文档需求：这三类需求自身不出行。
        # 判定在 __resort_rows 和分页之前，total 按过滤后的行数算。
        all_srs_doc_ids = list({row_srsdoc.id for _row_reqd, _row_req, _row_type, _row_sdsdoc, row_srsdoc, _row_product in rows if row_srsdoc})
        hierarchy_by_srs_doc = {sid: self.__load_srs_req_hierarchy_map(sid) for sid in all_srs_doc_ids}
        rows = [
            row for row in rows
            if not is_sds_excluded_module(
                self.hierarchy_for_req(
                    row[1], hierarchy_by_srs_doc.get(row[4].id if row[4] else 0) or {},
                ).get("module")
            )
        ]
        rows = self.__resort_rows(rows)
        total = len(rows)
        rows = rows[page_size * page_index: page_size * (page_index + 1)]
        req_ids = [row_req.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows]
        srs_doc_ids = list({row_srsdoc.id for _row_reqd, _row_req, _row_type, _row_sdsdoc, row_srsdoc, _row_product in rows if row_srsdoc})
        living_codes = []
        if srs_doc_ids:
            living_codes = db.session.execute(
                select(SrsReq.code).where(SrsReq.doc_id.in_(srs_doc_ids)).where(SrsReq.type_code != "reqd")
            ).scalars().all()
        type_names = self.__query_srs_types(req_ids)
        doc_ids = list(set([row_sdsdoc.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows]))
        doc_trees = self.__query_doc_tree(doc_ids)
        doc_tail_chapters = {d_id: live_rcn300_tail_chapters(tree) for d_id, tree in doc_trees.items()}
        doc_sds_locations = {d_id: self.__build_sds_location_map(tree) for d_id, tree in doc_trees.items()}
        virtual_sds_locations = {} if from_sync else self.__build_virtual_location_map(rows, doc_trees, doc_sds_locations)
        srs_doc_ids = list(set([row_srsdoc.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows if row_srsdoc]))
        objs = []
        for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            obj = SdsTraceObj(**row_reqd.dict())
            obj.srs_code = row_req.code
            hierarchy_map = hierarchy_by_srs_doc.get(row_srsdoc.id if row_srsdoc else 0) or {}
            req_fields = self.hierarchy_for_req(row_req, hierarchy_map)
            obj.module = req_fields.get("module")
            obj.function = req_fields.get("function")
            obj.sub_function = req_fields.get("sub_function")
            if row_srsdoc:
                obj.srsdoc_version = row_srsdoc.version
            if row_sdsdoc:
                obj.sdsdoc_version = row_sdsdoc.version
            if row_product:
                obj.product_name = row_product.name
                obj.product_version = row_product.full_version
            obj.type_code = row_req.type_code
            obj.type_name = type_names.get(row_req.id) or default_types.get(row_req.type_code) or row_req.type_code
            if str(row_req.type_code) == "2":
                stored_sds_code = str(obj.sds_code or "")
                derived_sds_code = (row_req.code or "").replace("SRS", "SDS").strip()
                # 手改标记以库里为准：update_sds_trace 改动设计编号时置位，
                # 只有「获取SRS追溯」清掉。标记为真就原样使用库里这一条，不再靠值比对推断。
                if bool(getattr(row_reqd, "design_manual", False)):
                    obj.design_manual = True
                    obj.sds_code = stored_sds_code
                    obj.name = obj.chapter
                    objs.append(obj)
                    continue
                role = normalize_other_req_design_role(
                    getattr(row_req, "design_role", ""), getattr(row_req, "module", ""), getattr(row_req, "code", ""),
                )
                role_changed = bool(role and other_req_role_is_changed(row_req.code, row_req.module, role))
                fixed_for_manual = fixed_rcn300_trace_for_code(row_req.code)
                legacy_lines = [item[0] for item in (fixed_for_manual or [])]
                cross_map = other_req_fixed_trace_is_cross_map(row_req.code, fixed_for_manual)
                if cross_map and other_req_stored_follows_cross_map(stored_sds_code, row_req.code, fixed_for_manual):
                    manual = False
                elif role_changed or cross_map or fixed_for_manual is None:
                    manual = other_req_keeps_design_code(stored_sds_code, row_req.module, [derived_sds_code], legacy_lines)
                else:
                    kept_for_manual = filter_fixed_trace_to_living(fixed_for_manual, living_codes) or []
                    manual = other_req_keeps_design_code(
                        stored_sds_code,
                        row_req.module,
                        [item[0] for item in kept_for_manual],
                        legacy_lines,
                    )
                if manual:
                    obj.design_manual = True
                    obj.sds_code = stored_sds_code
                    obj.name = obj.chapter
                    objs.append(obj)
                    continue
                if role_changed:
                    display = other_req_role_display_name(row_req.module, role)
                    tree = doc_trees.get(row_sdsdoc.id) if row_sdsdoc else None
                    obj.sds_code = derived_sds_code
                    obj.chapter = display
                    obj.name = display
                    obj.location = live_heading_for_exact_title(tree, display) if tree is not None else ""
                    objs.append(obj)
                    continue
                current_module = str(row_req.module or "").strip()
                preset_module = ""
                tail_matched = re.search(r"300-(\d+)$", re.sub(r"\s+", "", str(row_req.code or "")).upper())
                if tail_matched:
                    tail = f"{int(tail_matched.group(1)):03d}"
                    for spec in OTHER_REQ_DESIGN_ROLES.values():
                        if spec["tail"] == tail:
                            preset_module = spec["preset_module"]
                            break
                if preset_module and current_module and current_module != preset_module:
                    tree = doc_trees.get(row_sdsdoc.id) if row_sdsdoc else None
                    obj.sds_code = (row_req.code or "").replace("SRS", "SDS").strip()
                    obj.chapter = current_module
                    obj.name = current_module
                    obj.location = live_heading_for_exact_title(tree, current_module)
                    objs.append(obj)
                    continue
                if cross_map:
                    tree = doc_trees.get(row_sdsdoc.id) if row_sdsdoc else None
                    display = other_req_role_display_name(row_req.module, role) if role else current_module
                    obj.sds_code = derived_sds_code
                    obj.chapter = display
                    obj.name = display
                    obj.location = live_heading_for_exact_title(tree, display) if tree is not None else ""
                    objs.append(obj)
                    continue
            fixed_full = fixed_rcn300_trace_for_code(row_req.code)
            fixed_trace = filter_fixed_trace_to_living(fixed_full, living_codes) if fixed_full is not None else None
            if fixed_full is not None:
                obj.sds_code = "\n".join(item[0] for item in (fixed_trace or []))
                obj.chapter = "\n".join(item[1] for item in (fixed_trace or []))
                tree = doc_trees.get(row_sdsdoc.id) if row_sdsdoc else None
                if tree is not None:
                    live_tail = doc_tail_chapters.get(row_sdsdoc.id) or {}
                    names = [item[1] for item in fixed_trace]
                    locations = [item[2] for item in fixed_trace]
                    adjusted = []
                    for name, loc in zip(names, locations):
                        key = rcn300_tail_name_key(name)
                        adjusted.append(live_tail.get(key, "") if key else loc)
                    obj.location = "\n".join(adjusted)
                obj.name = obj.chapter
                objs.append(obj)
                continue
            derived_sds_code = (row_req.code or "").replace("SRS", "SDS").strip()
            stored_sds_code = str(obj.sds_code or "")
            if derived_sds_code and "\n" not in stored_sds_code and "," not in stored_sds_code and "，" not in stored_sds_code:
                obj.sds_code = derived_sds_code
            req_chapter = self.resolve_trace_chapter(
                row_reqd.chapter, row_req, srs_code=row_req.code, hierarchy_map=hierarchy_map, **req_fields
            )
            req_name = req_chapter or self.compose_srs_req_chapter(row_req, hierarchy_map=hierarchy_map, **req_fields) or "/"
            if from_sync:
                obj.name = req_name
                obj.chapter = req_chapter
                obj.location = (row_reqd.location or "").strip()
                objs.append(obj)
                continue
            sds_location = self.__resolve_sds_locations(row_reqd, row_sdsdoc.id, doc_sds_locations, virtual_sds_locations)
            if (row_req.code or "").strip().upper() in FIXED_RCN300_TRACES:
                obj.chapter = req_chapter
                obj.location = sds_location
                objs.append(obj)
                continue
            doc_tree = doc_trees.get(row_sdsdoc.id)
            # 未导入详细设计：从SRS需求结构字段回退，避免结果被过滤为空
            if not doc_tree:
                obj.name = req_name
                obj.chapter = req_chapter or req_name
                obj.location = sds_location
                objs.append(obj)
                continue
            # 严格按详细设计树节点读取章节号：优先 sds_code 命中；无编码时仅做标题精确匹配
            paths, _ = self.__find_path(0, row_reqd.sds_code, doc_tree, [])
            if not paths:
                exact_names = self.__build_match_names(
                    req_fields.get("sub_function"), req_fields.get("function"), req_fields.get("module")
                )
                for name in exact_names:
                    paths, _ = self.__find_path_by_names(0, [name], doc_tree, [], exact_only=True)
                    if paths:
                        break
            # 严格匹配失败时，回退到模糊匹配，兼容“安装包” vs “制作安装包”等命名差异
            if not paths:
                fuzzy_names = self.__build_match_names(
                    req_fields.get("sub_function"), req_fields.get("function"), req_fields.get("module")
                )
                for name in fuzzy_names:
                    paths, _ = self.__find_path_by_names(0, [name], doc_tree, [], exact_only=False)
                    if paths:
                        break
            # 详细设计树中未命中路径时，仍按SRS基础信息展示，便于后续在追溯页手工编辑
            if not paths:
                obj.name = req_name
                obj.chapter = req_chapter or req_name
                obj.location = sds_location
                objs.append(obj)
                continue
            obj.name = self.__pick_req_display_name(row_req, paths)
            # 业务强约束：图像相关条目优先按给定映射命中对应模块章节，避免误配到相邻章节
            module_alias = NAME_DICT.get(obj.name or "")
            if module_alias:
                alias_names = self.__build_match_names(module_alias)
                for name in alias_names:
                    mapped_paths, _ = self.__find_path_by_names(0, [name], doc_tree, [], exact_only=True)
                    if mapped_paths:
                        paths = mapped_paths
                        break
            obj.chapter = req_chapter or self.compose_srs_req_chapter(row_req, hierarchy_map=hierarchy_map, **req_fields) or obj.name
            if sds_location:
                obj.location = sds_location
            elif not self.__is_empty_location(getattr(row_reqd, "location", "") or ""):
                obj.location = str(row_reqd.location or "").strip()
            elif doc_tree:
                obj.location = self.__resolve_sds_tree_location(
                    row_reqd.sds_code or "",
                    row_req,
                    doc_tree,
                    doc_sds_locations.get(row_sdsdoc.id) or {},
                )
            objs.append(obj)
        objs = self.__sort_objs_by_srs_manage_order(objs)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        
    async def get_sds_trace(self, id: int):
        sql = select(SdsTrace, SrsReq).join(SrsReq, SrsReq.id == SdsTrace.req_id).where(SdsTrace.id == id)
        row: Tuple[SdsTrace, SrsReq] = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        row_reqd, row_req = row
        srs_doc_id = db.session.execute(
            select(SdsDoc.srsdoc_id).join(SdsTrace, SdsTrace.doc_id == SdsDoc.id).where(SdsTrace.id == id)
        ).scalar()
        hierarchy_map = self.__load_srs_req_hierarchy_map(srs_doc_id)
        req_fields = self.hierarchy_for_req(row_req, hierarchy_map)
        name = self.compose_srs_req_chapter(row_req, hierarchy_map=hierarchy_map, **req_fields) or row_req.sub_function or row_req.function or row_req.module
        obj = SdsTraceObj(**row_reqd.dict(), srs_code=row_req.code, name=name)
        obj.chapter = self.resolve_trace_chapter(
            row_reqd.chapter, row_req, hierarchy_map=hierarchy_map, **req_fields
        ) or name
        return Resp.resp_ok(data=obj)
    