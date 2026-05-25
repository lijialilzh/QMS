import logging
import re
import sys
import json
from typing import Dict, List, Optional, Tuple, Union
from sqlalchemy import select, or_, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
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
        placeholders = {"", "/", "\\", "-", "--", "—", "N/A", "n/a", "无", "暂无"}
        for val in [sub_function, function, module]:
            txt = str(val or "").strip()
            if txt and txt not in placeholders:
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
        composed = cls.compose_srs_req_chapter(row_req, hierarchy_map=hierarchy_map, code=req_code, **fields)
        stored = (stored_chapter or "").strip()
        stored_lines = [ln.strip() for ln in re.split(r"[\r\n]+", stored) if ln and ln.strip()]
        code = (req_code or "").strip().upper()
        if code in FIXED_RCN300_TRACES or len(stored_lines) > 1:
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
        """追溯表「需求/代码」列：单行需求用层级字段，固定多行映射保留各行原文。"""
        req_code = srs_code or (getattr(row_req, "code", None) if row_req is not None else None)
        composed = cls.compose_srs_req_chapter(row_req, hierarchy_map=hierarchy_map, code=req_code, **fields)
        stored_lines = [ln.strip() for ln in re.split(r"[\r\n]+", (stored_chapter or "")) if ln and ln.strip()]
        code = (req_code or "").strip().upper()
        if code in FIXED_RCN300_TRACES and stored_lines:
            return stored_lines
        if composed:
            return [composed]
        return stored_lines or [""]

    def __ensure_sds_traces(self, prod_id: int = None, doc_id: int = None):
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
                hierarchy_map = self.__load_srs_req_hierarchy_map(srs_doc_id)
                reqs = db.session.execute(
                    select(SrsReq.id, SrsReq.code, SrsReq.module, SrsReq.function, SrsReq.sub_function)
                    .where(SrsReq.doc_id == srs_doc_id)
                    .where(SrsReq.type_code != "reqd")
                ).all()
                if not reqs:
                    continue
                values = []
                fixed_values = []
                for req_id, code, module, function, sub_function in reqs:
                    fields = self.hierarchy_for_req(None, hierarchy_map, code=code)
                    if not fields.get("module") and not fields.get("function") and not fields.get("sub_function"):
                        fields = {"module": module, "function": function, "sub_function": sub_function}
                    fixed_trace = FIXED_RCN300_TRACES.get((code or "").strip().upper())
                    if fixed_trace:
                        fixed_values.append(
                            dict(
                                doc_id=sds_doc_id,
                                req_id=req_id,
                                sds_code="\n".join([item[0] for item in fixed_trace]),
                                chapter="\n".join([item[1] for item in fixed_trace]),
                                location="\n".join([item[2] for item in fixed_trace]),
                            )
                        )
                        continue
                    values.append(
                        dict(
                            doc_id=sds_doc_id,
                            req_id=req_id,
                            sds_code=(code or "").replace("SRS", "SDS"),
                            chapter=self.compose_srs_req_chapter(**fields) or fields.get("function") or fields.get("module") or "/",
                        )
                    )
                if values:
                    insert_stmt = pg_insert(SdsTrace).values(values)
                    db.session.execute(
                        insert_stmt.on_conflict_do_update(
                            index_elements=["doc_id", "req_id"],
                            set_=dict(
                                sds_code=insert_stmt.excluded.sds_code,
                                chapter=insert_stmt.excluded.chapter,
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
        txt = re.sub(r"^[\d一二三四五六七八九十零]+([.\-、）)\s]+[\d一二三四五六七八九十零]*)*", "", txt)
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
                for key, value in form.dict().items():
                    logger.info("update: %s: %s", key, value)
                    if key == "id" or value is None:
                        continue
                    setattr(row, key, value)
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

    def __resort_rows(self, rows: List[Tuple[SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product]]):
        order_map = self.__query_srs_doc_req_order(list({row_srsdoc.id for _, _, _, _, row_srsdoc, _ in rows if row_srsdoc}))
        sorted_rows = []
        for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            type_id = row_type.id if row_type else sys.maxsize
            type_id = -1 if row_req.type_code == "1" else type_id
            type_id = 0 if row_req.type_code == "2" else type_id
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
            return (int(matched.group(1)), int(matched.group(2)), txt)
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
        if not prod_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))

        sql = sql.order_by(desc(Product.id), desc(SdsDoc.id), SrsReq.code)
        rows: List[Tuple[SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product]] = db.session.execute(sql).all()
        rows = self.__resort_rows(rows)
        total = len(rows)
        rows = rows[page_size * page_index: page_size * (page_index + 1)]
        req_ids = [row_req.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows]
        type_names = self.__query_srs_types(req_ids)
        doc_ids = list(set([row_sdsdoc.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows]))
        doc_trees = self.__query_doc_tree(doc_ids)
        doc_sds_locations = {d_id: self.__build_sds_location_map(tree) for d_id, tree in doc_trees.items()}
        virtual_sds_locations = {} if from_sync else self.__build_virtual_location_map(rows, doc_trees, doc_sds_locations)
        srs_doc_ids = list(set([row_srsdoc.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows if row_srsdoc]))
        hierarchy_by_srs_doc = {sid: self.__load_srs_req_hierarchy_map(sid) for sid in srs_doc_ids}
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
    