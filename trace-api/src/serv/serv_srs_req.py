import logging
import re
import json
import sys
from typing import Dict, List, Tuple
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from sqlalchemy.dialects.postgresql import insert as pg_insert
from ..model.srs_doc import SrsNode
from ..obj.vobj_srs_doc import SrsDocObj
from ..obj.tobj_srs_doc import SrsNodeForm
from ..obj.vobj_srs_req import SrsReqObj
from ..model.rcm import Rcm
from ..model.sds_doc import SdsDoc, SdsNode
from ..model.sds_reqd import SdsReqd
from ..model.sds_trace import SdsTrace
from ..model.srs_req import ReqRcm, SrsReq
from ..model.srs_reqd import SrsReqd
from ..obj.tobj_srs_req import SrsReqForm, SrsReqBatchSaveForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)
tc_standard = "1"


class Server(object):
    @staticmethod
    def __normalize_name_part(value: str):
        txt = str(value or "").strip()
        if not txt:
            return ""
        if txt in {"/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"}:
            return ""
        return txt

    def __pick_req_name(self, req_row: SrsReq):
        for val in [req_row.sub_function, req_row.function, req_row.module]:
            txt = self.__normalize_name_part(val)
            if txt:
                return txt
        return ""

    @staticmethod
    def __normalize_req_code(code: str):
        txt = (code or "").strip().upper()
        txt = re.sub(r"\s+", "", txt)
        txt = re.sub(r"[，。；;、,.]+$", "", txt)
        return txt

    @staticmethod
    def __srs_code_sort_key(value: str):
        txt = re.sub(r"\s+", "", str(value or "").strip().upper())
        matched = re.match(r"^SRS-[A-Z]+(\d+)-(\d+)$", txt)
        if matched:
            return (int(matched.group(1)), int(matched.group(2)), txt)
        return (sys.maxsize, sys.maxsize, txt)

    @staticmethod
    def __to_sds_code(value: str):
        txt = re.sub(r"\s+", "", str(value or "").strip().upper())
        return txt.replace("SRS-", "SDS-", 1) if txt.startswith("SRS-") else txt

    @staticmethod
    def __clean_title_text(value: str):
        txt = str(value or "").strip()
        txt = re.sub(r"^\s*\d+(?:\.\d+)*[\s、.．:：\-]*", "", txt)
        txt = re.sub(r"\bSRS[-_\sA-Za-z0-9.]+\b", "", txt, flags=re.I)
        txt = re.sub(r"\s+", " ", txt).strip()
        return txt

    def __repair_reqs_from_nodes(self, doc_id: int):
        if not doc_id:
            return
        exists_count = db.session.execute(select(func.count(SrsReq.id)).where(SrsReq.doc_id == doc_id)).scalar()
        if exists_count and exists_count > 0:
            return

        nodes: List[SrsNode] = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == doc_id).order_by(SrsNode.priority, SrsNode.n_id)
        ).scalars().all()
        if not nodes:
            return

        # 仅对“导入Word”的文档做自动回填；手动新增场景保持手工维护
        is_imported_doc = any(
            str(getattr(node, "title", "") or "").startswith("导入表格")
            or str(getattr(node, "title", "") or "").startswith("导入图片")
            or str(getattr(node, "title", "") or "").startswith("导入正文")
            for node in nodes
        )
        if not is_imported_doc:
            return

        node_map = {row.n_id: row for row in nodes}
        values = []
        seen_codes = set()

        def add_req(code: str, module: str = None, function: str = None, sub_function: str = None, location: str = None, type_code: str = "1"):
            norm_code = self.__normalize_req_code(code or "")
            if not norm_code or norm_code in seen_codes:
                return
            seen_codes.add(norm_code)
            values.append(
                dict(
                    doc_id=doc_id,
                    code=norm_code,
                    module=self.__normalize_name_part(module) or None,
                    function=self.__normalize_name_part(function) or None,
                    sub_function=self.__normalize_name_part(sub_function) or None,
                    location=self.__normalize_name_part(location) or None,
                    type_code=type_code or "1",
                )
            )

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
            rows_data = table.get("rows") or []
            if not isinstance(headers, list) or not isinstance(rows_data, list) or not headers or not rows_data:
                continue

            header_names = [str((h or {}).get("name", "") or "") if isinstance(h, dict) else "" for h in headers]
            header_norm = [self.__normalize_header(h) for h in header_names]
            col_codes = [str((h or {}).get("code", "") or "") if isinstance(h, dict) else "" for h in headers]
            col_idx = {}
            for idx, h in enumerate(header_norm):
                if ("需求编号" in h or h in ["srscode", "code"]) and "code" not in col_idx:
                    col_idx["code"] = idx
                if ("模块" in h or h == "module") and "module" not in col_idx:
                    col_idx["module"] = idx
                if ("子功能" in h or "subfunction" in h) and "sub_function" not in col_idx:
                    col_idx["sub_function"] = idx
                if ("功能" in h or h == "function") and "function" not in col_idx:
                    col_idx["function"] = idx
                if ("章节" in h or "位置" in h or h == "location") and "location" not in col_idx:
                    col_idx["location"] = idx

            # 标准需求表/其他需求表
            if "code" in col_idx and ("module" in col_idx or "function" in col_idx or "location" in col_idx):
                for row in rows_data:
                    if not isinstance(row, dict):
                        continue
                    values_arr = [str(row.get(code, "") or "") for code in col_codes]
                    code = values_arr[col_idx["code"]] if col_idx["code"] < len(values_arr) else ""
                    module = values_arr[col_idx["module"]] if "module" in col_idx and col_idx["module"] < len(values_arr) else None
                    function = values_arr[col_idx["function"]] if "function" in col_idx and col_idx["function"] < len(values_arr) else None
                    sub_function = values_arr[col_idx["sub_function"]] if "sub_function" in col_idx and col_idx["sub_function"] < len(values_arr) else None
                    location = values_arr[col_idx["location"]] if "location" in col_idx and col_idx["location"] < len(values_arr) else None
                    req_type = "2" if location and not function and not sub_function else "1"
                    add_req(code=code, module=module, function=function, sub_function=sub_function, location=location, type_code=req_type)
                continue

            # 兜底：两列表格（需求编号|编号值 + 键值对）
            if len(headers) >= 2 and col_codes and len(col_codes) >= 2:
                left_code = col_codes[0]
                right_code = col_codes[1]
                left_name = str((headers[0] or {}).get("name", "") or "") if isinstance(headers[0], dict) else ""
                right_name = str((headers[1] or {}).get("name", "") or "") if isinstance(headers[1], dict) else ""
                pairs = [(left_name, right_name)]
                for row in rows_data:
                    if not isinstance(row, dict):
                        continue
                    left = str(row.get(left_code, "") or "")
                    right = str(row.get(right_code, "") or "")
                    if left or right:
                        pairs.append((left, right))
                code = ""
                module = function = sub_function = location = None
                for left, right in pairs:
                    field = self.__map_field(left)
                    if field == "code":
                        code = right
                    elif field == "module":
                        module = right
                    elif field == "function":
                        function = right
                    elif field == "sub_function":
                        sub_function = right
                    elif field == "location":
                        location = right
                if code:
                    req_type = "2" if location and not function and not sub_function else "1"
                    add_req(code=code, module=module, function=function, sub_function=sub_function, location=location, type_code=req_type)

        # 最后兜底：节点 srs_code
        for node in nodes:
            code = self.__normalize_req_code(getattr(node, "srs_code", "") or "")
            if not code or code in seen_codes:
                continue
            function = self.__clean_title_text(getattr(node, "title", "") or "")
            module = ""
            p_id = getattr(node, "p_id", 0)
            while p_id and p_id in node_map:
                p_node = node_map[p_id]
                parent_title = self.__clean_title_text(getattr(p_node, "title", "") or "")
                if parent_title:
                    module = parent_title
                    break
                p_id = getattr(p_node, "p_id", 0)
            add_req(code=code, module=module, function=function, type_code="1")

        if values:
            db.session.execute(pg_insert(SrsReq).values(values).on_conflict_do_nothing())
            db.session.commit()

    @staticmethod
    def __normalize_header(value: str):
        return re.sub(r"[\s_:/（）()]+", "", (value or "").lower())

    def __map_field(self, label: str):
        norm = self.__normalize_header(label or "")
        if not norm:
            return None
        if "需求编号" in norm or norm in ["srscode", "code"]:
            return "code"
        if "需求名称" in norm or norm == "name":
            return "name"
        if "子功能" in norm:
            return "sub_function"
        if "功能" in norm:
            return "function"
        if "模块" in norm:
            return "module"
        if "章节" in norm or "对应章节" in norm or norm == "location":
            return "location"
        return None

    def __set_table_cell_value(self, table: dict, row_index: int, col_code: str, value: str):
        headers = table.get("headers") or []
        cells = table.get("cells") or []
        if not headers or not cells:
            return
        col_index = -1
        for idx, h in enumerate(headers):
            if isinstance(h, dict) and h.get("code") == col_code:
                col_index = idx
                break
        if col_index < 0:
            return
        # cells[0] 为表头，正文从 1 开始
        target_row = row_index + 1
        if target_row < 0 or target_row >= len(cells):
            return
        row_cells = cells[target_row] if isinstance(cells[target_row], list) else None
        if not row_cells or col_index >= len(row_cells):
            return
        cell = row_cells[col_index]
        if not isinstance(cell, dict):
            return
        # 合并占位单元格(row_span/col_span 为 0)不写值
        if cell.get("row_span") == 0 or cell.get("col_span") == 0:
            return
        cell["value"] = value or ""

    def __move_table_row_by_code(self, table: dict, row_index: int, code_col: str):
        rows = table.get("rows") or []
        if row_index < 0 or row_index >= len(rows):
            return False
        row = rows.pop(row_index)
        row_code = self.__normalize_req_code(str(row.get(code_col, "") or ""))
        row_key = self.__srs_code_sort_key(row_code)
        cells = table.get("cells") or []
        body_cells = None
        if isinstance(cells, list) and len(cells) == len(rows) + 2:
            body_cells = list(cells[1:])
            moved_cells = body_cells.pop(row_index)
        insert_index = len(rows)
        for idx, item in enumerate(rows):
            if not isinstance(item, dict):
                continue
            item_code = self.__normalize_req_code(str(item.get(code_col, "") or ""))
            if row_key < self.__srs_code_sort_key(item_code):
                insert_index = idx
                break
        rows.insert(insert_index, row)
        if body_cells is not None:
            body_cells.insert(insert_index, moved_cells)
            table["cells"] = [cells[0]] + body_cells
        return insert_index != row_index

    def __replace_title_name(self, title: str, name: str):
        title = str(title or "").strip()
        name = self.__normalize_name_part(name)
        if not name:
            return title
        matched = re.match(r"^(\s*\d+(?:\.\d+)*[\s、.．:：\-]*)(.*)$", title)
        if matched:
            return f"{matched.group(1)}{name}"
        return name

    def __extract_detail_table_req_code(self, table: dict):
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        if len(headers) < 2 or not isinstance(rows, list):
            return ""
        left_code = headers[0].get("code") if isinstance(headers[0], dict) else ""
        right_code = headers[1].get("code") if isinstance(headers[1], dict) else ""
        right_name = headers[1].get("name") if isinstance(headers[1], dict) else ""
        code = self.__normalize_req_code(str(right_name or ""))
        if code:
            return code
        if not left_code or not right_code:
            return ""
        for row in rows:
            if not isinstance(row, dict):
                continue
            left_text = str(row.get(left_code, "") or "").strip()
            field = self.__map_field(left_text)
            if not field and "需求编号" in left_text:
                field = "code"
            if field == "code":
                return self.__normalize_req_code(str(row.get(right_code, "") or ""))
        return ""

    def __sync_req_to_node_titles(self, req_row: SrsReq, old_code: str = None, all_nodes: List[SrsNode] = None):
        code = self.__normalize_req_code(req_row.code or "")
        name_value = self.__pick_req_name(req_row)
        if not code or not name_value:
            return
        match_codes = {code}
        old_code = self.__normalize_req_code(old_code or "")
        if old_code:
            match_codes.add(old_code)

        nodes: List[SrsNode] = all_nodes if all_nodes is not None else db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == req_row.doc_id)
        ).scalars().all()
        if not nodes:
            return
        node_map = {node.n_id: node for node in nodes}
        target_nodes = []
        for node in nodes:
            node_code = self.__normalize_req_code(getattr(node, "srs_code", "") or "")
            if node_code in match_codes:
                target_nodes.append(node)
                if node_code != code:
                    node.srs_code = code

            table = node.table
            if isinstance(table, str):
                try:
                    table = json.loads(table)
                except Exception:
                    table = None
            elif isinstance(table, (dict, list)):
                table = json.loads(json.dumps(table, ensure_ascii=False))
            if not isinstance(table, dict):
                continue
            table_code = self.__extract_detail_table_req_code(table)
            if table_code in match_codes:
                target_nodes.append(node_map.get(node.p_id) or node)

        seen = set()
        for node in target_nodes:
            if not node or node.id in seen:
                continue
            seen.add(node.id)
            new_title = self.__replace_title_name(node.title, name_value)
            if new_title and new_title != node.title:
                node.title = new_title

    def __sync_req_to_node_tables(self, req_row: SrsReq, old_code: str = None, old_module: str = None, table_nodes: List[SrsNode] = None):
        code = self.__normalize_req_code(req_row.code or "")
        if not code:
            return
        match_codes = {code}
        old_code = self.__normalize_req_code(old_code or "")
        if old_code:
            match_codes.add(old_code)
        # SRS 表的行顺序必须保持 Word/用户编辑时的原始顺序；需求编号只用于功能描述章节排序，不能反向重排 SRS 表。
        should_reposition = False

        rows = table_nodes if table_nodes is not None else db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == req_row.doc_id, SrsNode.table.isnot(None))
        ).scalars().all()
        name_value = self.__pick_req_name(req_row)
        module_value = self.__normalize_name_part(req_row.module)
        function_value = self.__normalize_name_part(req_row.function)
        sub_function_value = self.__normalize_name_part(req_row.sub_function)

        for node in rows:
            table = node.table
            if isinstance(table, str):
                try:
                    table = json.loads(table)
                except Exception:
                    table = None
            elif isinstance(table, (dict, list)):
                # 避免原地修改 ORM 中的 JSON 对象导致变更检测失效
                table = json.loads(json.dumps(table, ensure_ascii=False))
            if not isinstance(table, dict):
                continue

            headers = table.get("headers") or []
            body_rows = table.get("rows") or []
            if not headers or not isinstance(body_rows, list):
                continue

            changed = False
            header_map = {
                self.__map_field(h.get("name") or ""): h.get("code")
                for h in headers
                if isinstance(h, dict)
            }

            code_col = header_map.get("code")
            if code_col:
                matched_row_index = -1
                for row_idx, row in enumerate(body_rows):
                    if not isinstance(row, dict):
                        continue
                    row_code = self.__normalize_req_code(str(row.get(code_col, "") or ""))
                    if row_code not in match_codes:
                        continue
                    matched_row_index = row_idx
                    if row.get(code_col) != code:
                        row[code_col] = code
                        self.__set_table_cell_value(table, row_idx, code_col, code)
                        changed = True
                    if header_map.get("module"):
                        row[header_map["module"]] = module_value
                        self.__set_table_cell_value(table, row_idx, header_map["module"], module_value)
                    if header_map.get("function"):
                        row[header_map["function"]] = function_value
                        self.__set_table_cell_value(table, row_idx, header_map["function"], function_value)
                    if header_map.get("sub_function"):
                        row[header_map["sub_function"]] = sub_function_value
                        self.__set_table_cell_value(table, row_idx, header_map["sub_function"], sub_function_value)
                    if header_map.get("location"):
                        row[header_map["location"]] = req_row.location or ""
                        self.__set_table_cell_value(table, row_idx, header_map["location"], req_row.location or "")
                    changed = True
                if should_reposition and matched_row_index >= 0:
                    changed = self.__move_table_row_by_code(table, matched_row_index, code_col) or changed

            if len(headers) >= 2 and isinstance(headers[0], dict) and isinstance(headers[1], dict):
                left_code = headers[0].get("code")
                right_code = headers[1].get("code")
                if left_code and right_code:
                    # 兼容两种详情表：
                    # 1) 第二列表头就是 SRS 编号
                    # 2) 第二列表头不是编号，但“需求编号”行里存放了当前编号
                    matched = self.__normalize_req_code(headers[1].get("name") or "") in match_codes
                    if not matched:
                        for row in body_rows:
                            if not isinstance(row, dict):
                                continue
                            left_text = str(row.get(left_code, "") or "").strip()
                            field = self.__map_field(left_text)
                            if not field and "需求编号" in left_text:
                                field = "code"
                            if field != "code":
                                continue
                            row_code = self.__normalize_req_code(str(row.get(right_code, "") or ""))
                            if row_code in match_codes:
                                matched = True
                                break

                    if matched:
                        if self.__normalize_req_code(headers[1].get("name") or "") in match_codes and headers[1].get("name") != code:
                            headers[1]["name"] = code
                            changed = True
                        cells = table.get("cells") or []
                        if (
                            isinstance(cells, list) and
                            cells and
                            isinstance(cells[0], list) and
                            len(cells[0]) > 1 and
                            isinstance(cells[0][1], dict) and
                            self.__normalize_req_code(cells[0][1].get("value") or "") in match_codes and
                            cells[0][1].get("value") != code
                        ):
                            cells[0][1]["value"] = code
                            changed = True
                        for row_idx, row in enumerate(body_rows):
                            if not isinstance(row, dict):
                                continue
                            left_text = str(row.get(left_code, "") or "").strip()
                            field = self.__map_field(left_text)
                            if not field:
                                if "需求名称" in left_text:
                                    field = "name"
                                elif "子功能" in left_text:
                                    field = "sub_function"
                                elif "功能" in left_text:
                                    field = "function"
                                elif "模块" in left_text:
                                    field = "module"
                                elif "章节" in left_text:
                                    field = "location"
                            if field == "name" and name_value:
                                row[right_code] = name_value
                                self.__set_table_cell_value(table, row_idx, right_code, name_value)
                                changed = True
                            elif field == "code":
                                row[right_code] = code
                                self.__set_table_cell_value(table, row_idx, right_code, code)
                                changed = True
                            elif field == "module":
                                row[right_code] = module_value
                                self.__set_table_cell_value(table, row_idx, right_code, module_value)
                                changed = True
                            elif field == "function":
                                row[right_code] = function_value
                                self.__set_table_cell_value(table, row_idx, right_code, function_value)
                                changed = True
                            elif field == "sub_function":
                                row[right_code] = sub_function_value
                                self.__set_table_cell_value(table, row_idx, right_code, sub_function_value)
                                changed = True
                            elif field == "location":
                                row[right_code] = req_row.location or ""
                                self.__set_table_cell_value(table, row_idx, right_code, req_row.location or "")
                                changed = True

            if changed:
                node.table = table

    def __sync_sds_codes_from_req_code(self, req_row: SrsReq, old_code: str = None):
        new_sds_code = self.__to_sds_code(req_row.code)
        old_sds_code = self.__to_sds_code(old_code)
        if not new_sds_code or new_sds_code == old_sds_code:
            return
        display_name = self.__pick_req_name(req_row)
        traces: List[SdsTrace] = db.session.execute(
            select(SdsTrace).where(SdsTrace.req_id == req_row.id)
        ).scalars().all()
        for trace in traces:
            previous_code = str(trace.sds_code or "").strip()
            previous_norm = self.__to_sds_code(previous_code)
            if not previous_code:
                trace.sds_code = new_sds_code
            elif old_sds_code and old_sds_code in previous_norm:
                trace.sds_code = re.sub(re.escape(old_sds_code), new_sds_code, previous_code, flags=re.I)
            elif "\n" not in previous_code and "," not in previous_code and "，" not in previous_code:
                trace.sds_code = new_sds_code
            else:
                continue

            old_node_codes = {code for code in [previous_norm, old_sds_code] if code}
            nodes: List[SdsNode] = db.session.execute(
                select(SdsNode).where(SdsNode.doc_id == trace.doc_id, SdsNode.sds_code.isnot(None))
            ).scalars().all()
            matched = False
            for node in nodes:
                node_code = self.__to_sds_code(getattr(node, "sds_code", "") or "")
                if node_code not in old_node_codes and node_code != new_sds_code:
                    continue
                node.sds_code = new_sds_code
                if display_name and getattr(trace, "location", None):
                    node.title = f"{trace.location} {display_name}"
                matched = True
            if not matched and getattr(trace, "location", None):
                heading = str(trace.location or "").strip()
                for node in nodes:
                    title = str(getattr(node, "title", "") or "").strip()
                    if re.match(rf"^{re.escape(heading)}(?:\s|$)", title):
                        node.sds_code = new_sds_code
                        if display_name:
                            node.title = f"{heading} {display_name}"

    async def add_srs_req(self, form: SrsReqForm):
        try:
            sql = select(func.count(SrsReq.id)).where(SrsReq.doc_id == form.doc_id, SrsReq.type_code == form.type_code, SrsReq.code == form.code)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            rcm_ids = form.rcm_ids
            form.rcm_ids = None
            row = SrsReq(**form.dict(exclude_none=True))
            row.id = None
            db.session.add(row)
            db.session.flush()

            if rcm_ids is not None:
                db.session.execute(delete(ReqRcm).where(ReqRcm.req_id == row.id))
                for rcm_id in rcm_ids:
                    db.session.add(ReqRcm(req_id=row.id, rcm_id=rcm_id))

            sds_docs = db.session.execute(select(SdsDoc).where(SdsDoc.srsdoc_id == row.doc_id)).scalars().all()
            if sds_docs:
                if row.type_code != "2":
                    sds_values = [dict(doc_id=sds_doc.id, req_id=row.id) for sds_doc in sds_docs]
                    db.session.execute(pg_insert(SdsReqd).values(sds_values).on_conflict_do_nothing())
                if row.type_code != "reqd":
                    sds_code = form.code.replace("SRS", "SDS")
                    chapter = form.sub_function or form.function or form.module
                    sds_values = [dict(doc_id=sds_doc.id, req_id=row.id, sds_code=sds_code, chapter=chapter) for sds_doc in sds_docs]
                    db.session.execute(pg_insert(SdsTrace).values(sds_values).on_conflict_do_nothing())
            self.__sync_req_to_node_tables(row)
            self.__sync_req_to_node_titles(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    async def update_srs_req(self, form: SrsReqForm):
        try:
            sql = select(func.count(SrsReq.id)).where(SrsReq.doc_id == form.doc_id, SrsReq.type_code == form.type_code, SrsReq.code == form.code, SrsReq.id != form.id)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            sql = select(SrsReq).where(SrsReq.id == form.id)
            row:SrsReq = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            old_code = row.code
            old_module = row.module
            
            rcm_ids = form.rcm_ids
            form.rcm_ids = None
            if rcm_ids is not None:
                db.session.execute(delete(ReqRcm).where(ReqRcm.req_id == row.id))
                for rcm_id in rcm_ids:
                    db.session.add(ReqRcm(req_id=row.id, rcm_id=rcm_id))

            for key, value in form.dict().items():
                if key == "id" or value is None:
                    continue
                setattr(row, key, value)
            self.__sync_sds_codes_from_req_code(row, old_code=old_code)
            self.__sync_req_to_node_tables(row, old_code=old_code, old_module=old_module)
            self.__sync_req_to_node_titles(row, old_code=old_code)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_srs_req(self, id: int):
        db.session.execute(delete(SdsReqd).where(SdsReqd.req_id == id))
        db.session.execute(delete(SdsTrace).where(SdsTrace.req_id == id))
        db.session.execute(delete(SrsReq).where(SrsReq.id == id))
        db.session.execute(delete(SrsReqd).where(SrsReqd.req_id == id))
        db.session.commit()
        return Resp.resp_ok()

    def __apply_update_req(self, form: SrsReqForm):
        sql = select(func.count(SrsReq.id)).where(
            SrsReq.doc_id == form.doc_id,
            SrsReq.type_code == form.type_code,
            SrsReq.code == form.code,
            SrsReq.id != form.id,
        )
        count = db.session.execute(sql).scalar()
        if count > 0:
            raise ValueError(ts("msg_obj_exist"))
        sql = select(SrsReq).where(SrsReq.id == form.id)
        row: SrsReq = db.session.execute(sql).scalars().first()
        if not row:
            raise ValueError(ts("msg_obj_null"))
        old_code = row.code
        old_module = row.module

        rcm_ids = form.rcm_ids
        form.rcm_ids = None
        if rcm_ids is not None:
            db.session.execute(delete(ReqRcm).where(ReqRcm.req_id == row.id))
            for rcm_id in rcm_ids:
                db.session.add(ReqRcm(req_id=row.id, rcm_id=rcm_id))

        for key, value in form.dict().items():
            if key == "id" or value is None:
                continue
            setattr(row, key, value)
        return row, old_code, old_module

    def __apply_add_req(self, form: SrsReqForm):
        sql = select(func.count(SrsReq.id)).where(
            SrsReq.doc_id == form.doc_id,
            SrsReq.type_code == form.type_code,
            SrsReq.code == form.code,
        )
        count = db.session.execute(sql).scalar()
        if count > 0:
            raise ValueError(ts("msg_obj_exist"))
        rcm_ids = form.rcm_ids
        form.rcm_ids = None
        row = SrsReq(**form.dict(exclude_none=True))
        row.id = None
        db.session.add(row)
        db.session.flush()

        if rcm_ids is not None:
            db.session.execute(delete(ReqRcm).where(ReqRcm.req_id == row.id))
            for rcm_id in rcm_ids:
                db.session.add(ReqRcm(req_id=row.id, rcm_id=rcm_id))

        sds_docs = db.session.execute(select(SdsDoc).where(SdsDoc.srsdoc_id == row.doc_id)).scalars().all()
        if sds_docs:
            if row.type_code != "2":
                sds_values = [dict(doc_id=sds_doc.id, req_id=row.id) for sds_doc in sds_docs]
                db.session.execute(pg_insert(SdsReqd).values(sds_values).on_conflict_do_nothing())
            if row.type_code != "reqd":
                sds_code = form.code.replace("SRS", "SDS")
                chapter = form.sub_function or form.function or form.module
                sds_values = [dict(doc_id=sds_doc.id, req_id=row.id, sds_code=sds_code, chapter=chapter) for sds_doc in sds_docs]
                db.session.execute(pg_insert(SdsTrace).values(sds_values).on_conflict_do_nothing())
        return row

    def __apply_delete_req(self, req_id: int):
        db.session.execute(delete(SdsReqd).where(SdsReqd.req_id == req_id))
        db.session.execute(delete(SdsTrace).where(SdsTrace.req_id == req_id))
        db.session.execute(delete(SrsReq).where(SrsReq.id == req_id))
        db.session.execute(delete(SrsReqd).where(SrsReqd.req_id == req_id))

    async def batch_save_srs_req(self, form: SrsReqBatchSaveForm):
        try:
            doc_id = form.doc_id
            type_code = form.type_code or tc_standard
            table_nodes = db.session.execute(
                select(SrsNode).where(SrsNode.doc_id == doc_id, SrsNode.table.isnot(None))
            ).scalars().all()
            all_nodes = db.session.execute(
                select(SrsNode).where(SrsNode.doc_id == doc_id)
            ).scalars().all()
            sync_items: List[Tuple[SrsReq, str, str]] = []

            for item in form.temp_updates or []:
                payload = SrsReqForm(**{**item.dict(), "doc_id": doc_id, "type_code": type_code})
                self.__apply_update_req(payload)

            for item in form.upserts or []:
                payload = SrsReqForm(**{**item.dict(), "doc_id": doc_id, "type_code": type_code})
                if payload.id:
                    row, old_code, old_module = self.__apply_update_req(payload)
                    sync_items.append((row, old_code or "", old_module or ""))
                else:
                    row = self.__apply_add_req(payload)
                    sync_items.append((row, "", ""))

            for req_id in form.delete_ids or []:
                if req_id:
                    self.__apply_delete_req(req_id)

            for row, old_code, old_module in sync_items:
                self.__sync_sds_codes_from_req_code(row, old_code=old_code)
                self.__sync_req_to_node_tables(
                    row,
                    old_code=old_code,
                    old_module=old_module,
                    table_nodes=table_nodes,
                )
            for row, old_code, _old_module in sync_items:
                self.__sync_req_to_node_titles(row, old_code=old_code, all_nodes=all_nodes)

            db.session.commit()
            return Resp.resp_ok()
        except ValueError as exc:
            db.session.rollback()
            return Resp.resp_err(msg=str(exc))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    def __query_rcms(self, req_ids: List[int]) -> List[str]:
        sql = select(ReqRcm, Rcm).join(Rcm, ReqRcm.rcm_id == Rcm.id).where(ReqRcm.req_id.in_(req_ids)).order_by(ReqRcm.req_id, ReqRcm.id)
        results = dict()        
        for row_req, row_rcm in db.session.execute(sql):
            rcms = results.get(row_req.req_id) or []
            rcms.append(row_rcm)
            results[row_req.req_id] = rcms
        return results
    
    async def get_srs_req(self, id: int):
        sql = select(SrsReq).where(SrsReq.id == id)
        row:SrsReq = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        rcms_dict = self.__query_rcms([row.id])
        rcms = rcms_dict.get(row.id) or []
        obj = SrsReqObj(**row.dict())
        obj.rcm_codes = [rcm.code for rcm in rcms]
        obj.rcm_ids = [rcm.id for rcm in rcms]
        return Resp.resp_ok(data=obj)
    
    def __query_doc_tree(self, doc_id):
        tree = []
        sql = select(SrsNode).where(SrsNode.doc_id == doc_id).order_by(SrsNode.priority)
        nodes: List[SrsNode] = db.session.execute(sql).scalars().all()
        objs_dict = dict()
        objs = []
        for node in nodes:
            obj = SrsNodeForm(children=[], doc_id=node.doc_id, n_id=node.n_id, p_id=node.p_id,
                            title=node.title, label=node.label, text=node.text, ref_type=node.ref_type, srs_code=node.srs_code)
            obj.rcm_codes = (node.rcm_codes or "").split(",")
            objs_dict[obj.n_id] = obj
            objs.append(obj)
        for obj in objs:
            if obj.p_id == 0:
                tree.append(obj)
            else:
                p_obj = objs_dict.get(obj.p_id)
                if not p_obj:
                    continue
                p_obj.children.append(obj)
        return tree

    def __query_doc_req_order(self, doc_ids: List[int]) -> Dict[Tuple[int, str], int]:
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
            elif isinstance(table, (dict, list)):
                table = json.loads(json.dumps(table, ensure_ascii=False))
            if not isinstance(table, dict):
                continue
            headers = table.get("headers") or []
            rows = table.get("rows") or []
            if not isinstance(headers, list) or not isinstance(rows, list) or not headers or not rows:
                continue
            header_norm = [
                self.__normalize_header((h or {}).get("name") or "")
                for h in headers
                if isinstance(h, dict)
            ]
            col_codes = [
                (h or {}).get("code") or ""
                for h in headers
                if isinstance(h, dict)
            ]
            col_idx = {}
            for idx, h in enumerate(header_norm):
                if ("需求编号" in h or h in ["srscode", "code"]) and "code" not in col_idx:
                    col_idx["code"] = idx
                if ("模块" in h or h == "module") and "module" not in col_idx:
                    col_idx["module"] = idx
                if ("子功能" in h or "subfunction" in h) and "sub_function" not in col_idx:
                    col_idx["sub_function"] = idx
                if ("功能" in h or h == "function") and "function" not in col_idx:
                    col_idx["function"] = idx
                if ("章节" in h or "位置" in h or h == "location") and "location" not in col_idx:
                    col_idx["location"] = idx
            # 只使用标准需求表/其他需求表的行顺序；详情表是“属性-值”结构，不参与列表排序。
            if "code" not in col_idx or not any(key in col_idx for key in ["module", "function", "sub_function", "location"]):
                continue
            code_col = col_codes[col_idx["code"]] if col_idx["code"] < len(col_codes) else ""
            if not code_col:
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                code = self.__normalize_req_code(str(row.get(code_col, "") or ""))
                if not code:
                    continue
                key = (node.doc_id, code)
                if key in order_map:
                    continue
                seq_by_doc[node.doc_id] = seq_by_doc.get(node.doc_id, 0) + 1
                order_map[key] = seq_by_doc[node.doc_id]
        return order_map

    async def list_srs_req(self, doc_id: int = None, type_code: str = None, page_index: int = 0, page_size: int = 10):
        def __find_path(level: int, srscode: str, nodes: List[SrsNodeForm], paths: List[str] = None):
            for node in nodes or []:
                npaths = [node.title] if level == 0 else paths + [node.title]
                if node.srs_code == srscode:
                    return npaths, node
                cpaths, cnode = __find_path(level + 1, srscode, node.children, npaths)
                if cnode:
                    return cpaths, cnode
            return paths, None
        
        def __find_chapter(paths: List[str] = None):
            paths.reverse()
            for path in paths:
                chapter =re.search(r'(\d(\.\d)*)', path or "")
                chapter = chapter.group() if chapter else None
                if chapter:
                    return chapter

        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 

        # 兜底修复：导入后若 SRS 管理为空，则尝试从 srs_node 的 srs_code 自动回填
        if doc_id:
            self.__repair_reqs_from_nodes(doc_id)

        sql = select(SrsReq)
        if doc_id:
            sql = sql.where(SrsReq.doc_id == doc_id)
        if type_code:
            sql = sql.where(SrsReq.type_code == type_code)

        sql = sql.order_by(desc(SrsReq.doc_id), SrsReq.code)
        rows: List[SrsReq] = db.session.execute(sql).scalars().all()
        order_map = self.__query_doc_req_order(list({row.doc_id for row in rows}))
        rows.sort(key=lambda row: (
            -int(row.doc_id or 0),
            order_map.get((row.doc_id, self.__normalize_req_code(row.code or "")), sys.maxsize),
            row.code or "",
        ))
        total = len(rows)
        rows = rows[page_size * page_index: page_size * (page_index + 1)]
        rcms_dict = self.__query_rcms([row_req.id for row_req in rows])
        objs = []
        tree = self.__query_doc_tree(doc_id) if doc_id else []
        for row in rows:
            rcms = rcms_dict.get(row.id) or []
            obj = SrsReqObj(**row.dict())
            obj.module = self.__normalize_name_part(obj.module)
            obj.function = self.__normalize_name_part(obj.function)
            obj.sub_function = self.__normalize_name_part(obj.sub_function)
            obj.rcm_codes = [rcm.code for rcm in rcms]
            obj.rcm_ids = [rcm.id for rcm in rcms]
            objs.append(obj)

            if not obj.location:
                paths, found = __find_path(0, row.code, tree, [])
                obj.location = __find_chapter(paths)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        