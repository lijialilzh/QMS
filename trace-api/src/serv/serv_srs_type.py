import json
import logging
import re
from typing import Dict, List, Set
from sqlalchemy import select, delete, func
from ..model.srs_req import SrsReq
from ..model.srs_type import SrsType
from ..model.srs_doc import SrsNode
from ..model.srs_reqd import SrsReqd
from ..model.sds_trace import SdsTrace
from ..model.sds_reqd import SdsReqd
from ..obj.tobj_srs_type import SrsTypeForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..utils import get_uuid
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)

_KV_FIELD_LABELS = {
    "需求编号", "需求名称", "需求概述", "主参加者", "前置条件",
    "触发器", "工作流", "事件流", "后置条件", "异常情况", "约束",
}


class Server(object):

    @staticmethod
    def __normalize_type_name(value: str):
        return re.sub(r"\s+", "", str(value or "").replace("：", ":").rstrip(":").strip())

    @staticmethod
    def __normalize_srs_code(value: str) -> str:
        return re.sub(r"\s+", "", str(value or "")).upper()

    @staticmethod
    def __chapter_root_no(title: str) -> str:
        matched = re.match(r"^(\d+)", str(title or "").strip())
        return matched.group(1) if matched else ""

    def __parse_node_table(self, table):
        if isinstance(table, str):
            try:
                table = json.loads(table)
            except Exception:
                return None
        return table if isinstance(table, dict) else None

    def __extract_code_from_node_table(self, table) -> str:
        table = self.__parse_node_table(table)
        if not table:
            return ""
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        if len(headers) < 2 or not isinstance(rows, list):
            return ""
        left_code = headers[0].get("code") if isinstance(headers[0], dict) else ""
        right_code = headers[1].get("code") if isinstance(headers[1], dict) else ""
        right_name = headers[1].get("name") if isinstance(headers[1], dict) else ""
        code = self.__normalize_srs_code(str(right_name or ""))
        if code.startswith("SRS-"):
            return code
        if not left_code or not right_code:
            return ""
        for row in rows:
            if not isinstance(row, dict):
                continue
            left_text = str(row.get(left_code, "") or "").strip()
            if "需求编号" not in left_text:
                continue
            value = self.__normalize_srs_code(str(row.get(right_code, "") or ""))
            if value.startswith("SRS-"):
                return value
        return ""

    def __is_functional_kv_table(self, table) -> bool:
        table = self.__parse_node_table(table)
        if not table:
            return False
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        if len(headers) != 2 or not isinstance(rows, list) or len(rows) < 3:
            return False
        left_code = headers[0].get("code") if isinstance(headers[0], dict) else ""
        hits = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            label = re.sub(r"\s+", "", str(row.get(left_code, "") or ""))
            if label in _KV_FIELD_LABELS:
                hits += 1
        return hits >= 3

    def __is_under_chapter_seven(self, node: SrsNode, node_by_nid: Dict[int, SrsNode]) -> bool:
        current = node
        seen: Set[int] = set()
        while current and current.n_id not in seen:
            seen.add(current.n_id)
            if self.__chapter_root_no(current.title) == "7":
                return True
            pid = int(getattr(current, "p_id", 0) or 0)
            if not pid:
                return False
            current = node_by_nid.get(pid)
        return False

    def __extract_node_req_code(self, node: SrsNode) -> str:
        code = self.__normalize_srs_code(getattr(node, "srs_code", "") or "")
        if code:
            return code
        return self.__extract_code_from_node_table(node.table)

    def __is_req_detail_node(self, node: SrsNode) -> bool:
        label = str(getattr(node, "label", "") or "")
        if label == "__auto_req_detail":
            return True
        return self.__is_functional_kv_table(node.table)

    def __prune_empty_req_chapter_shells(self, doc_id: int, node_by_nid: Dict[int, SrsNode]):
        changed = True
        while changed:
            changed = False
            child_counts: Dict[int, int] = {}
            for node in node_by_nid.values():
                pid = int(getattr(node, "p_id", 0) or 0)
                if pid:
                    child_counts[pid] = child_counts.get(pid, 0) + 1
            to_delete: List[int] = []
            for node in list(node_by_nid.values()):
                if not self.__is_under_chapter_seven(node, node_by_nid):
                    continue
                has_children = child_counts.get(node.n_id, 0) > 0
                has_content = bool(
                    (getattr(node, "srs_code", None) or "").strip() or
                    (getattr(node, "text", None) or "").strip() or
                    self.__parse_node_table(node.table)
                )
                if has_children or has_content:
                    continue
                label = str(getattr(node, "label", "") or "")
                title = str(getattr(node, "title", "") or "").strip()
                if label == "__auto_req_group" or re.match(r"^7\.\d+", title):
                    to_delete.append(node.n_id)
            if not to_delete:
                break
            changed = True
            db.session.execute(
                delete(SrsNode).where(SrsNode.doc_id == doc_id, SrsNode.n_id.in_(to_delete))
            )
            for n_id in to_delete:
                node_by_nid.pop(n_id, None)

    def __table_contains_any_code(self, table, codes: Set[str]) -> bool:
        table = self.__parse_node_table(table)
        if not table or not codes:
            return False
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        if not headers or not isinstance(rows, list):
            return False
        code_cols = []
        for header in headers:
            if not isinstance(header, dict):
                continue
            name = re.sub(r"\s+", "", str(header.get("name") or "")).lower()
            code = str(header.get("code") or "")
            if "需求编号" in name or name in ("srscode", "code"):
                code_cols.append(code)
        for row in rows:
            if not isinstance(row, dict):
                continue
            for col in code_cols:
                value = self.__normalize_srs_code(str(row.get(col, "") or ""))
                if value in codes:
                    return True
        return False

    def __strip_change_table_title_heading(self, value: str) -> str:
        txt = self.__normalize_type_name(value)
        return re.sub(
            r"^\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            "",
            txt,
        ).strip()

    def __matches_change_table_title(self, left: str, right: str) -> bool:
        """与 serv_srs_doc.__change_table_title_matches 一致：只识别同一张表，不做子串误匹配。"""
        left_key = self.__normalize_type_name(left)
        right_key = self.__normalize_type_name(right)
        if not left_key or not right_key:
            return False
        if left_key == right_key:
            return True
        left_body = self.__normalize_type_name(self.__strip_change_table_title_heading(left))
        right_body = self.__normalize_type_name(self.__strip_change_table_title_heading(right))
        return bool(left_body and right_body and left_body == right_body)

    def __table_row_codes(self, table) -> Set[str]:
        table = self.__parse_node_table(table)
        if not table:
            return set()
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        if not headers or not isinstance(rows, list):
            return set()
        code_cols = []
        for header in headers:
            if not isinstance(header, dict):
                continue
            name = re.sub(r"\s+", "", str(header.get("name") or "")).lower()
            code = str(header.get("code") or "")
            if "需求编号" in name or name in ("srscode", "code"):
                code_cols.append(code)
        found: Set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            for col in code_cols:
                value = self.__normalize_srs_code(str(row.get(col, "") or ""))
                if value.startswith("SRS-"):
                    found.add(value)
        return found

    def __table_codes_subset_of(self, table, codes: Set[str]) -> bool:
        table_codes = self.__table_row_codes(table)
        return bool(table_codes) and table_codes.issubset(codes)

    def __is_change_req_table_node(self, node: SrsNode, type_name: str = "") -> bool:
        table = self.__parse_node_table(node.table)
        if not table:
            return False
        raw_name = str(table.get("name") or getattr(node, "title", "") or getattr(node, "label", "") or "")
        if "变更" not in self.__normalize_type_name(raw_name):
            return False
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        if not headers or not rows:
            return False
        if type_name and not self.__matches_change_table_title(raw_name, type_name):
            return False
        return True

    def __prune_change_table_nodes(self, doc_id: int, type_name: str, deleted_codes: List[str]):
        codes = {self.__normalize_srs_code(code) for code in (deleted_codes or []) if code}
        codes = {code for code in codes if code.startswith("SRS-")}
        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == doc_id)
        ).scalars().all()
        if not nodes:
            return
        n_ids_to_delete: Set[int] = set()
        for node in nodes:
            table = self.__parse_node_table(node.table)
            node_title = str(getattr(node, "title", "") or getattr(node, "label", "") or "")
            raw_name = str((table or {}).get("name") or node_title or "")
            if "变更" not in self.__normalize_type_name(raw_name) and "变更" not in self.__normalize_type_name(node_title):
                continue
            title_matched = bool(
                type_name
                and (
                    self.__matches_change_table_title(raw_name, type_name)
                    or self.__matches_change_table_title(node_title, type_name)
                )
            )
            rows = (table or {}).get("rows") or []
            if title_matched:
                n_ids_to_delete.add(node.n_id)
                continue
            if not table or not codes:
                continue
            # 仅当整张表的需求编号都属于本次删除集合时才按 code 删，避免误伤 Word 导入的其它变更表。
            if self.__table_codes_subset_of(table, codes):
                n_ids_to_delete.add(node.n_id)
                continue
            if (
                title_matched
                and rows
                and self.__table_contains_any_code(table, codes)
            ):
                n_ids_to_delete.add(node.n_id)
        if n_ids_to_delete:
            db.session.execute(
                delete(SrsNode).where(SrsNode.doc_id == doc_id, SrsNode.n_id.in_(list(n_ids_to_delete)))
            )
            logger.info(
                "delete_srs_type prune change table nodes: doc_id=%s type_name=%s n_ids=%s",
                doc_id, type_name, sorted(n_ids_to_delete),
            )

    def __prune_req_detail_nodes_by_codes(self, doc_id: int, deleted_codes: List[str]):
        codes = {self.__normalize_srs_code(code) for code in (deleted_codes or []) if code}
        codes = {code for code in codes if code.startswith("SRS-")}
        if not codes:
            return
        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == doc_id)
        ).scalars().all()
        if not nodes:
            return
        node_by_nid = {node.n_id: node for node in nodes}
        n_ids_to_delete: Set[int] = set()
        for node in nodes:
            if not self.__is_under_chapter_seven(node, node_by_nid):
                continue
            code = self.__extract_node_req_code(node)
            if code in codes:
                n_ids_to_delete.add(node.n_id)
        if n_ids_to_delete:
            db.session.execute(
                delete(SrsNode).where(SrsNode.doc_id == doc_id, SrsNode.n_id.in_(list(n_ids_to_delete)))
            )
            for n_id in n_ids_to_delete:
                node_by_nid.pop(n_id, None)
            logger.info(
                "delete_srs_type prune req detail nodes: doc_id=%s codes=%s n_ids=%s",
                doc_id, sorted(codes), sorted(n_ids_to_delete),
            )
        self.__prune_empty_req_chapter_shells(doc_id, node_by_nid)

    async def add_srs_type(self, form: SrsTypeForm):
        try:  
            type_name = str(form.type_name or "").strip()
            if form.doc_id and type_name:
                normalized_name = self.__normalize_type_name(type_name)
                existed_rows = db.session.execute(
                    select(SrsType).where(SrsType.doc_id == form.doc_id)
                ).scalars().all()
                for existed in existed_rows:
                    if self.__normalize_type_name(existed.type_name) == normalized_name:
                        return Resp.resp_ok(data=SrsTypeForm(**existed.dict()))
            form.type_code = get_uuid()          
            row = SrsType(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.commit()
            form.id = row.id
            return Resp.resp_ok(data=form)
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_srs_type(self, id):
        row = db.session.execute(select(SrsType).where(SrsType.id == id)).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc_id = row.doc_id
        target_name = row.type_name or ""
        # Word 导入的同一张变更表在 srs_type 里可能存在多行同名记录（不同 type_code），
        # 仅删 id 这一行会残留同名空壳，刷新后渲染成“暂无数据”空表。
        # 这里把“同一张变更表”的所有同名 srs_type 行一并清理。
        all_types: List[SrsType] = db.session.execute(
            select(SrsType).where(SrsType.doc_id == doc_id)
        ).scalars().all()
        target_type_ids: Set[int] = {id}
        target_type_codes: Set[str] = set()
        if row.type_code:
            target_type_codes.add(row.type_code)
        for item in all_types:
            if item.id == id:
                continue
            if target_name and self.__matches_change_table_title(item.type_name or "", target_name):
                if item.id:
                    target_type_ids.add(item.id)
                if item.type_code:
                    target_type_codes.add(item.type_code)
        req_rows: List[SrsReq] = db.session.execute(
            select(SrsReq).where(
                SrsReq.doc_id == doc_id,
                SrsReq.type_code.in_(list(target_type_codes)),
            )
        ).scalars().all() if target_type_codes else []
        req_ids = [item.id for item in req_rows if item.id]
        deleted_codes = [item.code for item in req_rows if item.code]
        if req_ids:
            db.session.execute(delete(SdsReqd).where(SdsReqd.req_id.in_(req_ids)))
            db.session.execute(delete(SdsTrace).where(SdsTrace.req_id.in_(req_ids)))
            db.session.execute(delete(SrsReqd).where(SrsReqd.req_id.in_(req_ids)))
        self.__prune_change_table_nodes(doc_id, target_name, deleted_codes)
        self.__prune_req_detail_nodes_by_codes(doc_id, deleted_codes)
        if target_type_codes:
            db.session.execute(
                delete(SrsReq).where(
                    SrsReq.doc_id == doc_id,
                    SrsReq.type_code.in_(list(target_type_codes)),
                )
            )
        db.session.execute(
            delete(SrsType).where(
                SrsType.doc_id == doc_id,
                SrsType.id.in_(list(target_type_ids)),
            )
        )
        # 清理导入兜底（__upsert_imported_change_req_tables_from_tree）误建的“变更类型空壳”：
        # 这类自动生成的 type_code 一律是 change_ 前缀；当其名下已无任何 srs_req 时即为无效空表，
        # 删除变更表时一并清掉，避免刷新后渲染出“暂无数据”空表。
        # 用户手动新增的变更表 type_code 为 uuid（见 add_srs_type），不以 change_ 开头，不受影响。
        orphan_types: List[SrsType] = db.session.execute(
            select(SrsType).where(
                SrsType.doc_id == doc_id,
                SrsType.type_code.like("change_%"),
            )
        ).scalars().all()
        empty_type_ids = []
        for orphan in orphan_types:
            req_count = db.session.execute(
                select(func.count()).select_from(SrsReq).where(
                    SrsReq.doc_id == doc_id,
                    SrsReq.type_code == orphan.type_code,
                )
            ).scalars().first()
            if not req_count and orphan.id:
                empty_type_ids.append(orphan.id)
        if empty_type_ids:
            db.session.execute(delete(SrsType).where(SrsType.id.in_(empty_type_ids)))
            logger.info(
                "delete_srs_type prune empty change-type shells: doc_id=%s type_ids=%s",
                doc_id, sorted(empty_type_ids),
            )
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_srs_type(self, form: SrsTypeForm):
        try:
            sql = select(SrsType).where(SrsType.id == form.id)
            row:SrsType = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict().items():
                if key == "id" or key == "type_code" or value is None:
                    continue
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def list_srs_type(self, doc_id: int = 0, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(SrsType)
        if doc_id:
            sql = sql.where(SrsType.doc_id == doc_id)
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.order_by(SrsType.id).offset(page_size * page_index).limit(page_size)
        rows: list[SrsType] = db.session.execute(sql).scalars().all()
        objs = []
        for row in rows:
            obj = SrsTypeForm(**row.dict())
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
