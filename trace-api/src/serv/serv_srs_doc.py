import logging
import base64
import io
import json
import os
import re
import sys
from datetime import datetime
from enum import Enum
from typing import Dict, List, Tuple
from sqlalchemy import select, delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import desc
try:
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.table import Table as DocxTable
    from docx.text.paragraph import Paragraph
    from docx.shared import Pt
    from docx import enum as dox_enum
    from docx.oxml.ns import qn
    from docx.shared import RGBColor
except Exception:
    Document = None
    OxmlElement = None
    DocxTable = None
    Paragraph = None
    Pt = None
    dox_enum = None
    qn = None
    RGBColor = None
from openpyxl import load_workbook
from openpyxl.styles import Alignment
from ..obj.vobj_user import UserObj
from ..model.srs_type import SrsType
from ..model.sds_trace import SdsTrace
from ..obj.vobj_srs_reqd import SrsReqdObj
from ..model.doc_file import DocFile
from ..model.sds_doc import SdsDoc, SdsNode
from ..model.sds_reqd import SdsReqd, Logic
from ..model.test_set import TestSet
from ..model.test_case import TestCase
from ..model.rcm import Rcm
from ..obj.tobj_srs_doc import Table, TabHeader, TableCell
from ..model.product import Product, UserProd
from ..model.srs_req import ReqRcm, SrsReq
from ..model.srs_reqd import SrsReqd
from ..obj.vobj_srs_doc import SrsDocObj
from ..obj.vobj_sds_doc import CompareObj
from ..model.srs_doc import SrsDoc, SrsNode
from ..obj.tobj_srs_doc import SrsDocForm, SrsNodeForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from .serv_srs_req import Server as ServSrsReq
from .serv_srs_reqd import Server as ServSrsReqd
from .serv_sds_trace import NAME_DICT
from .serv_utils import new_version
from .serv_utils.tree_util import find_parent, iter_tree
from . import msg_err_db, save_file

logger = logging.getLogger(__name__)
srsreq_serv = ServSrsReq()
srsreqd_serv = ServSrsReqd()
DELETED_SRS_VERSION_PREFIX = "__deleted_srs__"

DEF_SRS = [
    ("SRS-XUS00-001", "数据库要求"),
    ("SRS-XUS00-002", "性能要求"),
    ("SRS-XUS00-003", "基本要求"),
    ("SRS-XUS00-004", "图像接收"),
    ("SRS-XUS00-005", "图像存储"),
    ("SRS-XUS00-006", "图像预测"),
    ("SRS-XUS00-007", "图像显示"),
    ("SRS-XUS00-008", "文档需求"),
    ("SRS-XUS00-009", "法规符合需求"),
    ("SRS-XUS00-010", "外部连接"),
]

class RefTypes(Enum):
    img_struct = "img_struct"
    img_flow = "img_flow"
    img_topo = "img_topo"
    srs_reqs = "srs_reqs"
    srs_reqs_1 = "srs_reqs_1"
    srs_reqs_2 = "srs_reqs_2"
    srs_reqs_x = "srs_reqs_x"
    srs_reqds = "srs_reqds"

class Server(object):
    DOC_IMG_KEYWORDS = {
        "img_topo": ["物理拓扑图", "拓扑图"],
        "img_struct": ["系统结构图", "结构图"],
        "img_flow": ["网络安全流程图", "安全流程图", "流程图"],
    }
    TRACE_FIXED_NOTE_CODE = "SRS-RCN300-009"
    TRACE_FIXED_NOTE_PRODUCT_CODE_FALLBACK = "RCN3V2000"

    @classmethod
    def __build_trace_fixed_note_text(cls, product_code: str):
        code = str(product_code or "").strip() or cls.TRACE_FIXED_NOTE_PRODUCT_CODE_FALLBACK
        return (
            f"TX-TF-{code}-RD-009-A0 IEC62304《医疗器械软件 软件生存周期过程》符合性核查表"
            "、TX-TF-SD-001-A0 《DICOM一致性声明》"
            f"、TX-TF-{code}-RD-014-A0 《网络安全漏洞自评报告》"
        )

    @staticmethod
    def __extract_data_url_blob(data_url: str):
        if not data_url or not str(data_url).startswith("data:"):
            return None, None
        matched = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url, re.S)
        if not matched:
            return None, None
        mime = matched.group(1).lower()
        b64 = matched.group(2)
        ext_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/gif": ".gif",
            "image/bmp": ".bmp",
            "image/webp": ".webp",
        }
        ext = ext_map.get(mime, ".png")
        try:
            blob = base64.b64decode(b64)
        except Exception:
            return None, None
        return blob, ext

    def __pick_doc_images_from_tree(self, nodes: List[SrsNodeForm]):
        picked = {}

        def walk(items: List[SrsNodeForm], ctx_titles: List[str]):
            for node in items or []:
                title = self.__normalize_text(getattr(node, "title", "") or "")
                next_ctx = [*ctx_titles]
                if title:
                    next_ctx.append(title)
                img_url = getattr(node, "img_url", None)
                if img_url and str(img_url).startswith("data:"):
                    ctx_text = " ".join(next_ctx)
                    for category, keywords in self.DOC_IMG_KEYWORDS.items():
                        if any(k in ctx_text for k in keywords):
                            # 后出现的图覆盖前面的图，确保取到章节里的最终图
                            picked[category] = img_url
                walk(getattr(node, "children", None) or [], next_ctx)

        walk(nodes or [], [])
        return picked

    def __upsert_product_doc_image(self, product_id: int, category: str, data_url: str):
        blob, ext = self.__extract_data_url_blob(data_url)
        if not blob:
            return
        sql = select(DocFile).where(DocFile.product_id == product_id, DocFile.category == category).order_by(desc(DocFile.id))
        row = db.session.execute(sql).scalars().first()
        if not row:
            row = DocFile(product_id=product_id, category=category)
            db.session.add(row)
            db.session.flush()
        path = os.path.join("data.trace", category, f"{row.id}{ext}")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fs:
            fs.write(blob)
        row.file_name = f"{category}{ext}"
        row.file_size = len(blob)
        row.file_url = path
        db.session.commit()

    def __auto_sync_product_doc_images(self, product_id: int, nodes: List[SrsNodeForm]):
        picked = self.__pick_doc_images_from_tree(nodes)
        for category, data_url in picked.items():
            self.__upsert_product_doc_image(product_id, category, data_url)

    @staticmethod
    def __guess_numpr_level(para):
        """读取 Word 自动编号层级（numPr/ilvl 或 outlineLvl）。"""
        def _level_from_ppr(p_pr):
            if p_pr is None:
                return None
            try:
                num_pr = getattr(p_pr, "numPr", None)
                ilvl = getattr(num_pr, "ilvl", None) if num_pr is not None else None
                val = getattr(ilvl, "val", None) if ilvl is not None else None
                if val is not None:
                    return max(1, min(int(str(val)) + 1, 5))
            except Exception:
                pass
            try:
                outline = getattr(p_pr, "outlineLvl", None)
                oval = getattr(outline, "val", None) if outline is not None else None
                if oval is not None:
                    return max(1, min(int(str(oval)) + 1, 5))
            except Exception:
                pass
            return None

        try:
            p_pr = getattr(getattr(para, "_element", None), "pPr", None)
            level = _level_from_ppr(p_pr)
            if level is not None:
                return level
            style = getattr(para, "style", None)
            hops = 0
            while style is not None and hops < 8:
                style_ppr = getattr(getattr(style, "_element", None), "pPr", None)
                level = _level_from_ppr(style_ppr)
                if level is not None:
                    return level
                style = getattr(style, "base_style", None)
                hops += 1
        except Exception:
            pass
        return None

    @staticmethod
    def __is_bold_paragraph(para):
        # 优先按 run 判断；若 run 未显式设置，再回退到样式链 bold。
        if any(run.bold for run in para.runs if (run.text or "").strip()):
            return True
        try:
            style = getattr(para, "style", None)
            hops = 0
            while style is not None and hops < 8:
                font = getattr(style, "font", None)
                if getattr(font, "bold", None) is True:
                    return True
                style = getattr(style, "base_style", None)
                hops += 1
        except Exception:
            pass
        return False

    @staticmethod
    def __guess_heading_level(para):
        txt = (para.text or "").strip()
        if not txt:
            return None
        is_bold = Server.__is_bold_paragraph(para)
        # JSON 键值行（如 "version":4,）按正文处理，不能当作章节标题
        if re.match(r'^\s*[\'"]\s*[^\'"]+\s*[\'"]\s*:\s*.+$', txt):
            return None
        # 带章节号前缀的 JSON 行（如 5.7.1.1 "version":4,）也按正文处理
        txt_wo_chapter = re.sub(r'^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z"\']))', '', txt).strip()
        if txt_wo_chapter and re.match(r'^\s*[\'"]\s*[^\'"]+\s*[\'"]\s*:\s*.+$', txt_wo_chapter):
            return None
        # 放宽：只要标题文本带明确章节号（如 5.7.1 / 5.6.1），即使未加粗也按章节识别。
        # 但排除“1.参数文件;”这类枚举项（单数字+点号+句末标点）。
        numbering = re.match(r"^(\d+(?:\.\d+){0,4})([\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))(.*)$", txt)
        if numbering:
            chapter_no = numbering.group(1) or ""
            sep = numbering.group(2) or ""
            tail = (numbering.group(3) or "").strip()
            if not tail:
                return None
            # 只有单一数字编号时（如 "1 xxx"），要求使用空白分隔；"1.xxx" 视为枚举项。
            if chapter_no.count(".") == 0 and not re.search(r"\s", sep):
                return None
            # 单级编号（如 "7 xxx"）时，进一步过滤“句子型正文项”，避免误识别为一级标题。
            # 例如：7 默认的科室不允许删除，删除时，系统提示：...
            if chapter_no.count(".") == 0:
                if len(tail) > 40:
                    return None
                if re.search(r"[，,。；;：:！？!?]", tail):
                    return None
            # 句末为分号/冒号/句号等更像正文项，不识别为标题。
            if re.search(r"[;；:：,，。！？!?]$", tail):
                return None
            # 非粗体的两级编号（如 7.1 xxx）误识别概率高，增加约束：
            # 仅当尾部很短且无正文标点时才作为标题。
            if (not is_bold) and chapter_no.count(".") == 1:
                if len(tail) > 24:
                    return None
                if re.search(r"[，,。；;：:！？!?]", tail):
                    return None
            return max(1, min(chapter_no.count(".") + 1, 5))
        # 无明确章节号时，仍保持“粗体优先”约束，降低正文误判为标题
        if not is_bold:
            return None
        # 文本无显式编号但为粗体标题时，尝试读取 Word 编号层级（numPr/outlineLvl）
        numpr_level = Server.__guess_numpr_level(para)
        if numpr_level is not None:
            # 编号列表中的句子型文本（常见于正文要点）不应识别为章节标题
            if len(txt) > 24:
                return None
            if re.search(r"[，,。；;：:！？!?]", txt):
                return None
        return numpr_level

    @staticmethod
    def __normalize_text(value):
        return (value or "").replace("\xa0", " ").strip()

    @staticmethod
    def __normalize_rcm_code(code: str):
        txt = (code or "").strip().upper()
        txt = re.sub(r"[，。；;、,.]+$", "", txt)
        return txt

    @staticmethod
    def __normalize_srs_code(code: str):
        txt = (code or "").strip().upper()
        # 兼容“ SRS- RCN306-003 ”这类带空格/不可见字符的编号
        txt = re.sub(r"\s+", "", txt)
        txt = re.sub(r"[，。；;、,.]+$", "", txt)
        return txt

    def __clean_req_title(self, txt: str):
        value = self.__normalize_text(txt or "")
        value = re.sub(r"^\s*\d+(?:\.\d+)*[\s、.．:：\-]*", "", value).strip()
        value = re.sub(r"\bSRS[-_\sA-Za-z0-9.]+\b", "", value, flags=re.I).strip()
        return value

    def __normalize_rcm_codes(self, codes):
        result = []
        for code in codes or []:
            c = self.__normalize_rcm_code(code)
            if c and c not in result:
                result.append(c)
        return result

    @staticmethod
    def __normalize_header(value: str):
        return re.sub(r"[\s_:/（）()]+", "", (value or "").lower())

    @staticmethod
    def __extract_heading_number(title: str):
        matched = re.match(r"^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))", (title or "").strip())
        return matched.group(1) if matched else None

    def __validate_heading_numbers(self, heading_rows: List[dict]):
        rows = [row for row in heading_rows if row.get("level") in [1, 2, 3, 4, 5]]
        if not rows:
            return None
        level1_rows = [r for r in rows if r.get("level") == 1]
        if not level1_rows:
            return None

        # 按业务约定：目录/修订记录等前置章节不校验，从一级标题“介绍”开始校验。
        intro_idx = next(
            (
                idx
                for idx, row in enumerate(level1_rows)
                if "介绍" in self.__normalize_text(row.get("title") or "")
            ),
            None,
        )
        if intro_idx is not None:
            level1_rows = level1_rows[intro_idx:]
            if not level1_rows:
                return None

        level1_nums = [r for r in level1_rows if r.get("number")]
        if not level1_nums:
            return "Word导入校验失败：未识别到带编号的一级标题，请检查Word标题样式与编号。"

        # 放宽规则：从“介绍”开始，仅校验“有编号”的一级标题；未编号一级标题跳过。

        valid_level1_numbers = {self.__normalize_text(r.get("number") or "") for r in level1_rows if r.get("number")}
        if intro_idx is not None:
            rows = [
                r
                for r in rows
                if int(r.get("level") or 1) != 1
                or self.__normalize_text(r.get("number") or "") in valid_level1_numbers
            ]

        # Validate numbering continuity under each level/parent path.
        parent_last: Dict[Tuple[int, str], int] = {}
        for ridx, row in enumerate(rows, start=1):
            level = int(row.get("level") or 1)
            num = row.get("number") or ""
            if not num:
                continue
            parts = num.split(".")
            if len(parts) < level:
                # 放宽校验：当样式层级与编号层级不一致时，以编号层级为准继续解析，不阻断导入。
                level = len(parts)
            if level <= 0:
                continue
            try:
                cur = int(parts[level - 1])
            except Exception:
                if level == 1:
                    return f"Word导入校验失败：第{ridx}个一级标题编号格式错误（{row.get('title')}）"
                return f"Word导入校验失败：标题编号格式错误（{row.get('title')}）"

            parent_key = ".".join(parts[: level - 1]) if level > 1 else "_root_"
            key = (level, parent_key)
            last = parent_last.get(key, 0)
            expected = last + 1
            if cur != expected:
                level_text = "一级" if level == 1 else f"{level}级"
                return (
                    "Word导入校验失败："
                    f"{level_text}标题编号应为 {expected}，实际为 {cur}（{row.get('title')}）"
                )
            parent_last[key] = cur
        return None

    def __extract_file_info(self, file_name: str):
        base_name = os.path.splitext(os.path.basename(file_name or ""))[0]
        if not base_name:
            return None, None
        # 常见命名：TX-TF-RCN3V2000-PD-003-A0需求规格说明.docx
        # 规则：
        # - 文件名称（folder_name）优先取中文标题部分（如“需求规格说明”）
        # - 文件编号（file_no）优先取中文标题前的编码串
        title_cn = "".join(re.findall(r"[\u4e00-\u9fff]+", base_name)).strip()
        prefix = re.split(r"[\u4e00-\u9fff]+", base_name, maxsplit=1)[0].strip(" _-")
        name_for_parse = prefix or base_name
        tokens = [tok for tok in re.split(r"[_\-\s]+", name_for_parse) if tok]
        if not tokens and not title_cn:
            return None, None

        folder_name = title_cn or (tokens[0] if tokens else None)
        file_no = name_for_parse if name_for_parse else None
        if not file_no:
            for token in tokens:
                if re.match(r"^[A-Za-z]{1,6}\d{2,}$", token) or re.match(r"^[A-Za-z0-9]+-\d+$", token):
                    file_no = token
                    break
            if not file_no and len(tokens) > 1:
                file_no = tokens[1]
        return folder_name, file_no or folder_name

    def __is_product_req_context(self, context_text: str):
        normalized = self.__normalize_header(context_text or "")
        keywords = [
            "产品需求表",
            "产品需求",
            "需求列表",
            "software requirement",
            "product requirement",
            "srs",
        ]
        return any(self.__normalize_header(word) in normalized for word in keywords)

    def __resolve_req_columns(self, headers_norm: List[str]):
        col_idx: Dict[str, int] = {}
        for idx, h in enumerate(headers_norm):
            if ("需求编号" in h or "srscode" in h or h == "code") and "code" not in col_idx:
                col_idx["code"] = idx
            if ("模块" in h or h == "module") and "module" not in col_idx:
                col_idx["module"] = idx
            if ("子功能" in h or "subfunction" in h) and "sub_function" not in col_idx:
                col_idx["sub_function"] = idx
            if ("功能" in h or h == "function") and "function" not in col_idx:
                col_idx["function"] = idx
            if ("章节" in h or "位置" in h or "location" in h) and "location" not in col_idx:
                col_idx["location"] = idx
            if ("rcm" in h or "风险控制" in h) and "rcm" not in col_idx:
                col_idx["rcm"] = idx
        return col_idx

    def __extract_srs_reqs_from_tables(self, docx: Document):
        req_rows = []
        req_rcm_map: Dict[str, set] = {}
        code_pattern = re.compile(r"^SRS[-_A-Za-z0-9.]+$", re.I)
        rcm_pattern = re.compile(r"\bRCM[-_A-Za-z0-9]+\b", re.I)
        current_context = ""
        for child in docx.element.body.iterchildren():
            tag = str(child.tag).lower()
            if tag.endswith("}p"):
                para = Paragraph(child, docx._body)
                txt = self.__normalize_text(para.text)
                if txt:
                    current_context = txt
                continue
            if not tag.endswith("}tbl"):
                continue
            tab = DocxTable(child, docx._body)
            if not tab.rows:
                continue
            headers = [self.__normalize_text(cell.text) for cell in tab.rows[0].cells]
            headers_norm = [self.__normalize_header(item) for item in headers]
            if not headers_norm:
                continue

            col_idx = self.__resolve_req_columns(headers_norm)
            if "code" not in col_idx:
                continue
            # 强规则：需满足“上下文命中产品需求”或“表头至少含编号+模块+功能”。
            has_core_cols = ("module" in col_idx and "function" in col_idx)
            if not (self.__is_product_req_context(current_context) or has_core_cols):
                continue

            # 需求分类：
            # - 产品需求：需求编号/模块/功能(/子功能)
            # - 其他需求：需求编号/模块/对应章节（无功能与子功能）
            has_location_col = "location" in col_idx
            has_function_col = "function" in col_idx
            has_sub_function_col = "sub_function" in col_idx
            type_code = "2" if has_location_col and not has_function_col and not has_sub_function_col else "1"
            for row in tab.rows[1:]:
                values = [self.__normalize_text(cell.text) for cell in row.cells]
                code = values[col_idx["code"]] if col_idx["code"] < len(values) else ""
                code = self.__normalize_srs_code(code)
                if not code_pattern.match(code or ""):
                    continue
                code_upper = code.upper()
                req_rows.append(
                    dict(
                        code=code_upper,
                        type_code=type_code,
                        module=(values[col_idx["module"]] if "module" in col_idx and col_idx["module"] < len(values) else None),
                        function=(values[col_idx["function"]] if "function" in col_idx and col_idx["function"] < len(values) else None),
                        sub_function=(values[col_idx["sub_function"]] if "sub_function" in col_idx and col_idx["sub_function"] < len(values) else None),
                        location=(values[col_idx["location"]] if "location" in col_idx and col_idx["location"] < len(values) else None),
                    )
                )
                if "rcm" in col_idx and col_idx["rcm"] < len(values):
                    rcm_codes = {self.__normalize_rcm_code(item) for item in rcm_pattern.findall(values[col_idx["rcm"]] or "")}
                    rcm_codes = {code for code in rcm_codes if code}
                    if rcm_codes:
                        req_rcm_map.setdefault(code_upper, set()).update(rcm_codes)
        return req_rows, req_rcm_map

    def __extract_srs_reqs_from_nodes(self, nodes: List[SrsNodeForm]):
        req_rows = []
        req_rcm_map: Dict[str, set] = {}
        # 放宽编号格式，兼容 SRS-XXX / CNXXX / 其他编码串
        code_pattern = re.compile(r"^[A-Z]{2,}(?:[-_][A-Z0-9.]+)+$", re.I)
        rcm_pattern = re.compile(r"\bRCM[-_A-Za-z0-9]+\b", re.I)
        seen = set()
        heading_no_re = re.compile(r"^\s*\d+(?:\.\d+)*[\s、.．:：\-]*")

        def clean_title(txt: str):
            return self.__clean_req_title(txt)

        def walk(items: List[SrsNodeForm], parent_titles: List[str] = None):
            parent_titles = parent_titles or []
            for node in items or []:
                table = getattr(node, "table", None)
                headers = getattr(table, "headers", None) if table else None
                rows = getattr(table, "rows", None) if table else None
                if headers and rows:
                    header_names = [self.__normalize_text(getattr(h, "name", "") or "") for h in headers]
                    header_norm = [self.__normalize_header(h) for h in header_names]
                    col_idx = self.__resolve_req_columns(header_norm)
                    has_product_cols = ("code" in col_idx and "module" in col_idx and "function" in col_idx)
                    has_other_cols = ("code" in col_idx and "module" in col_idx and "location" in col_idx)
                    if has_product_cols or has_other_cols:
                        type_code = "2" if has_other_cols and "function" not in col_idx and "sub_function" not in col_idx else "1"
                        col_codes = [getattr(h, "code", "") for h in headers]
                        for row in rows or []:
                            values = [self.__normalize_text(str((row or {}).get(code, "") or "")) for code in col_codes]
                            code = values[col_idx["code"]] if col_idx["code"] < len(values) else ""
                            code = self.__normalize_srs_code(code)
                            if not code_pattern.match(code or ""):
                                continue
                            code_upper = code.upper()
                            key = (type_code, code_upper)
                            if key in seen:
                                continue
                            seen.add(key)
                            req_rows.append(
                                dict(
                                    code=code_upper,
                                    type_code=type_code,
                                    module=(values[col_idx["module"]] if "module" in col_idx and col_idx["module"] < len(values) else None),
                                    function=(values[col_idx["function"]] if "function" in col_idx and col_idx["function"] < len(values) else None),
                                    sub_function=(values[col_idx["sub_function"]] if "sub_function" in col_idx and col_idx["sub_function"] < len(values) else None),
                                    location=(values[col_idx["location"]] if "location" in col_idx and col_idx["location"] < len(values) else None),
                                )
                            )
                            if "rcm" in col_idx and col_idx["rcm"] < len(values):
                                rcm_codes = {self.__normalize_rcm_code(item) for item in rcm_pattern.findall(values[col_idx["rcm"]] or "")}
                                rcm_codes = {code for code in rcm_codes if code}
                                if rcm_codes:
                                    req_rcm_map.setdefault(code_upper, set()).update(rcm_codes)
                # 兜底：从章节节点上的 srs_code 直接生成需求，避免因表格格式变化导致 SRS 管理为空
                node_srs_code = self.__normalize_srs_code(str(getattr(node, "srs_code", "") or ""))
                if node_srs_code and code_pattern.match(node_srs_code):
                    key = ("1", node_srs_code.upper())
                    if key not in seen:
                        seen.add(key)
                        title_txt = clean_title(getattr(node, "title", "") or "")
                        parent_txt = clean_title(parent_titles[-1] if parent_titles else "")
                        req_rows.append(
                            dict(
                                code=node_srs_code.upper(),
                                type_code="1",
                                module=parent_txt or None,
                                function=title_txt or None,
                                sub_function=None,
                                location=None,
                            )
                        )

                next_parents = parent_titles + [getattr(node, "title", "") or ""]
                walk(getattr(node, "children", None) or [], next_parents)

        walk(nodes or [], [])
        return req_rows, req_rcm_map

    def __map_reqd_field(self, label: str):
        norm = self.__normalize_header(label or "")
        if not norm:
            return None
        if "需求编号" in norm or norm in ["srscode", "code"]:
            return "code"
        if "需求名称" in norm or norm == "name":
            return "name"
        if "需求概述" in norm or "概述" in norm or norm == "overview":
            return "overview"
        if "主参加者" in norm or "参与人" in norm or norm in ["participant"]:
            return "participant"
        if "前置条件" in norm or norm in ["precondition", "pre_condition"]:
            return "pre_condition"
        if "触发器" in norm or "触发条件" in norm or norm in ["trigger"]:
            return "trigger"
        if "工作流" in norm or "工作流程" in norm or norm in ["workflow", "work_flow"]:
            return "work_flow"
        if "后置条件" in norm or norm in ["postcondition", "post_condition"]:
            return "post_condition"
        if "异常情况" in norm or "异常" in norm or norm in ["exception"]:
            return "exception"
        if "约束" in norm or "限制" in norm or norm in ["constraint"]:
            return "constraint"
        return None

    def __extract_srs_reqds_from_nodes(self, nodes: List[SrsNodeForm]):
        code_pattern = re.compile(r"^SRS[-_A-Za-z0-9.]+$", re.I)
        reqd_dict: Dict[str, dict] = {}

        def merge_row(code: str, data: dict):
            code_up = (code or "").strip().upper()
            if not code_up:
                return
            item = reqd_dict.setdefault(code_up, {"code": code_up})
            for key in ["name", "overview", "participant", "pre_condition", "trigger", "work_flow", "post_condition", "exception", "constraint"]:
                val = (data.get(key) or "").strip()
                if val and not item.get(key):
                    item[key] = val

        def walk(items: List[SrsNodeForm]):
            for node in items or []:
                node_code = self.__normalize_srs_code(str(getattr(node, "srs_code", "") or ""))
                node_text = self.__normalize_text(str(getattr(node, "text", "") or ""))
                if node_code and code_pattern.match(node_code) and node_text:
                    merge_row(node_code, {
                        "name": self.__normalize_text(str(getattr(node, "title", "") or "")),
                        "overview": node_text,
                    })

                table = getattr(node, "table", None)
                headers = getattr(table, "headers", None) if table else None
                rows = getattr(table, "rows", None) if table else None
                if headers and rows and len(headers) >= 2:
                    col_codes = [getattr(h, "code", "") for h in headers]
                    pairs = []
                    # 两列表格常把“需求编号|SRS-XXX”解析为表头，先作为首行键值对处理
                    h_left = self.__normalize_text(getattr(headers[0], "name", "") or "")
                    h_right = self.__normalize_text(getattr(headers[1], "name", "") or "")
                    if h_left or h_right:
                        pairs.append((h_left, h_right))
                    for row in rows or []:
                        left = self.__normalize_text(str((row or {}).get(col_codes[0], "") or ""))
                        right = self.__normalize_text(str((row or {}).get(col_codes[1], "") or ""))
                        if left or right:
                            pairs.append((left, right))

                    payload = {}
                    req_code = ""
                    for left, right in pairs:
                        field_key = self.__map_reqd_field(left)
                        if not field_key:
                            continue
                        if field_key == "code":
                            req_code = self.__normalize_srs_code(right or "")
                        else:
                            payload[field_key] = right
                    if not req_code and getattr(node, "srs_code", None):
                        req_code = self.__normalize_srs_code(str(getattr(node, "srs_code") or ""))
                    if req_code and code_pattern.match(req_code):
                        merge_row(req_code, payload)

                walk(getattr(node, "children", None) or [])

        walk(nodes or [])
        return list(reqd_dict.values())

    def __upsert_imported_srs_reqds(self, doc_id: int, reqd_rows: List[dict]):
        if not reqd_rows:
            return
        req_codes = [self.__normalize_srs_code(str((item or {}).get("code") or "")) for item in reqd_rows]
        req_codes = [code for code in req_codes if code]
        if not req_codes:
            return
        reqs = db.session.execute(
            select(SrsReq).where(SrsReq.doc_id == doc_id, SrsReq.type_code != "2", SrsReq.code.in_(req_codes))
        ).scalars().all()
        req_map = {row.code: row for row in reqs}
        if not req_map:
            return
        req_ids = [row.id for row in reqs]
        reqd_exists = db.session.execute(select(SrsReqd).where(SrsReqd.req_id.in_(req_ids))).scalars().all()
        reqd_map = {row.req_id: row for row in reqd_exists}

        for item in reqd_rows:
            code = self.__normalize_srs_code(str((item or {}).get("code") or ""))
            req_row = req_map.get(code)
            if not req_row:
                continue
            reqd_row = reqd_map.get(req_row.id)
            if not reqd_row:
                reqd_row = SrsReqd(req_id=req_row.id)
                db.session.add(reqd_row)
                reqd_map[req_row.id] = reqd_row
            for key in ["name", "overview", "participant", "pre_condition", "trigger", "work_flow", "post_condition", "exception", "constraint"]:
                val = str((item or {}).get(key) or "").strip()
                if val:
                    setattr(reqd_row, key, val)
        db.session.commit()

    def __sync_srs_req_names_from_doc_nodes(self, doc_id: int, nodes: List[SrsNodeForm]):
        sync_map: Dict[str, dict] = {}

        def extract_req_code_from_table(table):
            headers = getattr(table, "headers", None) if table else None
            rows = getattr(table, "rows", None) if table else None
            if not headers or not rows or len(headers) < 2:
                return ""
            col_codes = [getattr(h, "code", "") for h in headers]
            pairs = []
            h_left = self.__normalize_text(getattr(headers[0], "name", "") or "")
            h_right = self.__normalize_text(getattr(headers[1], "name", "") or "")
            if h_left or h_right:
                pairs.append((h_left, h_right))
            for row in rows or []:
                left = self.__normalize_text(str((row or {}).get(col_codes[0], "") or ""))
                right = self.__normalize_text(str((row or {}).get(col_codes[1], "") or ""))
                if left or right:
                    pairs.append((left, right))
            for left, right in pairs:
                if self.__map_reqd_field(left) == "code":
                    return self.__normalize_srs_code(right or "")
            return ""

        def put_entry(code: str, titles: List[str]):
            code = self.__normalize_srs_code(code or "")
            if not code:
                return
            clean_titles = [self.__clean_req_title(title) for title in titles or []]
            clean_titles = [title for title in clean_titles if title]
            if not clean_titles:
                return
            # 第一层通常是“7 图像显示”这类大章；需求管理使用其下的模块/功能/子功能。
            parts = clean_titles[1:] if len(clean_titles) > 1 else clean_titles
            item = sync_map.setdefault(code, {})
            item["name"] = parts[-1]
            if len(parts) >= 1:
                item["module"] = parts[0]
            if len(parts) >= 2:
                item["function"] = parts[1]
            if len(parts) >= 3:
                item["sub_function"] = parts[2]

        def walk(items: List[SrsNodeForm], path: List[str] = None):
            path = path or []
            for node in items or []:
                title = getattr(node, "title", "") or ""
                next_path = path + [title]
                node_code = self.__normalize_srs_code(str(getattr(node, "srs_code", "") or ""))
                table_code = extract_req_code_from_table(getattr(node, "table", None))
                table_path = path if table_code and re.match(r"^导入表格\d*$", title.strip()) else next_path
                put_entry(node_code or table_code, table_path)
                walk(getattr(node, "children", None) or [], next_path)

        walk(nodes or [], [])
        if not sync_map:
            return
        rows: List[SrsReq] = db.session.execute(
            select(SrsReq).where(SrsReq.doc_id == doc_id, SrsReq.code.in_(list(sync_map.keys())), SrsReq.type_code != "2")
        ).scalars().all()
        if not rows:
            return
        req_ids = [row.id for row in rows]
        reqd_rows: List[SrsReqd] = db.session.execute(select(SrsReqd).where(SrsReqd.req_id.in_(req_ids))).scalars().all()
        reqd_map = {row.req_id: row for row in reqd_rows}
        for row in rows:
            item = sync_map.get(row.code) or {}
            if item.get("module"):
                row.module = item.get("module")
            if item.get("function"):
                row.function = item.get("function")
            if item.get("sub_function"):
                row.sub_function = item.get("sub_function")
            if item.get("name"):
                reqd_row = reqd_map.get(row.id)
                if not reqd_row:
                    reqd_row = SrsReqd(req_id=row.id)
                    db.session.add(reqd_row)
                    reqd_map[row.id] = reqd_row
                reqd_row.name = item.get("name")
        db.session.commit()

    def __sync_doc_srs_tables_from_doc_nodes(self, nodes: List[SrsNodeForm]):
        sync_map: Dict[str, dict] = {}

        def extract_req_code_from_table(table):
            headers = getattr(table, "headers", None) if table else None
            rows = getattr(table, "rows", None) if table else None
            if not headers or not rows or len(headers) < 2:
                return ""
            col_codes = [getattr(h, "code", "") for h in headers]
            pairs = []
            h_left = self.__normalize_text(getattr(headers[0], "name", "") or "")
            h_right = self.__normalize_text(getattr(headers[1], "name", "") or "")
            if h_left or h_right:
                pairs.append((h_left, h_right))
            for row in rows or []:
                left = self.__normalize_text(str((row or {}).get(col_codes[0], "") or ""))
                right = self.__normalize_text(str((row or {}).get(col_codes[1], "") or ""))
                if left or right:
                    pairs.append((left, right))
            for left, right in pairs:
                if self.__map_reqd_field(left) == "code":
                    return self.__normalize_srs_code(right or "")
            return ""

        def put_entry(code: str, titles: List[str]):
            code = self.__normalize_srs_code(code or "")
            if not code:
                return
            clean_titles = [self.__clean_req_title(title) for title in titles or []]
            clean_titles = [title for title in clean_titles if title]
            if not clean_titles:
                return
            parts = clean_titles[1:] if len(clean_titles) > 1 else clean_titles
            item = sync_map.setdefault(code, {})
            if len(parts) >= 1:
                item["module"] = parts[0]
            if len(parts) >= 2:
                item["function"] = parts[1]
            if len(parts) >= 3:
                item["sub_function"] = parts[2]

        def collect(items: List[SrsNodeForm], path: List[str] = None):
            path = path or []
            for node in items or []:
                title = getattr(node, "title", "") or ""
                next_path = path + [title]
                node_code = self.__normalize_srs_code(str(getattr(node, "srs_code", "") or ""))
                table_code = extract_req_code_from_table(getattr(node, "table", None))
                table_path = path if table_code and re.match(r"^导入表格\d*$", title.strip()) else next_path
                put_entry(node_code or table_code, table_path)
                collect(getattr(node, "children", None) or [], next_path)

        def apply_tables(items: List[SrsNodeForm]):
            for node in items or []:
                table = getattr(node, "table", None)
                headers = getattr(table, "headers", None) if table else None
                rows = getattr(table, "rows", None) if table else None
                if headers and rows:
                    header_norm = [self.__normalize_header(getattr(h, "name", "") or "") for h in headers]
                    col_idx = self.__resolve_req_columns(header_norm)
                    if "code" in col_idx and ("module" in col_idx or "function" in col_idx or "sub_function" in col_idx):
                        col_codes = [getattr(h, "code", "") for h in headers]
                        for row in rows or []:
                            code_col = col_codes[col_idx["code"]]
                            code = self.__normalize_srs_code(str((row or {}).get(code_col, "") or ""))
                            item = sync_map.get(code)
                            if not item:
                                continue
                            if item.get("module") and "module" in col_idx:
                                row[col_codes[col_idx["module"]]] = item.get("module")
                            if item.get("function") and "function" in col_idx:
                                row[col_codes[col_idx["function"]]] = item.get("function")
                            if item.get("sub_function") and "sub_function" in col_idx:
                                row[col_codes[col_idx["sub_function"]]] = item.get("sub_function")
                apply_tables(getattr(node, "children", None) or [])

        collect(nodes or [], [])
        if sync_map:
            apply_tables(nodes or [])

    def __sync_saved_doc_srs_tables_from_req_rows(self, doc_id: int):
        req_rows: List[SrsReq] = db.session.execute(
            select(SrsReq).where(SrsReq.doc_id == doc_id, SrsReq.type_code.in_(["1", "reqd"]))
        ).scalars().all()
        req_map = {
            self.__normalize_srs_code(row.code or ""): {
                "module": row.module,
                "function": row.function,
                "sub_function": row.sub_function,
            }
            for row in req_rows
            if self.__normalize_srs_code(row.code or "")
        }
        if not req_map:
            return

        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == doc_id, SrsNode.table.isnot(None))
        ).scalars().all()
        changed = False
        for node in nodes:
            try:
                table = json.loads(node.table) if isinstance(node.table, str) else (node.table or {})
            except Exception:
                continue
            headers = table.get("headers") or []
            rows = table.get("rows") or []
            if not headers or not rows:
                continue
            header_norm = [self.__normalize_header((h or {}).get("name") or "") for h in headers]
            col_idx = self.__resolve_req_columns(header_norm)
            if "code" not in col_idx or not any(key in col_idx for key in ["module", "function", "sub_function"]):
                continue
            header_codes = [(h or {}).get("code") or "" for h in headers]
            table_changed = False
            for row_idx, table_row in enumerate(rows):
                code = self.__normalize_srs_code(str((table_row or {}).get(header_codes[col_idx["code"]], "") or ""))
                req_item = req_map.get(code)
                if not req_item:
                    continue
                for field in ["module", "function", "sub_function"]:
                    if field not in col_idx:
                        continue
                    value = req_item.get(field)
                    if value is None:
                        continue
                    col_code = header_codes[col_idx[field]]
                    if table_row.get(col_code) != value:
                        table_row[col_code] = value
                        table_changed = True
                    cells = table.get("cells") or []
                    cell_row_idx = row_idx + 1
                    cell_col_idx = col_idx[field]
                    if (
                        isinstance(cells, list) and
                        cell_row_idx < len(cells) and
                        isinstance(cells[cell_row_idx], list) and
                        cell_col_idx < len(cells[cell_row_idx]) and
                        isinstance(cells[cell_row_idx][cell_col_idx], dict) and
                        cells[cell_row_idx][cell_col_idx].get("value") != value
                    ):
                        cells[cell_row_idx][cell_col_idx]["value"] = value
                        table_changed = True
            if table_changed:
                node.table = json.dumps(table, ensure_ascii=False)
                changed = True
        if changed:
            db.session.commit()

    def __parse_docx_table(self, tab):
        # Parse table content and merged-cell structure from Word XML.
        tr_list = list(tab._tbl.tr_lst)  # type: ignore[attr-defined]
        if not tr_list:
            return None

        def grid_span(tc):
            try:
                gs = tc.tcPr.gridSpan  # type: ignore[attr-defined]
                if gs is not None and gs.val:
                    return int(gs.val)
            except Exception:
                pass
            return 1

        def v_merge(tc):
            try:
                vm = tc.tcPr.vMerge  # type: ignore[attr-defined]
                if vm is None:
                    return None
                val = vm.val
                return (str(val).lower() if val is not None else "continue")
            except Exception:
                return None

        def h_align(tc):
            try:
                first_p = tc.p_lst[0] if tc.p_lst else None  # type: ignore[attr-defined]
                jc = first_p.pPr.jc if first_p is not None and first_p.pPr is not None else None
                if jc is None or jc.val is None:
                    return "left"
                val = str(jc.val).lower()
                if "center" in val:
                    return "center"
                if "right" in val:
                    return "right"
                return "left"
            except Exception:
                return "left"

        def v_align(tc):
            try:
                va = tc.tcPr.vAlign  # type: ignore[attr-defined]
                if va is None or va.val is None:
                    return "top"
                val = str(va.val).lower()
                if "center" in val:
                    return "middle"
                if "bottom" in val:
                    return "bottom"
                return "top"
            except Exception:
                return "top"

        col_count = 0
        for tr in tr_list:
            count = 0
            for tc in tr.tc_lst:
                count += grid_span(tc)
            col_count = max(col_count, count)
        if col_count <= 0:
            return None

        cells: List[List[TableCell]] = []
        anchors: Dict[int, Tuple[int, int]] = {}
        for r_idx, tr in enumerate(tr_list):
            row_cells = [TableCell(value="", row_span=1, col_span=1) for _ in range(col_count)]
            c_idx = 0
            for tc in tr.tc_lst:
                while c_idx < col_count and row_cells[c_idx].row_span == 0:
                    c_idx += 1
                if c_idx >= col_count:
                    break
                span = max(1, grid_span(tc))
                text = self.__normalize_text("\n".join([self.__normalize_text(p.text) for p in tc.p_lst]))  # type: ignore[attr-defined]
                cell_h_align = h_align(tc)
                cell_v_align = v_align(tc)
                vm = v_merge(tc)
                if vm == "continue":
                    touched = set()
                    for k in range(c_idx, min(col_count, c_idx + span)):
                        anchor = anchors.get(k)
                        if anchor and anchor not in touched:
                            ar, ac = anchor
                            cells[ar][ac].row_span = (cells[ar][ac].row_span or 1) + 1
                            touched.add(anchor)
                        row_cells[k] = TableCell(value="", row_span=0, col_span=0, h_align=cell_h_align, v_align=cell_v_align)
                else:
                    row_cells[c_idx] = TableCell(value=text, row_span=1, col_span=span, h_align=cell_h_align, v_align=cell_v_align)
                    for k in range(c_idx + 1, min(col_count, c_idx + span)):
                        row_cells[k] = TableCell(value="", row_span=0, col_span=0, h_align=cell_h_align, v_align=cell_v_align)
                    if vm == "restart":
                        for k in range(c_idx, min(col_count, c_idx + span)):
                            anchors[k] = (r_idx, c_idx)
                    else:
                        for k in range(c_idx, min(col_count, c_idx + span)):
                            anchors.pop(k, None)
                c_idx += span
            cells.append(row_cells)

        if not cells:
            return None

        header_row = cells[0]
        headers = [TabHeader(code=f"col_{idx+1}", name=(header_row[idx].value or f"列{idx+1}")) for idx in range(col_count)]
        rows = []
        for body_row in cells[1:]:
            row_obj = {}
            for idx in range(col_count):
                row_obj[f"col_{idx+1}"] = body_row[idx].value or ""
            if any(v for v in row_obj.values()):
                rows.append(row_obj)
        return Table(headers=headers, rows=rows, cells=cells)

    def __upsert_imported_srs_reqs(self, doc_id: int, req_rows: List[dict]):
        if not req_rows:
            return
        sql = select(SrsReq).where(SrsReq.doc_id == doc_id)
        exists = db.session.execute(sql).scalars().all()
        exists_dict = {(row.type_code, row.code): row for row in exists}

        seen = set()
        for item in req_rows:
            key = (item.get("type_code") or "1", item.get("code") or "")
            if not key[1] or key in seen:
                continue
            seen.add(key)
            row = exists_dict.get(key)
            if row:
                row.module = item.get("module")
                row.function = item.get("function")
                row.sub_function = item.get("sub_function")
                row.location = item.get("location")
            else:
                db.session.add(SrsReq(doc_id=doc_id, **item))
        db.session.commit()

    def __sync_imported_req_rcms(self, doc_id: int, req_rcm_map: Dict[str, set]):
        if not req_rcm_map:
            return
        req_codes = [code for code in req_rcm_map.keys() if code]
        if not req_codes:
            return
        req_rows = db.session.execute(select(SrsReq).where(SrsReq.doc_id == doc_id, SrsReq.code.in_(req_codes))).scalars().all()
        if not req_rows:
            return
        req_ids = [row.id for row in req_rows]
        db.session.execute(delete(ReqRcm).where(ReqRcm.req_id.in_(req_ids)))

        all_rcm_codes = sorted({code for codes in req_rcm_map.values() for code in codes})
        if not all_rcm_codes:
            db.session.commit()
            return
        rcm_rows = db.session.execute(select(Rcm).where(Rcm.code.in_(all_rcm_codes))).scalars().all()
        rcm_id_dict = {row.code: row.id for row in rcm_rows}
        insert_values = []
        for req_row in req_rows:
            for rcm_code in sorted(req_rcm_map.get(req_row.code, set())):
                rcm_id = rcm_id_dict.get(rcm_code)
                if rcm_id:
                    insert_values.append(dict(req_id=req_row.id, rcm_id=rcm_id))
        if insert_values:
            db.session.execute(pg_insert(ReqRcm).values(insert_values).on_conflict_do_nothing())
        db.session.commit()

    def __parse_docx_content(self, docx: Document):
        roots: List[SrsNodeForm] = []
        stack: List[Tuple[int, SrsNodeForm]] = []
        current: SrsNodeForm = None
        heading_rows = []
        srs_pattern = re.compile(r"\bSRS[-_A-Za-z0-9.]+\b", re.I)
        rcm_pattern = re.compile(r"\bRCM[-_A-Za-z0-9]+\b", re.I)
        mime_map = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp", "webp": "image/webp"}
        img_idx = 0
        table_idx = 0
        heading_counters = [0, 0, 0, 0, 0]

        def ensure_text_holder():
            nonlocal current
            if current is None:
                current = SrsNodeForm(title="导入正文", text="", children=[])
                roots.append(current)
            if current.children is None:
                current.children = []
            return current

        def attach_to_current(node: SrsNodeForm):
            if current:
                current.children = current.children or []
                current.children.append(node)
            else:
                roots.append(node)

        def attach_node(level: int, node: SrsNodeForm):
            nonlocal current
            while stack and stack[-1][0] >= level:
                stack.pop()
            if stack:
                parent = stack[-1][1]
                parent.children = parent.children or []
                parent.children.append(node)
            else:
                roots.append(node)
            stack.append((level, node))
            current = node

        def extract_images_from_para(para: Paragraph):
            urls = []
            used_rids = set()
            blips = para._element.xpath(".//*[local-name()='blip']")
            for blip in blips:
                rid = blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
                if not rid or rid in used_rids:
                    continue
                used_rids.add(rid)
                try:
                    rel = para.part.rels[rid]
                except Exception:
                    continue
                target = getattr(rel, "target_ref", "")
                ext = (target.rsplit(".", 1)[-1].lower() if "." in target else "png")
                mime = mime_map.get(ext, "image/png")
                b64 = base64.b64encode(rel.target_part.blob).decode("ascii")
                urls.append(f"data:{mime};base64,{b64}")
            return urls

        def sync_counters_with_number(number_text: str):
            try:
                parts = [int(p) for p in str(number_text or "").split(".") if str(p).strip()]
            except Exception:
                return None
            if not parts:
                return None
            depth = min(len(parts), 5)
            for idx in range(depth):
                heading_counters[idx] = max(0, parts[idx])
            for idx in range(depth, 5):
                heading_counters[idx] = 0
            return ".".join(str(v) for v in heading_counters[:depth] if v > 0)

        def build_number_from_level(level: int):
            depth = max(1, min(int(level or 1), 5))
            for idx in range(depth - 1):
                if heading_counters[idx] <= 0:
                    heading_counters[idx] = 1
            heading_counters[depth - 1] = heading_counters[depth - 1] + 1 if heading_counters[depth - 1] > 0 else 1
            for idx in range(depth, 5):
                heading_counters[idx] = 0
            return ".".join(str(v) for v in heading_counters[:depth] if v > 0)

        for child in docx.element.body.iterchildren():
            tag = str(child.tag).lower()
            if tag.endswith("}p"):
                para = Paragraph(child, docx._body)
                txt = self.__normalize_text(para.text)
                numpr_level = self.__guess_numpr_level(para) if txt else None
                level = self.__guess_heading_level(para) if txt else None
                # 在已进入任一章节（1/2/3...级）后，"1. xxx / 2. xxx" 这类枚举项按正文处理，不识别为标题。
                if txt and level is not None and stack:
                    is_enum_item = bool(
                        re.match(r"^\d+[.．、]\s+\S+", txt)
                        and not re.match(r"^\d+\.\d+", txt)
                    )
                    if is_enum_item:
                        level = None
                # 兼容“接口章节下的无编号三级标题”：
                # 在父级为“x.x 接口”时，将“以‘接口’结尾”的短行识别为下一层级标题（如：数据上传接口、创建处理任务接口）。
                if txt and level is None and stack:
                    parent_level, parent_node = stack[-1]
                    parent_title = self.__normalize_text(getattr(parent_node, "title", ""))
                    is_interface_parent = bool(
                        re.match(r"^\d+(?:\.\d+)+\s*接口$", parent_title)
                        or parent_title == "接口"
                    )
                    is_interface_subtitle = bool(
                        re.search(r"接口$", txt)
                        and len(txt) <= 80
                        and not re.search(r"[。！？；;]$", txt)
                        and not re.search(r"https?://|/[\w\-]+", txt, re.I)
                    )
                    if is_interface_parent and is_interface_subtitle:
                        level = min(parent_level + 1, 5)
                if txt and level is not None:
                    heading_number = self.__extract_heading_number(txt)
                    title_with_number = txt
                    if heading_number:
                        synced = sync_counters_with_number(heading_number)
                        heading_number = synced or heading_number
                    elif numpr_level is not None:
                        generated_number = build_number_from_level(level)
                        if generated_number:
                            heading_number = generated_number
                            title_with_number = f"{generated_number} {txt}".strip()
                    node = SrsNodeForm(title=title_with_number, text="", children=[])
                    heading_rows.append(dict(level=level, title=title_with_number, number=heading_number))
                    srs_hit = srs_pattern.search(txt)
                    if srs_hit:
                        node.srs_code = srs_hit.group(0).upper()
                    attach_node(level, node)
                elif txt:
                    holder = ensure_text_holder()
                    holder.text = f"{holder.text}\n{txt}".strip() if holder.text else txt
                    rcm_codes = {self.__normalize_rcm_code(item) for item in rcm_pattern.findall(txt)}
                    rcm_codes = {code for code in rcm_codes if code}
                    if rcm_codes:
                        existed = set(self.__normalize_rcm_codes(holder.rcm_codes or []))
                        holder.rcm_codes = sorted(existed.union(rcm_codes))
                    srs_hit = srs_pattern.search(txt)
                    if srs_hit and not holder.srs_code:
                        holder.srs_code = srs_hit.group(0).upper()

                for img_url in extract_images_from_para(para):
                    img_idx += 1
                    attach_to_current(SrsNodeForm(title=f"导入图片{img_idx}", img_url=img_url, children=[]))
            elif tag.endswith("}tbl"):
                tab = DocxTable(child, docx._body)
                table = self.__parse_docx_table(tab)
                if table is None or not table.headers:
                    continue
                table_idx += 1
                attach_to_current(SrsNodeForm(title=f"导入表格{table_idx}", table=table, children=[]))
        return roots, heading_rows

    async def import_srs_doc_word(self, product_id: int, version: str, change_log: str, file):
        if Document is None or DocxTable is None or Paragraph is None:
            return Resp.resp_err(msg="当前环境缺少 python-docx 依赖，暂不可用 Word 导入。")
        try:
            bys = await file.read()
            docx = Document(io.BytesIO(bys))
            file_name = file.filename or ""
            folder_name, file_no = self.__extract_file_info(file_name)
            content, heading_rows = self.__parse_docx_content(docx)
            heading_err = self.__validate_heading_numbers(heading_rows)
            if heading_err:
                logger.warning("word heading validation warning (ignored): %s", heading_err)

            # 先基于“已解析节点表格”抽取，避免不同Word表格结构导致漏识别；再与原始docx抽取结果合并去重
            srs_req_rows_nodes, req_rcm_map_nodes = self.__extract_srs_reqs_from_nodes(content)
            srs_req_rows_docx, req_rcm_map_docx = self.__extract_srs_reqs_from_tables(docx)
            srs_reqd_rows_nodes = self.__extract_srs_reqds_from_nodes(content)
            srs_req_rows = []
            seen_req_keys = set()
            for item in [*(srs_req_rows_nodes or []), *(srs_req_rows_docx or [])]:
                key = ((item or {}).get("type_code") or "1", (item or {}).get("code") or "")
                if not key[1] or key in seen_req_keys:
                    continue
                seen_req_keys.add(key)
                srs_req_rows.append(item)
            req_rcm_map = {}
            for req_map in [req_rcm_map_nodes or {}, req_rcm_map_docx or {}]:
                for req_code, rcm_set in req_map.items():
                    if not req_code:
                        continue
                    req_rcm_map.setdefault(req_code, set()).update(rcm_set or set())
            form = SrsDocForm(
                product_id=product_id,
                version=version,
                folder_name=folder_name or None,
                file_no=file_no or None,
                change_log=change_log,
                content=content,
            )
            resp = await self.add_srs_doc(form)
            if resp.code == 200 and resp.data and resp.data.id:
                self.__upsert_imported_srs_reqs(resp.data.id, srs_req_rows)
                self.__sync_imported_req_rcms(resp.data.id, req_rcm_map)
                self.__upsert_imported_srs_reqds(resp.data.id, srs_reqd_rows_nodes)
                # 新增能力：根据导入文档中的章节图片，自动回填产品图表文件库（保留手动上传能力）
                self.__auto_sync_product_doc_images(product_id, content)
                row = db.session.execute(select(SrsDoc).where(SrsDoc.id == resp.data.id)).scalars().first()
                if row:
                    self.__fix_rcms(row)
            return resp
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    def __update_nodes(self, doc: SrsDoc, p_id, nodes: List[SrsNodeForm]):
        for idx, node in enumerate(nodes or []):
            sql = select(SrsNode).where(SrsNode.doc_id == doc.id, SrsNode.n_id == node.n_id) if node.n_id else None
            row = db.session.execute(sql).scalars().first() if sql is not None else None
            if not row:
                doc.n_id += 1
                table = node.table.json() if node.table else None
                row = SrsNode(doc_id=doc.id, n_id=doc.n_id, p_id=p_id, priority=idx, title=node.title, label=node.label, img_url=node.img_url, text=node.text, ref_type=node.ref_type,
                            table=table, srs_code=node.srs_code)
                row.rcm_codes = ",".join(node.rcm_codes) if node.rcm_codes is not None else None
                db.session.add(row)
                logger.info("add_node: %s, %s, %s", p_id, doc.n_id, node.title)
            else:
                for key, value in node.dict().items():
                    if key == "doc_id" or key == "n_id" or key == "p_id" or value is None:
                        continue
                    if key == "table":
                        value = json.dumps(value) if value else None
                    setattr(row, key, value)
                row.priority = idx
                logger.info("alt_node: %s, %s, %s", p_id, doc.n_id, node.title)
            if node.children:
                self.__update_nodes(doc, row.n_id, node.children)

    def __reset_tree_node_ids(self, nodes: List[SrsNodeForm]):
        # update_srs_doc 采用“全量重建”策略，需清空前端携带的旧 n_id，
        # 否则新节点与旧节点 n_id 冲突时会在同一轮重建中被覆盖。
        for node in nodes or []:
            node.n_id = None
            if node.children:
                self.__reset_tree_node_ids(node.children)

    def __fix_rcms(self, doc: SrsDoc):
        objs_dict, tree = self.__tree(doc)
        all_reqs = []
        all_rcms = []
        all_pairs = []
        for node in iter_tree(tree):
            rcm_codes = node.rcm_codes or []
            if rcm_codes:
                srs_code = node.srs_code
                if not srs_code:
                    p_node = objs_dict.get(node.p_id)
                    while p_node:
                        srs_code = p_node.srs_code
                        if srs_code:
                            break
                        p_node = objs_dict.get(p_node.p_id)
                if not srs_code:
                    continue
                all_reqs.append(srs_code)
                all_rcms.extend(rcm_codes)
                all_pairs.append((srs_code, rcm_codes))

        sql = select(SrsReq).where(SrsReq.doc_id == doc.id, SrsReq.code.in_(all_reqs))
        reqs = db.session.execute(sql).scalars().all()
        reqs_dict = dict()
        for req in reqs:
            reqs_dict.setdefault(req.code, []).append(req.id)
        
        sql = select(Rcm).where(Rcm.code.in_(all_rcms))
        rcms = db.session.execute(sql).scalars().all()
        rcms_dict = {rcm.code: rcm.id for rcm in rcms}
        
        delete_values = []
        insert_values = []
        for srs_code, rcm_codes in all_pairs:
            req_ids = reqs_dict.get(srs_code, [])
            rcm_ids = [rcms_dict.get(rcm_code) for rcm_code in rcm_codes if rcm_code in rcms_dict]
            if not req_ids or not rcm_ids:
                continue
            delete_values.extend(req_ids)
            for req_id in req_ids:
                for rcm_id in rcm_ids:
                    insert_values.append(dict(req_id=req_id, rcm_id=rcm_id))
        if delete_values:
            db.session.execute(delete(ReqRcm).where(ReqRcm.req_id.in_(delete_values)))
        if insert_values:
            db.session.execute(pg_insert(ReqRcm).values(insert_values).on_conflict_do_nothing())
        db.session.commit()

    async def add_srs_doc(self, form: SrsDocForm):
        try:
            sql = select(func.count(SrsDoc.id)).where(SrsDoc.product_id == form.product_id, SrsDoc.version == form.version)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            
            row = SrsDoc(
                product_id=form.product_id,
                version=form.version,
                folder_name=form.folder_name,
                change_log=form.change_log,
                n_id=0,
                file_no=form.file_no,
            )
            db.session.add(row)
            db.session.flush()
            if form.content:
                self.__update_nodes(row, 0, form.content)
            db.session.commit()
            self.__fix_rcms(row)
            return Resp.resp_ok(data=SrsDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    async def duplicate_srs_doc(self, id: int):
        fromdoc:SrsDocObj = (await self.get_srs_doc(id, with_tree=True)).data
        if not fromdoc:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        version = new_version(fromdoc.version)
        newdoc = SrsDoc(
            product_id=fromdoc.product_id,
            version=version,
            folder_name=fromdoc.folder_name,
            file_no=fromdoc.file_no,
            change_log=fromdoc.change_log,
            n_id=0,
        )
        sql = select(func.count(SrsDoc.id)).where(SrsDoc.product_id == newdoc.product_id, SrsDoc.version == newdoc.version)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_obj_exist"))
        try:
            db.session.add(newdoc)
            db.session.flush()
            self.__update_nodes(newdoc, 0, fromdoc.content)

            srstypes: List[SrsType] = db.session.execute(select(SrsType).where(SrsType.doc_id == fromdoc.id).order_by(SrsType.id)).scalars().all()
            for srstype in srstypes:
                newtype = SrsType(doc_id=newdoc.id, type_code=srstype.type_code, type_name=srstype.type_name)
                db.session.add(newtype)

            sql = select(SrsReq, SrsReqd).outerjoin(SrsReqd, SrsReq.id == SrsReqd.req_id).where(SrsReq.doc_id == fromdoc.id)
            srsreqs: List[Tuple[SrsReq, SrsReqd]] = db.session.execute(sql).all()
            for srsreq, reqd in srsreqs:
                newreq = SrsReq(doc_id=newdoc.id, code=srsreq.code, module=srsreq.module, 
                            function=srsreq.function, sub_function=srsreq.sub_function,
                            location=srsreq.location, type_code=srsreq.type_code)
                db.session.add(newreq)
                db.session.flush()
                if reqd:
                    newreqd = SrsReqd(req_id=newreq.id, name=reqd.name, overview=reqd.overview,
                                    participant=reqd.participant, pre_condition=reqd.pre_condition,
                                    trigger=reqd.trigger, work_flow=reqd.work_flow,
                                    post_condition=reqd.post_condition, exception=reqd.exception,
                                    constraint=reqd.constraint)
                    db.session.add(newreqd)

                reqrcms: List[ReqRcm] = db.session.execute(select(ReqRcm).where(ReqRcm.req_id == srsreq.id)).scalars().all()
                for reqrcm in reqrcms:
                    newreqrcm = ReqRcm(req_id=newreq.id, rcm_id=reqrcm.rcm_id)
                    db.session.add(newreqrcm)
            db.session.commit()
            return Resp.resp_ok(data=SrsDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_srs_doc(self, id):
        try:
            sql = select(func.count(SdsDoc.id)).where(SdsDoc.srsdoc_id == id)
            count = db.session.execute(sql).scalar()

            # 清理SRS管理数据
            req_ids = [req_id for req_id, in db.session.query(SrsReq.id).filter(SrsReq.doc_id == id).all()]
            if req_ids:
                db.session.execute(delete(ReqRcm).where(ReqRcm.req_id.in_(req_ids)))
                db.session.execute(delete(SrsReqd).where(SrsReqd.req_id.in_(req_ids)))
            db.session.execute(delete(SrsReq).where(SrsReq.doc_id == id))
            db.session.execute(delete(SrsType).where(SrsType.doc_id == id))
            db.session.execute(delete(SrsNode).where(SrsNode.doc_id == id))
            if count > 0:
                # 若已绑定详细设计：保留SRS主记录用于维持产品绑定，但标记为“已删除”并从可选列表隐藏
                row = db.session.execute(select(SrsDoc).where(SrsDoc.id == id)).scalars().first()
                if not row:
                    return Resp.resp_err(msg=ts("msg_obj_null"))
                stamp = datetime.now().strftime("%y%m%d%H%M%S")
                row.version = f"{DELETED_SRS_VERSION_PREFIX}{id}_{stamp}"
                row.change_log = "已删除需求规格说明（保留绑定占位）"
                row.n_id = 0
            else:
                db.session.execute(delete(SrsDoc).where(SrsDoc.id == id))
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    async def add_srs_node(self, node: SrsNodeForm):
        sql = select(SrsNode, SrsDoc).join(SrsDoc, SrsNode.doc_id == SrsDoc.id)
        sql = sql.where(SrsNode.doc_id == node.doc_id, SrsNode.n_id == node.p_id)
        result = db.session.execute(sql).first()
        if not result:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        _, doc = result
        doc.n_id += 1
        table = node.table.json() if node.table else None
        row = SrsNode(doc_id=doc.id, n_id=doc.n_id, p_id=node.p_id, priority=doc.n_id, 
                            title=node.title, text=node.text, table=table)
        row.rcm_codes = ",".join(node.rcm_codes) if node.rcm_codes is not None else None
        db.session.add(row)
        db.session.commit()
        data = dict(doc_id=row.doc_id, n_id=row.n_id, p_id=row.p_id, priority=row.priority, **node.dict())
        return Resp.resp_ok(data=SrsNodeForm(**data))
    
    async def delete_srs_node(self, doc_id, n_id):
        db.session.execute(delete(SrsNode).where(SrsNode.doc_id == doc_id, SrsNode.n_id == n_id))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_srs_doc(self, form: SrsDocForm):
        try:
            sql = select(func.count(SrsDoc.id)).where(SrsDoc.product_id == form.product_id, SrsDoc.version == form.version, SrsDoc.id != form.id)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            sql = select(SrsDoc).where(SrsDoc.id == form.id)
            row:SrsDoc = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            if form.content is None:
                logger.warning("update_srs_doc missing content: doc_id=%s", form.id)
                return Resp.resp_err(msg="保存失败：未收到文档结构内容，请刷新后重试")
            if isinstance(form.content, list) and len(form.content) == 0:
                logger.warning("update_srs_doc empty content: doc_id=%s", form.id)
                return Resp.resp_err(msg="保存失败：文档结构为空，请刷新后重试")
            logger.info("update_srs_doc content_count: doc_id=%s count=%s", form.id, len(form.content or []))
            for key, value in form.dict().items():
                if key == "id" or key == "n_id" or value is None:
                    continue
                setattr(row, key, value)
            row.n_id = 0
            db.session.execute(delete(SrsNode).where(SrsNode.doc_id == row.id))
            self.__sync_doc_srs_tables_from_doc_nodes(form.content or [])
            self.__reset_tree_node_ids(form.content or [])
            self.__update_nodes(row, 0, form.content)
            db.session.commit()
            self.__sync_srs_req_names_from_doc_nodes(row.id, form.content or [])
            self.__upsert_imported_srs_reqds(row.id, self.__extract_srs_reqds_from_nodes(form.content or []))
            self.__sync_saved_doc_srs_tables_from_req_rows(row.id)
            self.__fix_rcms(row)
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_srs_doc_file_no(self, id: int, file_no: str):
        try:
            sql = select(SrsDoc).where(SrsDoc.id == id)
            row: SrsDoc = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            row.file_no = (file_no or "").strip() or None
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    async def get_srs_doc_txts(self, doc_id):
        def __gather_nodes(texts:List[str],nodes: List[SrsNodeForm]):
            for node in nodes:
                values = [node.title, node.text]
                values = [value for value in values if value]
                texts += values
                if node.children:
                    __gather_nodes(texts, node.children)
            return texts

        docdata: Resp[SrsDocObj] = (await self.get_srs_doc(doc_id, with_tree=True)).data
        content = docdata.content if docdata and docdata.content else []
        txts = __gather_nodes([], content)
        return Resp.resp_ok(data=txts)
   
    def __query_imgs(self, product_id: int):
        subquery = select(DocFile.category, func.max(DocFile.id).label("max_id"))
        subquery = subquery.where(DocFile.product_id == product_id).group_by(DocFile.category).subquery()
        sql = select(DocFile).join(subquery, DocFile.id == subquery.c.max_id)
        rows: List[DocFile] = db.session.execute(sql).scalars().all()
        return {row.category: row.file_url for row in rows}

    def __tree(self, doc: SrsDoc):
        tree = []
        sql = select(SrsNode).where(SrsNode.doc_id == doc.id).order_by(SrsNode.priority)
        nodes: List[SrsNode] = db.session.execute(sql).scalars().all()
        objs_dict = dict()
        objs = []
        prod_imgs = self.__query_imgs(doc.product_id)
        for node in nodes:
            table = None
            if node.table:
                try:
                    if isinstance(node.table, Table):
                        table = node.table
                    elif isinstance(node.table, (dict, list)):
                        table = Table.parse_obj(node.table)
                    elif isinstance(node.table, str):
                        table = Table.parse_raw(node.table)
                    else:
                        table = Table.parse_obj(node.table)
                except Exception:
                    logger.warning("parse srs_node.table failed: doc_id=%s n_id=%s", node.doc_id, node.n_id)
                    table = None

            obj = SrsNodeForm(children=[], doc_id=node.doc_id, n_id=node.n_id, p_id=node.p_id,
                            title=node.title, label=node.label, img_url=node.img_url, text=node.text, ref_type=node.ref_type, table=table, srs_code=node.srs_code)
            obj.rcm_codes = self.__normalize_rcm_codes(node.rcm_codes.split(",")) if node.rcm_codes is not None else None
            if not obj.img_url and obj.ref_type in prod_imgs:
                obj.img_url = prod_imgs[obj.ref_type]

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
        return objs_dict, tree

    async def get_srs_doc(self, id:str, with_tree: bool = False):
        sql = select(SrsDoc, Product).outerjoin(Product, SrsDoc.product_id == Product.id).where(SrsDoc.id == id)
        row, row_prod = db.session.execute(sql).first() or (None, None)
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        if (row.version or "").startswith(DELETED_SRS_VERSION_PREFIX):
            return Resp.resp_err(msg=ts("msg_obj_null"))
        objs_dict, tree = self.__tree(row) if with_tree else (None, [])
        product_name = row_prod.name if row_prod else ""
        product_version = row_prod.full_version if row_prod else ""

        # srs_nodes = dict()
        # if tree:
        #     all_srscodes = []
        #     for node in iter_tree(tree):
        #         if node.rcm_codes is None:
        #             continue
        #         srs_code = node.srs_code
        #         if not srs_code:
        #             p_node = objs_dict.get(node.p_id)
        #             while p_node:
        #                 srs_code = p_node.srs_code
        #                 if srs_code:
        #                     break
        #                 p_node = objs_dict.get(p_node.p_id)
        #         if not srs_code:
        #             continue
        #         srs_nodes.setdefault(srs_code, []).append(node)
        #         all_srscodes.append(srs_code)

        #     sql = select(ReqRcm, SrsReq, Rcm).outerjoin(SrsReq, ReqRcm.req_id == SrsReq.id)
        #     sql = sql.outerjoin(Rcm, ReqRcm.rcm_id == Rcm.id)
        #     sql = sql.where(SrsReq.code.in_(all_srscodes))
        #     sql = sql.distinct(SrsReq.code, Rcm.code).order_by(SrsReq.code, Rcm.code)
        #     rows: list[Tuple[ReqRcm, SrsReq, Rcm]] = db.session.execute(sql).all()
        #     srs_rcms = dict()
        #     for _, req, rcm in rows:
        #         srs_rcms.setdefault(req.code, []).append(rcm.code)
        #     for srs_code, nodes in srs_nodes.items():
        #         rcms = srs_rcms.get(srs_code) or []
        #         for node in nodes:
        #             node.rcm_codes = rcms
        return Resp.resp_ok(data=SrsDocObj(**row.dict(), product_name=product_name, product_version=product_version, content=tree))

    async def list_srs_doc(self, op_user: UserObj, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(SrsDoc, Product).outerjoin(Product, SrsDoc.product_id == Product.id)
        sql = sql.where(~SrsDoc.version.like(f"{DELETED_SRS_VERSION_PREFIX}%"))
        if product_id:
            sql = sql.where(SrsDoc.product_id == product_id)
        if version:
            sql = sql.where(SrsDoc.version.like(f"%{version}%"))
        if not product_id and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))
        
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(SrsDoc.create_time))
        rows: List[SrsDoc] = db.session.execute(sql).all()

        objs = []
        for row, row_prd in rows:
            obj = SrsDocObj(**row.dict())
            if row_prd:
                obj.product_name = row_prd.name
                obj.product_version = row_prd.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))

    async def compare_srs_doc(self, id0: int, id1: int):
        def __feature_key(req: SrsReq):
            # 判定新增/减少时仅按功能编号，避免名称改动造成误判
            code = (req.code or "").strip()
            if code:
                return code
            module = (req.module or "").strip()
            function = (req.function or "").strip()
            return " - ".join([v for v in [module, function] if v])

        def __feature_display(req: SrsReq):
            code = (req.code or "").strip()
            module = (req.module or "").strip()
            function = (req.function or "").strip()
            name = " - ".join([v for v in [module, function] if v])
            if code and name:
                return f"{code} {name}"
            return code or name

        def __to_text(values: List[str]):
            return "；".join(values) if values else "无"

        def __query_feature_maps():
            feature_dict = {id0: set(), id1: set()}
            feature_name_dict = {id0: {}, id1: {}}
            rows: List[SrsReq] = db.session.execute(
                select(SrsReq).where(SrsReq.doc_id.in_([id0, id1])).order_by(SrsReq.doc_id, SrsReq.module, SrsReq.function, SrsReq.code)
            ).scalars().all()
            for req in rows:
                key = __feature_key(req)
                if not key:
                    continue
                feature_dict.setdefault(req.doc_id, set()).add(key)
                feature_name_dict.setdefault(req.doc_id, {}).setdefault(key, __feature_display(req) or key)
            return feature_dict, feature_name_dict

        sql = select(SrsDoc, Product).join(Product, SrsDoc.product_id == Product.id).where(SrsDoc.id.in_([id0, id1]))
        rows: List[Tuple[SrsDoc, Product]] = db.session.execute(sql).all()
        if not rows:
            return Resp.resp_err(msg=ts("msg_obj_null"))

        feature_dict, feature_name_dict = __query_feature_maps()
        features0 = feature_dict.get(id0) or set()
        features1 = feature_dict.get(id1) or set()
        added0_keys = sorted(features0 - features1)
        added1_keys = sorted(features1 - features0)
        added0 = [feature_name_dict.get(id0, {}).get(key, key) for key in added0_keys]
        added1 = [feature_name_dict.get(id1, {}).get(key, key) for key in added1_keys]
        removed0 = added1
        removed1 = added0

        infos = {}
        for row_srsdoc, row_prd in rows:
            infos[row_srsdoc.id] = dict(
                product_name=row_prd.name,
                product_type_code=row_prd.type_code,
                product_version=row_prd.full_version,
                product_udi=row_prd.udi,
                product_scope=row_prd.scope,
                srs_version=row_srsdoc.version,
            )
        info0 = infos.get(id0) or {}
        info1 = infos.get(id1) or {}

        results = []
        for column in ["product_name", "product_type_code", "product_version", "product_udi", "product_scope", "srs_version"]:
            value0 = info0.get(column) or ""
            value1 = info1.get(column) or ""
            same_flag = 1 if value0 == value1 else 0
            results.append(CompareObj(column_code=column, column_name=ts(f"sdsdiff.{column}"), same_flag=same_flag, values=[value0, value1]))

        results += [
            CompareObj(
                column_code="feature_added",
                column_name="新增功能",
                same_flag=1 if not added0 and not added1 else 0,
                values=[__to_text(added0), __to_text(added1)],
            ),
            CompareObj(
                column_code="feature_removed",
                column_name="减少功能",
                same_flag=1 if not removed0 and not removed1 else 0,
                values=[__to_text(removed0), __to_text(removed1)],
            ),
        ]
        return Resp.resp_ok(data=results)

    async def export_srs_doc(self, output, doc_id, *args, **kwargs):
        if Document is None or Pt is None or dox_enum is None:
            return
        from .serv_utils import docx_util
        def __norm_title(value: str):
            return re.sub(r"\s+", "", value or "")

        def __is_cover_section_title(title: str):
            txt = __norm_title(title)
            return txt in ["需求规格说明", "文件修订记录"]

        def __is_spec_title(title: str):
            return __norm_title(title) == "需求规格说明"

        def __is_rev_title(title: str):
            return __norm_title(title) == "文件修订记录"

        def __is_revision_label(value: str):
            return __norm_title(value) == "文件修订记录"

        def __is_imported_catalog_title(value: str):
            txt = (value or "").strip()
            if not txt:
                return False
            if __norm_title(txt) == "目录":
                return True
            # Word 原目录项常被导入成“1 介绍 1”“2.2 物理拓扑图 6”
            return re.match(r"^\d+(?:\.\d+)*\.?\s+\S.*\s+\d+$", txt) is not None

        def __is_imported_catalog_line(value: str):
            txt = (value or "").strip()
            if not txt:
                return False
            if __norm_title(txt) in ["需求规格说明", "文件修订记录", "目录"]:
                return True
            if __is_imported_catalog_title(txt):
                return True
            # 兼容带点线的目录行
            return re.match(r"^\d+(?:\.\d+)*\s+\S.*[.·…]{3,}\s*\d+$", txt) is not None

        def __is_imported_catalog_root(node: SrsNodeForm):
            title = __norm_title(getattr(node, "title", "") or "")
            text = str(getattr(node, "text", "") or "")
            return title == "导入正文" and "目录" in text and any(
                __is_imported_catalog_line(line) for line in text.splitlines()
            )

        def __strip_imported_catalog_suffix(value: str):
            txt = (value or "").strip()
            matched = re.match(r"^(\d+(?:\.\d+)*\.?\s+\S.*\S)\s+\d+$", txt)
            return matched.group(1).strip() if matched else txt

        def __strip_imported_catalog_lines(value: str):
            lines = [
                line for line in str(value or "").splitlines()
                if not __is_imported_catalog_line(line)
            ]
            return "\n".join(lines).strip()

        def __is_imported_placeholder_title(title: str):
            txt = (title or "").strip()
            return re.match(r"^导入(表格|图片)\d*$", txt) is not None

        def __is_imported_table_title(title: str):
            return re.match(r"^导入表格\d*$", (title or "").strip()) is not None

        def __is_table_caption_line(line: str):
            return re.match(r"^\s*表\s*\d+\s*", (line or "").strip()) is not None

        def __is_image_caption_line(line: str):
            return re.match(r"^\s*图\s*\d+\s*", (line or "").strip()) is not None

        def __save_image_caption_txt(docx: Document, text: str, font_size: float = 10.5):
            txt = (text or "").strip()
            if not txt:
                return
            p = docx.add_paragraph()
            p.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.first_line_indent = Pt(0)
            p.paragraph_format.line_spacing = 1.5
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            docx_util.fonted_txt(p, txt, font_size)

        def __insert_toc_field(docx: Document):
            # 使用Word目录域，支持点线+页码+可点击跳转（需Word更新域）
            p = docx.add_paragraph()
            if OxmlElement is None:
                return
            run_begin = p.add_run()
            fld_begin = OxmlElement("w:fldChar")
            fld_begin.set(qn("w:fldCharType"), "begin")
            fld_begin.set(qn("w:dirty"), "true")
            instr = OxmlElement("w:instrText")
            instr.set(qn("xml:space"), "preserve")
            instr.text = ' TOC \\o "1-3" \\h \\z \\u '
            fld_separate = OxmlElement("w:fldChar")
            fld_separate.set(qn("w:fldCharType"), "separate")
            run_end = p.add_run()
            fld_end = OxmlElement("w:fldChar")
            fld_end.set(qn("w:fldCharType"), "end")
            run_begin._r.append(fld_begin)
            run_begin._r.append(instr)
            run_begin._r.append(fld_separate)
            # Word在打开时会用真实目录结果替换这段占位文字
            p.add_run("目录将在打开文档后自动更新")
            run_end._r.append(fld_end)

        def __write_catalog_fallback(docx: Document, catalog_text: str):
            # 兜底目录：当Word未自动更新TOC域时，仍可看到目录内容
            for raw in (catalog_text or "").splitlines():
                line = (raw or "").strip()
                if not line:
                    continue
                matched = re.match(r"^(.*?)(?:[.·…]{3,}|\s+)(\d+)\s*$", line)
                title_part = (matched.group(1).strip() if matched else line)
                page_part = (matched.group(2).strip() if matched else "")
                number = self.__extract_heading_number(title_part)
                level = (number.count(".") + 1) if number else 1
                para = docx.add_paragraph()
                para.paragraph_format.first_line_indent = Pt(0)
                para.paragraph_format.left_indent = Pt(max(0, level - 1) * 18)
                para.paragraph_format.space_before = Pt(0)
                para.paragraph_format.space_after = Pt(0)
                para.paragraph_format.line_spacing = 1.5
                tab_pos = Pt(430)
                para.paragraph_format.tab_stops.add_tab_stop(
                    tab_pos,
                    dox_enum.text.WD_TAB_ALIGNMENT.RIGHT,
                    dox_enum.text.WD_TAB_LEADER.DOTS,
                )
                content = f"{title_part}\t{page_part}" if page_part else title_part
                docx_util.fonted_txt(para, content, font_size=10.5, bold=False)

        def __extract_imported_catalog_text(*nodes: SrsNodeForm):
            lines = []
            def walk(node: SrsNodeForm):
                if not node:
                    return
                title = str(getattr(node, "title", "") or "").strip()
                if __is_imported_catalog_title(title) and __norm_title(title) != "目录":
                    lines.append(title)
                for raw in str(getattr(node, "text", "") or "").splitlines():
                    line = (raw or "").strip()
                    if not line:
                        continue
                    if __norm_title(line) in ["需求规格说明", "文件修订记录", "目录"]:
                        continue
                    if __is_imported_catalog_line(line):
                        lines.append(line)
                for child in (getattr(node, "children", None) or []):
                    walk(child)
            for node in nodes:
                walk(node)
            return "\n".join(lines).strip()

        def __write_catalog_page(docx: Document, catalog_text: str):
            __write_center_section_title(docx, "目录")
            if catalog_text:
                __write_catalog_fallback(docx, catalog_text)
            else:
                __insert_toc_field(docx)

        def __write_center_section_title(docx: Document, title: str):
            p = docx.add_paragraph()
            p.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.CENTER
            # 需求规格说明使用二号字（22pt）
            font_size = 22.0 if __norm_title(title) == "需求规格说明" else 16.0
            docx_util.fonted_txt(p, title, font_size=font_size)

        def __add_blank_lines(docx: Document, line_count: int):
            for _ in range(max(0, line_count)):
                docx.add_paragraph("")

        def __is_revision_table(table):
            if not table:
                return False
            header_txt = "".join((getattr(h, "name", "") or "").strip() for h in (getattr(table, "headers", None) or []))
            keys = ["修改日期", "版本号", "修订说明", "修订人", "批准人"]
            return sum(1 for key in keys if key in header_txt) >= 3

        def __node_has_revision_marker(node: SrsNodeForm):
            for val in [getattr(node, "title", ""), getattr(node, "label", ""), getattr(node, "text", "")]:
                if __is_revision_label(val or ""):
                    return True
            return False

        async def __query_srs_reqs(type_code):
            resp = await srsreq_serv.list_srs_req(doc_id=doc_id, type_code=type_code, page_size=5000)
            reqs: List[SrsReq] = resp.data.rows or []
            if type_code == "2":
                headers = [TabHeader(code="srs_code", name="需求编号"), 
                        TabHeader(code="module", name="模块"), 
                        TabHeader(code="location", name="对应的章节")]
                rows = []
                for req in reqs:
                    row = dict()
                    row["srs_code"] = req.code
                    row["module"] = req.module
                    row["location"] = req.location
                    rows.append(row)
                table = Table(headers=headers, rows=rows)
                return table

            headers = [TabHeader(code="srs_code", name="需求编号"), 
                       TabHeader(code="module", name="模块"), 
                       TabHeader(code="function", name="功能"), 
                       TabHeader(code="sub_function", name="子功能")]
            rows = []
            for req in reqs:
                row = dict()
                row["srs_code"] = req.code
                row["module"] = req.module
                row["function"] = req.function
                row["sub_function"] = req.sub_function
                rows.append(row)
            table = Table(headers=headers, rows=rows)
            return table
        
        async def __query_srs_reqs_x():
            srs_types: List[SrsType] = db.session.execute(select(SrsType).where(SrsType.doc_id == doc_id).order_by(SrsType.id)).scalars().all()
            results = []
            for srs_type in srs_types:
                table = await __query_srs_reqs(srs_type.type_code)
                results.append(SrsNodeForm(label=srs_type.type_name, table=table))
            return results
        
        def __fix_chapter(p_title: str, nodes: List[SrsNodeForm]):
            chapter =re.search(r'(\d(\.\d)*)', p_title or "")
            chapter = chapter.group() if chapter else None
            chapter = f"{chapter}." if chapter else ""
            for idx, node in enumerate(nodes or []):
                if node.with_chapter == 1 and chapter and node.title:
                    node.title = f"{chapter}{idx+1} {node.title}"
                    __fix_chapter(node.title, node.children)
        
        async def __query_srs_reqds(p_title: str):
            reqds: List[SrsReqdObj] = (await srsreqd_serv.list_srs_reqd(doc_id=doc_id, page_size=2000)).data.rows
            parents = dict()
            for reqd in reqds:
                headers = [TabHeader(code="attr"), TabHeader(code="value")]
                rows = [
                    dict(attr="需求编号", value=reqd.code),
                    dict(attr="需求名称", value=reqd.name),
                    dict(attr="需求概述", value=reqd.overview),
                    dict(attr="主参加者", value=reqd.participant),
                    dict(attr="前置条件", value=reqd.pre_condition),
                    dict(attr="触发器", value=reqd.trigger),
                    dict(attr="工作流", value=reqd.work_flow),
                    dict(attr="后置条件", value=reqd.post_condition),
                    dict(attr="异常情况", value=reqd.exception),
                    dict(attr="约束", value=reqd.constraint),
                ]
                table = Table(headers=headers, rows=rows, show_header=0)
                p_node = find_parent(SrsNodeForm, [reqd.module, reqd.function], parents)
                with_chapter = 1 if reqd.sub_function else 0
                title = reqd.name if reqd.sub_function else None
                p_node.children.append(SrsNodeForm(with_chapter=with_chapter, title=title, table=table))
            p_nodes = [node for key, node in parents.items() if node.level == 0]
            __fix_chapter(p_title, p_nodes)
            return p_nodes

        async def __writenodes(nodes: List[SrsNodeForm], docx: Document, level: int = 0):
            font_def = 10.5
            font_size = font_def
            if level == 0 :
                font_size = 16.0
            elif level == 1:
                font_size = 14.0
            font_name = "宋体"
            for node in nodes or []:
                if __is_imported_catalog_root(node):
                    continue
                raw_node_title = getattr(node, "title", "") or ""
                if __is_imported_catalog_title(raw_node_title):
                    continue
                node_title_for_export = __strip_imported_catalog_suffix(raw_node_title)
                written_child_ids = set()
                is_catalog_root = level == 0 and __norm_title(node_title_for_export) == "目录"
                node_image_caption = ""
                if node_title_for_export:
                    if __is_imported_placeholder_title(node_title_for_export):
                        # 过滤系统中间占位标题，导出时不显示“导入表格X/导入图片X”等字样
                        pass
                    elif __is_image_caption_line(node_title_for_export) and node.img_url:
                        node_image_caption = node_title_for_export
                    elif is_catalog_root:
                        __write_catalog_page(docx, "")
                    elif level == 0 and __is_cover_section_title(node_title_for_export):
                        if __is_spec_title(node_title_for_export):
                            # 需求规格说明标题向上预留10行
                            __add_blank_lines(docx, 10)
                        __write_center_section_title(docx, node_title_for_export)
                        # 标题与其下方表格之间保留空白
                        __add_blank_lines(docx, 9 if __is_spec_title(node_title_for_export) else 2)
                    elif __is_imported_catalog_title(node_title_for_export) and not (node.text or node.table or node.img_url):
                        pass
                    else:
                        docx_util.save_title2docx(node_title_for_export, docx, level+1, font_size)
                if is_catalog_root:
                    # 目录页由TOC域生成，不再输出旧的目录文本和子节点
                    continue

                if node.srs_code:
                    # 若正文文本已包含同一需求编号，避免重复导出“需求编号”行
                    text_norm = (node.text or "").replace("：", ":")
                    code_norm = (node.srs_code or "").strip()
                    has_code_in_text = bool(code_norm and code_norm in text_norm and ("需求编号" in text_norm or "SRS" in text_norm))
                    if not has_code_in_text:
                        docx_util.save_txt2docx("需求编号：" + node.srs_code, docx, font_def)
                if node.label:
                    if __is_image_caption_line(node.label) and node.img_url:
                        node_image_caption = node_image_caption or node.label
                    else:
                        docx_util.save_txt2docx(node.label, docx, font_def)
                node_text_for_export = __strip_imported_catalog_lines(node.text)
                if node_text_for_export:
                    imported_table_children = [
                        child for child in (node.children or [])
                        if __is_imported_table_title(child.title) and child.table and child.table.headers
                    ]
                    imported_image_children = [
                        child for child in (node.children or [])
                        if (child.img_url and re.match(r"^导入图片\d*$", (child.title or "").strip()))
                    ]
                    lines = (node_text_for_export or "").splitlines()
                    has_caption = any(__is_table_caption_line(line) for line in lines)
                    has_image_caption = any(__is_image_caption_line(line) for line in lines)
                    has_req_list_pair = ("产品需求列表" in node_text_for_export and "其他需求列表" in node_text_for_export)
                    if imported_table_children and has_req_list_pair:
                        table_idx = 0
                        for raw_line in lines:
                            line = (raw_line or "").strip()
                            if not line:
                                continue
                            docx_util.save_txt2docx(line, docx, font_def)
                            if "产品需求列表" in line and table_idx < len(imported_table_children):
                                tab_node = imported_table_children[table_idx]
                                table_idx += 1
                                docx_util.save_tab2docx(tab_node.table, docx)
                                written_child_ids.add(id(tab_node))
                            elif "其他需求列表" in line and table_idx < len(imported_table_children):
                                tab_node = imported_table_children[table_idx]
                                table_idx += 1
                                docx_util.save_tab2docx(tab_node.table, docx)
                                written_child_ids.add(id(tab_node))
                        # 若该文档在SRS表管理里维护了“变更需求表”，在“产品需求/其他需求”后补充导出
                        # （导入Word文档场景通常没有 ref_type=srs_reqs 节点，因此需要在此处兜底）
                        if node.ref_type != RefTypes.srs_reqs.value:
                            extra_tables = await __query_srs_reqs_x()
                            for extra in extra_tables or []:
                                if extra.label:
                                    docx_util.save_txt2docx(extra.label, docx, font_def)
                                if extra.table and extra.table.headers:
                                    docx_util.save_tab2docx(extra.table, docx)
                    elif (imported_table_children and has_caption) or (imported_image_children and has_image_caption):
                        table_idx = 0
                        image_idx = 0
                        for raw_line in lines:
                            line = (raw_line or "").strip()
                            if not line:
                                continue
                            if __is_table_caption_line(line) and table_idx < len(imported_table_children):
                                docx_util.save_txt2docx(line, docx, font_def)
                                tab_node = imported_table_children[table_idx]
                                table_idx += 1
                                docx_util.save_tab2docx(tab_node.table, docx)
                                written_child_ids.add(id(tab_node))
                            elif __is_image_caption_line(line) and image_idx < len(imported_image_children):
                                img_node = imported_image_children[image_idx]
                                image_idx += 1
                                docx_util.save_img2docx(img_node.img_url, docx, mw=500, mh=500)
                                __save_image_caption_txt(docx, line, font_def)
                                written_child_ids.add(id(img_node))
                            else:
                                docx_util.save_txt2docx(line, docx, font_def)
                    else:
                        docx_util.save_txt2docx(node_text_for_export, docx, font_def)

                if node.img_url:
                    docx_util.save_img2docx(node.img_url, docx, mw=500, mh=500)
                    if node_image_caption:
                        __save_image_caption_txt(docx, node_image_caption, font_def)

                if node.ref_type == RefTypes.srs_reqs.value:
                    table = await __query_srs_reqs("1")
                    node1 = SrsNodeForm(label="产品需求列表:", table=table)
                    
                    table = await __query_srs_reqs("2")
                    node2 = SrsNodeForm(label="其他需求列表:", table=table)
                   
                    results = await __query_srs_reqs_x()
                    results = [node1, node2] + results
                    await __writenodes(results, docx, level + 1)
                elif node.ref_type == RefTypes.srs_reqds.value:
                    reqds = await __query_srs_reqds(node.title)
                    await __writenodes(reqds, docx, level + 1)   
                else:
                    if node.table and node.table.headers:
                        docx_util.save_tab2docx(node.table, docx)

                if node.children:
                    next_children = [child for child in node.children if id(child) not in written_child_ids]
                    await __writenodes(next_children, docx, level + 1)

        resp = await self.get_srs_doc(doc_id, with_tree=True)
        srs_doc: SrsDocObj = resp.data
        if srs_doc:
            docx = Document()
            # 打开Word时提示/自动更新目录域，保证目录内容与页码是最新
            if OxmlElement is not None:
                update_fields = OxmlElement("w:updateFields")
                update_fields.set(qn("w:val"), "true")
                docx.settings.element.append(update_fields)

            header_para = docx.sections[0].header.add_paragraph()
            header_para.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.RIGHT
            docx_util.fonted_txt(header_para, srs_doc.file_no)

            roots = srs_doc.content or []
            spec_root = next((n for n in roots if "需求规格说明" in __norm_title(n.title)), None)
            rev_root = next((n for n in roots if "文件修订记录" in __norm_title(n.title)), None)
            catalog_root = next((n for n in roots if "目录" in __norm_title(n.title)), None)
            import_root = next(
                (
                    n for n in roots
                    if __norm_title(getattr(n, "title", "") or "") == "导入正文"
                    and ("需求规格说明" in str(getattr(n, "text", "") or "") or "目录" in str(getattr(n, "text", "") or ""))
                ),
                None,
            )
            used_ids = {id(node) for node in [spec_root, rev_root, catalog_root, import_root] if node is not None}
            remaining_roots = [n for n in roots if id(n) not in used_ids]

            # 参考详细设计导出：兼容历史导入数据把“封面/修订记录/正文”都挂在根节点下的情况。
            spec_section_nodes = [spec_root] if spec_root else [SrsNodeForm(title="需求规格说明", children=[])]
            rev_section_nodes = [rev_root] if rev_root else []
            body_from_spec = []
            if spec_root:
                cover_node = SrsNodeForm(title="需求规格说明", children=[])
                cover_table_picked = False
                rev_nodes_from_spec = []
                for child in (spec_root.children or []):
                    if __node_has_revision_marker(child) or __is_revision_table(getattr(child, "table", None)):
                        rev_nodes_from_spec.append(child)
                        continue
                    if (not cover_table_picked) and getattr(child, "table", None) and not __is_revision_table(child.table):
                        cover_node.children.append(child)
                        cover_table_picked = True
                        continue
                    body_from_spec.append(child)

                spec_section_nodes = [cover_node]
                if (not rev_section_nodes) and rev_nodes_from_spec:
                    rev_section_nodes = [SrsNodeForm(title="文件修订记录", children=rev_nodes_from_spec)]

            if (not spec_root) and import_root:
                cover_node = SrsNodeForm(title="需求规格说明", children=[])
                rev_nodes_from_import = []
                cover_table_picked = False
                for child in (import_root.children or []):
                    if __node_has_revision_marker(child) or __is_revision_table(getattr(child, "table", None)):
                        rev_nodes_from_import.append(child)
                        continue
                    if (not cover_table_picked) and getattr(child, "table", None):
                        cover_node.children.append(child)
                        cover_table_picked = True
                spec_section_nodes = [cover_node]
                if (not rev_section_nodes) and rev_nodes_from_import:
                    rev_section_nodes = [SrsNodeForm(title="文件修订记录", children=rev_nodes_from_import)]

            if not rev_section_nodes:
                rev_section_nodes = [SrsNodeForm(title="文件修订记录", children=[])]

            remaining_roots = body_from_spec + remaining_roots
            imported_catalog_text = __extract_imported_catalog_text(*(roots or []))

            export_sections = [
                ("spec", spec_section_nodes),
                ("rev", rev_section_nodes),
                ("catalog", [catalog_root] if catalog_root else [SrsNodeForm(title="目录", children=[])]),
                ("body", remaining_roots),
            ]
            first_section = True
            for section_name, section_nodes in export_sections:
                if not section_nodes:
                    continue
                if not first_section:
                    docx.add_page_break()
                if section_name == "catalog":
                    __write_catalog_page(docx, imported_catalog_text)
                else:
                    await __writenodes(section_nodes, docx, level=0)
                if section_name == "rev":
                    # 第二页文件修订记录表格后保留5行空白
                    __add_blank_lines(docx, 5)
                first_section = False

            docx.save(output)
            output.seek(0)

    async def add_doc_file(self, doc_id: int, file):
        size, path = await save_file("srs_node_img", doc_id, file)
        return Resp.resp_ok(data=path)  

    async def list_doc_trace(self, id: int):
        def __build_trace_rule_from_srs_code(srs_code: str):
            code = str(srs_code or "").strip().upper()
            matched = re.match(r"^SRS-([A-Z]+)(\d+)-(\d+)$", code)
            if not matched:
                return None
            prefix = matched.group(1)
            major = matched.group(2)
            minor = matched.group(3)
            if len(major) < 2:
                return None
            if_code = major[-2:]
            minor_int = str(int(minor)) if minor.isdigit() else minor
            minor3 = minor.zfill(3)
            return {
                "if_code": if_code,  # IF00 / IF06
                "unit_group": minor3,  # 005 / 003
                "sis_prefix": f"SDS-IF{if_code}-{prefix}{major}{minor_int}-",  # SDS-IF00-RCN3005-
                "unit_prefix": f"TU{if_code}-{minor3}-",  # TU00-005-
            }

        def __query_rcms(srs_ids: list[int]):
            sql = select(ReqRcm, Rcm).join(Rcm, ReqRcm.rcm_id == Rcm.id).where(ReqRcm.req_id.in_(srs_ids))
            rows: list[ReqRcm, Rcm] = db.session.execute(sql).all()
            req_rcms = dict()
            for row_req, row_rcm in rows:
                rcms = req_rcms.get(row_req.req_id) or []
                rcms.append(row_rcm)
                req_rcms[row_req.req_id] = rcms
            return req_rcms

        def __query_reqd_text_rcm_codes(req_ids: list[int]):
            if not req_ids:
                return {}
            sql = select(SrsReqd).where(SrsReqd.req_id.in_(req_ids))
            rows: List[SrsReqd] = db.session.execute(sql).scalars().all()
            result: dict[int, list[str]] = {}
            for row in rows:
                merged_text = "\n".join([
                    str(getattr(row, "name", "") or ""),
                    str(getattr(row, "overview", "") or ""),
                    str(getattr(row, "participant", "") or ""),
                    str(getattr(row, "pre_condition", "") or ""),
                    str(getattr(row, "trigger", "") or ""),
                    str(getattr(row, "work_flow", "") or ""),
                    str(getattr(row, "post_condition", "") or ""),
                    str(getattr(row, "exception", "") or ""),
                    str(getattr(row, "constraint", "") or ""),
                ])
                picked = []
                for hit in re.findall(r"RCM[\s\-_]*\d{2,4}", merged_text, flags=re.IGNORECASE):
                    code_norm = re.sub(r"[\s\-_]", "", self.__normalize_rcm_code(hit))
                    if code_norm.startswith("RCM") and code_norm[3:].isdigit():
                        picked.append(code_norm)
                dedup = list(dict.fromkeys(picked))
                if dedup:
                    result[int(row.req_id)] = dedup
            return result

        def __query_node_rcm_codes(doc_id: int, srs_codes: list[str]):
            if not doc_id or not srs_codes:
                return {}
            srs_set = {str(code or "").strip().upper() for code in (srs_codes or []) if str(code or "").strip()}
            sql = select(
                SrsNode.n_id,
                SrsNode.p_id,
                SrsNode.srs_code,
                SrsNode.rcm_codes,
                SrsNode.title,
                SrsNode.label,
                SrsNode.text,
                SrsNode.table,
            ).where(SrsNode.doc_id == doc_id)
            rows = db.session.execute(sql).all()
            node_map = {
                int(n_id): {
                    "p_id": int(p_id or 0),
                    "srs_code": str(srs_code or "").strip().upper(),
                    "rcm_codes": str(rcm_codes or ""),
                    "title": str(title or ""),
                    "label": str(label or ""),
                    "text": str(text or ""),
                    "table": table,
                }
                for n_id, p_id, srs_code, rcm_codes, title, label, text, table in rows
            }

            def resolve_srs_code(start_nid: int) -> str:
                cur = node_map.get(start_nid)
                safety = 0
                while cur and safety < 200:
                    code = str(cur.get("srs_code") or "").strip().upper()
                    if code:
                        return code
                    pid = int(cur.get("p_id") or 0)
                    if pid <= 0:
                        break
                    cur = node_map.get(pid)
                    safety += 1
                return ""

            result: dict[str, list[str]] = {}
            for n_id, _p_id, own_code, raw_codes, title, label, text, table in rows:
                merged_text = "\n".join([
                    str(title or ""),
                    str(label or ""),
                    str(text or ""),
                    json.dumps(table, ensure_ascii=False) if table is not None else "",
                ])
                parts = [str(item or "").strip() for item in re.split(r"[,，;；\s]+", str(raw_codes or "")) if str(item or "").strip()]
                if not parts:
                    picked = []
                    for hit in re.findall(r"RCM[\s\-_]*\d{2,4}", merged_text, flags=re.IGNORECASE):
                        code_norm = re.sub(r"[\s\-_]", "", self.__normalize_rcm_code(hit))
                        if code_norm.startswith("RCM") and code_norm[3:].isdigit():
                            picked.append(code_norm)
                    parts = list(dict.fromkeys(picked))
                if not parts:
                    continue
                # 兜底：节点正文中显式出现了 SRS 编号时，直接按“编号->RCM”关联
                mentioned_srs_codes = []
                for hit in re.findall(r"SRS[\s\-]*[A-Z]+[\s\-]*\d{2,4}\s*-\s*\d{3}", merged_text, flags=re.IGNORECASE):
                    code_norm = self.__normalize_srs_code(re.sub(r"\s+", "", hit).replace("--", "-"))
                    if code_norm and code_norm not in mentioned_srs_codes:
                        mentioned_srs_codes.append(code_norm)
                for mcode in mentioned_srs_codes:
                    if srs_set and mcode not in srs_set:
                        continue
                    existed = result.get(mcode) or []
                    result[mcode] = list(dict.fromkeys(existed + parts))
                srs_code = str(own_code or "").strip().upper() or resolve_srs_code(int(n_id))
                if not srs_code:
                    continue
                if srs_set and srs_code not in srs_set:
                    continue
                existed = result.get(srs_code) or []
                merged = list(dict.fromkeys(existed + parts))
                result[srs_code] = merged
            return result
        
        def __query_tests(product_id: int) -> dict:
            def __normalize_stage(stage: str) -> str:
                txt = str(stage or "").strip()
                if "单元" in txt:
                    return "单元测试"
                if "集成" in txt:
                    return "集成测试"
                if "系统" in txt:
                    return "系统测试"
                if "用户" in txt:
                    return "用户测试"
                return txt

            def __to_srs_code(raw_code: str) -> list[str]:
                code = str(raw_code or "").strip().upper()
                if not code:
                    return []
                candidates: list[str] = []
                # 兼容历史接口编码：SDS-IF{xx}-RUS{yy}-...
                matched = re.match(r"SDS-IF(\d+)-RUS(\d+)-\d+", code)
                if matched:
                    candidates.append(f"SRS-RUS{matched.group(1)}-{matched.group(2)}")
                # 兼容接口编码：SDS-IF00-RCN300-005 / SDS-IF00-XXX...
                matched2 = re.match(r"SDS-IF\d+-([A-Z0-9]+-\d+)$", code)
                if matched2:
                    candidates.append(f"SRS-{matched2.group(1)}")
                    # 兼容压缩段：SDS-IF00-RCN3005-001 -> SRS-RCN300-005
                    seg = matched2.group(1)
                    seg_parts = seg.split("-")
                    if len(seg_parts) == 2:
                        left, right = seg_parts
                        m3 = re.match(r"^([A-Z]+)(\d{3,})(\d)$", left)
                        if m3:
                            req_group = str(m3.group(3) or "").zfill(3)
                            candidates.append(f"SRS-{m3.group(1)}{m3.group(2)}-{req_group}")
                # 若本身已是 SRS 编号也接受
                if code.startswith("SRS-"):
                    candidates.append(code)
                # 去重并保持顺序
                seen = set()
                uniq = []
                for item in candidates:
                    if item and item not in seen:
                        seen.add(item)
                        uniq.append(item)
                return uniq

            sql = select(TestCase, TestSet).join(TestSet, TestCase.set_id == TestSet.id).where(TestSet.product_id == product_id).order_by(TestCase.code)
            rows: List[Tuple[TestCase, TestSet]] = db.session.execute(sql).all()
            all_tests = dict()
            stage_code_index = dict()
            # 单元测试用例编号 -> 接口编号(SDS-IF...) 映射
            unit_case_to_sis = dict()
            for row_test, row_set in rows:
                norm_stage = __normalize_stage(row_set.stage)
                all_tests.setdefault(row_test.srs_code, {}).setdefault(norm_stage, []).append(row_test)
                code = str(row_test.code or "").strip().upper()
                if code:
                    stage_code_index.setdefault(norm_stage, []).append(code)
                code = str(row_test.code or "").strip().upper()
                srs_code_raw = str(row_test.srs_code or "").strip().upper()
                if code and srs_code_raw.startswith("SDS-IF"):
                    unit_case_to_sis.setdefault(code, set()).add(srs_code_raw)
            
            test_codes = dict()
            for srs_code, test_data in all_tests.items():
                for stage, items in test_data.items():
                    tests = list({item.code: item.code for item in items}.keys())
                    tests = [tests[0], tests[len(tests)-1]] if len(tests) > 1 else tests[:1]
                    test_codes.setdefault(srs_code, {}).setdefault(stage, []).extend(tests)

            req_pairs = dict()
            sds_uset = dict()
            for row_test, row_set in rows:
                src_code = str(row_test.srs_code or "").strip().upper()
                if not src_code:
                    continue
                # 接口编号列只取“单元测试”阶段中的接口测试编码（SDS-IF...）
                norm_stage = __normalize_stage(getattr(row_set, "stage", "") or "")
                if norm_stage != "单元测试":
                    continue
                if not src_code.startswith("SDS-IF"):
                    continue
                for srs_code in __to_srs_code(src_code):
                    uset = sds_uset.setdefault(srs_code, set())
                    if src_code not in uset:
                        uset.add(src_code)
                        req_pairs.setdefault(srs_code, []).append((src_code, row_test.code))

            # 补充链路：通过“单元测试用例编号”反查接口编号，填充到对应 SRS 需求
            for srs_code, test_data in all_tests.items():
                srs_code_norm = str(srs_code or "").strip().upper()
                if not srs_code_norm.startswith("SRS-"):
                    continue
                unit_items = test_data.get("单元测试") or []
                uset = sds_uset.setdefault(srs_code_norm, set())
                for item in unit_items:
                    unit_code = str(getattr(item, "code", "") or "").strip().upper()
                    if not unit_code:
                        continue
                    sis_codes = sorted(unit_case_to_sis.get(unit_code) or [])
                    for sis_code in sis_codes:
                        if sis_code in uset:
                            continue
                        uset.add(sis_code)
                        req_pairs.setdefault(srs_code_norm, []).append((sis_code, unit_code))

            for srs_code, codes in req_pairs.items():
                codes.sort(key=lambda x: x[0])
            for stage, codes in stage_code_index.items():
                uniq = list(dict.fromkeys(codes))
                stage_code_index[stage] = uniq
            all_stage_codes = []
            for _, codes in stage_code_index.items():
                all_stage_codes.extend(codes)
            stage_code_index["__all__"] = list(dict.fromkeys(all_stage_codes))
            return test_codes, req_pairs, stage_code_index
        
        def __resort_rows(rows: List[Tuple[SdsTrace, SdsDoc, SrsReq]], srsdoc_id: int):
            # 按 SRS 导入后的原始顺序（req_id 升序）返回，确保“从安装包打开SRS第一个开始”
            sortable_rows = sorted(rows, key=lambda row: (getattr(row[2], "id", 0) or 0))
            results = []
            exist_codes = set()
            for row in sortable_rows:
                code = (row[2].code or "").strip()
                if code and code not in exist_codes:
                    exist_codes.add(code)
                    results.append(row)
            return results
     
        sql = select(SdsDoc, SrsDoc).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id).where(SrsDoc.id == id).order_by(desc(SdsDoc.id)).limit(1)
        row_sdsdoc, row_srsdoc = db.session.execute(sql).first() or (None, None)
        if not row_sdsdoc:
            return Resp.resp_ok(data=[])
        
        sql = select(SdsTrace, SdsDoc, SrsReq).where(SdsTrace.doc_id==SdsDoc.id, SdsTrace.req_id==SrsReq.id, SdsDoc.srsdoc_id==SrsReq.doc_id)
        sql = sql.where(SdsDoc.id == row_sdsdoc.id)
        rows: List[Tuple[SdsTrace, SdsDoc, SrsReq]] = db.session.execute(sql).all()
        rows = __resort_rows(rows, row_sdsdoc.srsdoc_id)
        # 以当前SDS文档节点为准，建立“设计编号 -> 章节标题”映射，避免导出章节名错配
        sds_code_chapter_map = {}
        node_rows = db.session.execute(
            select(SdsNode.sds_code, SdsNode.title).where(SdsNode.doc_id == row_sdsdoc.id)
        ).all()
        for code_raw, title_raw in node_rows:
            code = str(code_raw or "").strip().upper()
            if not code:
                continue
            title = str(title_raw or "").strip()
            # 章节标题通常是“3 DataProcessing”，导出时去掉前缀序号
            title = re.sub(r"^\d+\s*[\.、\-]?\s*", "", title).strip()
            if title and code not in sds_code_chapter_map:
                sds_code_chapter_map[code] = title
        req_ids = [row.id for _, _, row in rows]
        req_rcms = __query_rcms(req_ids)
        reqd_text_rcm_codes = __query_reqd_text_rcm_codes(req_ids)
        node_rcm_codes = __query_node_rcm_codes(row_srsdoc.id, [str(row.code or "").strip().upper() for _, _, row in rows])
        req_tests, req_pairs, stage_code_index = __query_tests(row_srsdoc.product_id)
        row_product = db.session.execute(select(Product).where(Product.id == row_srsdoc.product_id)).scalars().first()
        product_code = str(getattr(row_product, "product_code", "") or "").strip()
        fixed_note_text = self.__build_trace_fixed_note_text(product_code)
        results = []
        for row_trace, _, row in rows:
            rcms: List[Rcm] = req_rcms.get(row.id) or []
            relation_rcm_codes = [rcm.code for rcm in rcms]
            text_rcm_codes = reqd_text_rcm_codes.get(int(row.id)) or []
            node_rcm_fallback = node_rcm_codes.get(str(row.code or "").strip().upper()) or []
            rcm_codes = list(dict.fromkeys(relation_rcm_codes + text_rcm_codes + node_rcm_fallback))
            if not rcm_codes:
                rcm_codes = []
            rcm_flag = True if rcm_codes else False
            sds_code_norm = str(row_trace.sds_code or "").strip().upper()
            chapter = sds_code_chapter_map.get(sds_code_norm) or ""
            if not chapter:
                chapter = row_trace.chapter or row.sub_function or row.function or row.module or ""
                chapter = NAME_DICT.get(chapter) or chapter
                chapter = chapter if row.type_code == "2" else "NeoViewer"

            test_data = req_tests.get(row.code) or {}

            tests_unit = test_data.get("单元测试") or []
            tests_integ = test_data.get("集成测试") or []
            tests_sys = test_data.get("系统测试") or []
            tests_user = test_data.get("用户测试") or []

            srs_pairs = req_pairs.get(row.code) or []
            sis_codes = [sis[0] for sis in srs_pairs]
            test_codes = [sis[1] for sis in srs_pairs]

            # 关键规则：SRS-RCN300-005 -> IF00 + RCN3005（由 SRS 编号反推并过滤）
            trace_rule = __build_trace_rule_from_srs_code(row.code)
            if trace_rule:
                # 精准匹配：若不满足规则，直接清空，不保留旧值
                pair_filtered = [
                    (str(s or ""), str(t or ""))
                    for s, t in srs_pairs
                    if str(s or "").startswith(trace_rule["sis_prefix"])
                ]
                sis_codes = [item[0] for item in pair_filtered]
                test_codes = [item[1] for item in pair_filtered]

                # 单元测试记录按 TU{IF}-{group}- 严格过滤
                unit_filtered = [
                    str(code or "")
                    for code in (tests_unit or [])
                    if str(code or "").startswith(trace_rule["unit_prefix"])
                ]
                tests_unit = test_codes if test_codes else unit_filtered
                # 系统测试严格匹配：先过滤当前值，不命中再从“系统测试阶段/全量用例”反查
                sys_prefix = f"TS{trace_rule['if_code']}-{trace_rule['unit_group']}-"
                sys_filtered = [
                    str(code or "")
                    for code in (tests_sys or [])
                    if str(code or "").startswith(sys_prefix)
                ]
                if not sys_filtered:
                    sys_stage = stage_code_index.get("系统测试") or []
                    sys_filtered = [code for code in sys_stage if str(code or "").startswith(sys_prefix)]
                if not sys_filtered:
                    sys_all = stage_code_index.get("__all__") or []
                    sys_filtered = [code for code in sys_all if str(code or "").startswith(sys_prefix)]
                tests_sys = [sys_filtered[0], sys_filtered[-1]] if len(sys_filtered) > 1 else sys_filtered

            row_srs_code = str(row.code or "").strip().upper()
            note = fixed_note_text if row_srs_code == self.TRACE_FIXED_NOTE_CODE else None
            result = dict(
                srs_code=row.code,
                rcm_flag=rcm_flag,

                sds_code=row_trace.sds_code,

                sis_codes=sis_codes,
                test_codes=test_codes,

                chapter=chapter,

                tests_unit=tests_unit,
                tests_integ=tests_integ,
                tests_sys=tests_sys,
                tests_user=tests_user,

                rcm_codes=rcm_codes,

                note=note
            )
            results.append(result)
        return Resp.resp_ok(data=results)

    export_columns = [
        "srs_code",
        "rcm_flag",

        "sds_code",

        "sis_codes",

        "tests_unit",
        "tests_integ",
        "tests_sys",
        "tests_user",

        "rcm_codes",

        "note"
    ]

    arr_columns = set(["tests_integ", "tests_sys", "tests_user"])

    async def export_doc_trace(self, output, id: int):
        def __slash(v):
            txt = str(v or "").strip()
            return txt if txt else "/"

        resp = await self.list_doc_trace(id)

        temp_path = os.path.join(os.path.dirname(__file__), "temp_srs_doc_trace.xlsx")
        wb = load_workbook(temp_path)
        ws = wb[wb.sheetnames[0]]

        all_subs = 0
        for ridx, obj in enumerate(resp.data or [], 4):
            srs_code = __slash(obj.get("srs_code"))
            rcm_flag = ts("yes") if obj.get("rcm_flag") else ts("no")
            sds_code_raw = str(obj.get("sds_code") or "").strip()
            chapter_raw = str(obj.get("chapter") or "").strip()
            hide_chapter_codes = {
                "SDS-RCN300-001",
                "SDS-RCN300-002",
                "SDS-RCN300-003",
                "SDS-RCN300-008",
                "SDS-RCN300-009",
                "SDS-RCN300-010",
            }
            if sds_code_raw in hide_chapter_codes or not chapter_raw:
                sds_code = sds_code_raw
            else:
                sds_code = f"{sds_code_raw}（{chapter_raw}）"
            sis_codes = obj.get("sis_codes") or []

            test_codes = obj.get("test_codes") or []
            tests_unit = " ~ ".join(obj.get("tests_unit") or [])

            tests_integ = " ~ ".join(obj.get("tests_integ") or [])
            tests_sys = " ~ ".join(obj.get("tests_sys") or [])
            tests_user = " ~ ".join(obj.get("tests_user") or [])
            rcm_codes = "\n".join(obj.get("rcm_codes") or [])
            note_raw = str(obj.get("note") or "").strip()
            note = "\n".join([item.strip() for item in note_raw.split("、") if item and item.strip()]) if note_raw else ""

            if len(sis_codes) <= 1:
                sis_code = sis_codes[0] if sis_codes else ""
                tests_unit = test_codes[0] if test_codes else tests_unit
                ws.append([
                    srs_code,
                    __slash(rcm_flag),
                    __slash(sds_code),
                    __slash(sis_code),
                    __slash(tests_unit),
                    __slash(tests_integ),
                    __slash(tests_sys),
                    __slash(tests_user),
                    __slash(rcm_codes),
                    __slash(note),
                ])
            else:
                temp_subs = len(sis_codes) - 1
                for idx, sis_code in enumerate(sis_codes):
                    test_code = test_codes[idx] if idx < len(test_codes) else ""
                    ws.append([
                        srs_code,
                        __slash(rcm_flag),
                        __slash(sds_code),
                        __slash(sis_code),
                        __slash(test_code),
                        __slash(tests_integ),
                        __slash(tests_sys),
                        __slash(tests_user),
                        __slash(rcm_codes),
                        __slash(note),
                    ])
                r_idx0 = ridx + all_subs
                r_idx1 = ridx + all_subs + temp_subs
                all_subs += temp_subs
                ws.merge_cells(f"A{r_idx0}:A{r_idx1}")
                ws.merge_cells(f"B{r_idx0}:B{r_idx1}")
                ws.merge_cells(f"C{r_idx0}:C{r_idx1}")

                ws.merge_cells(f"F{r_idx0}:F{r_idx1}")
                ws.merge_cells(f"G{r_idx0}:G{r_idx1}")
                ws.merge_cells(f"H{r_idx0}:H{r_idx1}")
                ws.merge_cells(f"I{r_idx0}:I{r_idx1}")
                ws.merge_cells(f"J{r_idx0}:J{r_idx1}")

        align = Alignment(vertical='top')
        for row in ws.iter_rows():
            for cell in row:
                cell.alignment = align
        # RCM列（I列）按行展示
        for row_idx in range(4, ws.max_row + 1):
            cell = ws[f"I{row_idx}"]
            cell.alignment = Alignment(vertical='top', wrap_text=True)
        # 备注列（J列）按行展示
        for row_idx in range(4, ws.max_row + 1):
            cell = ws[f"J{row_idx}"]
            cell.alignment = Alignment(vertical='top', wrap_text=True)
        wb.save(output)
        output.seek(0)
        
