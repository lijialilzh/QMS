import logging
import json
import sys
import re
from typing import Dict, List, Tuple, Union
from sqlalchemy import select, func, delete, or_, and_
from sqlalchemy.sql import desc
from sqlalchemy.dialects.postgresql import insert as pg_insert
from ..model.srs_doc import SrsDoc
from ..model.srs_doc import SrsNode
from ..model.srs_type import SrsType
from ..model.sds_reqd import SdsReqd
from ..model.sds_doc import SdsDoc
from ..model.rcm import Rcm
from ..model.srs_req import ReqRcm, SrsReq
from ..model.srs_reqd import SrsReqd
from ..obj.tobj_srs_reqd import SrsReqdForm
from ..obj.vobj_srs_reqd import SrsReqdObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):
    @staticmethod
    def __normalize_name_part(value: str):
        txt = str(value or "").strip()
        if not txt:
            return ""
        if txt in {"/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"}:
            return ""
        return txt

    def __pick_req_name(self, row_req: SrsReq, *fallbacks):
        for val in [row_req.sub_function, row_req.function, row_req.module, *fallbacks]:
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
    def __normalize_header(value: str):
        return re.sub(r"[\s_:/（）()]+", "", (value or "").lower())

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
        if "事件流" in norm or "工作流" in norm or "工作流程" in norm or norm in ["workflow", "work_flow"]:
            return "work_flow"
        if "后置条件" in norm or norm in ["postcondition", "post_condition"]:
            return "post_condition"
        if "异常情况" in norm or "异常" in norm or norm in ["exception"]:
            return "exception"
        if "约束" in norm or "限制" in norm or norm in ["constraint"]:
            return "constraint"
        return None

    def __extract_reqd_from_table(self, table):
        result = {}
        if isinstance(table, str):
            try:
                table = json.loads(table)
            except Exception:
                table = None
        if not isinstance(table, dict):
            return result
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        if len(headers) < 2:
            return result
        left_header = headers[0] or {}
        right_header = headers[1] or {}
        left_code = left_header.get("code")
        right_code = right_header.get("code")
        if not left_code or not right_code:
            return result

        # 两列表格常把“需求编号|SRS-XXX”放在表头，优先解析
        field = self.__map_reqd_field(left_header.get("name") or "")
        if field:
            result[field] = str(right_header.get("name") or "").strip()

        last_field = None
        long_text_fields = {"overview", "pre_condition", "trigger", "work_flow", "post_condition", "exception", "constraint"}
        for row in rows or []:
            left = str((row or {}).get(left_code, "") or "").strip()
            right = str((row or {}).get(right_code, "") or "").strip()
            field = self.__map_reqd_field(left)
            if field and right:
                result[field] = right
                last_field = field
            elif (not left) and right and last_field in long_text_fields:
                # 兼容“事件流/工作流”等多行续写（左列为空，右列延续上一字段）
                prev = str(result.get(last_field) or "").strip()
                result[last_field] = f"{prev}\n{right}".strip() if prev else right
        return result

    def __query_reqd_from_nodes(self, doc_ids: List[int]):
        if not doc_ids:
            return {}
        sql = select(SrsNode).where(SrsNode.doc_id.in_(doc_ids)).order_by(SrsNode.doc_id, SrsNode.n_id)
        rows: List[SrsNode] = db.session.execute(sql).scalars().all()
        result: Dict[int, Dict[str, dict]] = {}
        for row in rows:
            table_data = self.__extract_reqd_from_table(row.table)
            # 优先用表格里的“需求编号”，其次用节点上的 srs_code
            code = self.__normalize_req_code(table_data.get("code") or row.srs_code or "")
            if not code:
                continue
            doc_map = result.setdefault(row.doc_id, {})
            item = doc_map.setdefault(code, {})
            # 需求名称优先取“表格里的需求名称”，仅当表格未给出时才回退到节点标题
            if row.title and not item.get("name") and not table_data.get("name"):
                item["name"] = row.title
            if row.text and not item.get("overview"):
                item["overview"] = row.text
            for key, value in table_data.items():
                if not value:
                    continue
                if key == "name":
                    item[key] = value
                    continue
                if not item.get(key):
                    item[key] = value
        return result

    async def add_srs_reqd(self, form: SrsReqdForm):
        try:
            row_req = SrsReq(doc_id=form.doc_id, code=form.code, type_code="reqd")
            sql = select(func.count(SrsReq.id)).where(SrsReq.doc_id == row_req.doc_id, SrsReq.type_code == row_req.type_code, SrsReq.code == row_req.code)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))

            db.session.add(row_req)
            db.session.flush()

            sds_docs = db.session.execute(select(SdsDoc).where(SdsDoc.srsdoc_id == form.doc_id)).scalars().all()
            if sds_docs:
                sds_values = [dict(doc_id=sds_doc.id, req_id=row_req.id) for sds_doc in sds_docs]
                db.session.execute(pg_insert(SdsReqd).values(sds_values).on_conflict_do_nothing())

            rcm_ids = form.rcm_ids
            form.req_id = row_req.id
            form.doc_id = None
            form.code = None
            form.name = None
            form.rcm_ids = None
            if rcm_ids is not None:
                db.session.execute(delete(ReqRcm).where(ReqRcm.req_id == form.req_id))
                for rcm_id in rcm_ids:
                    db.session.add(ReqRcm(req_id=form.req_id, rcm_id=rcm_id))

            row_reqd = SrsReqd(**form.dict(exclude_none=True))
            db.session.add(row_reqd)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    async def delete_srs_reqd(self, req_id: int):
        db.session.execute(delete(SrsReqd).where(SrsReqd.req_id == req_id))
        db.session.execute(delete(SrsReq).where(SrsReq.id == req_id))
        db.session.commit()
        return Resp.resp_ok()
    
    async def update_srs_reqd(self, form: SrsReqdForm):
        try:
            sql = select(SrsReqd).where(SrsReqd.req_id == form.req_id)
            row:SrsReqd = db.session.execute(sql).scalars().first()
            rcm_ids = form.rcm_ids
            form.rcm_ids = None
            form.code = None
            form.name = None
            if not row:
                row = SrsReqd(**form.dict(exclude_none=True))
                db.session.add(row)
            else:
                excludes =  set(("req_id", "doc_id", "code", "name"))
                for key, value in form.dict().items():
                    if key in excludes or value is None:
                        continue
                    setattr(row, key, value)
            if rcm_ids is not None:
                db.session.execute(delete(ReqRcm).where(ReqRcm.req_id == form.req_id))
                for rcm_id in rcm_ids:
                    db.session.add(ReqRcm(req_id=form.req_id, rcm_id=rcm_id))
            db.session.commit()
            return Resp.resp_ok()
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
    
    def __resort_rows(self, rows: List[Tuple[SrsReq, SrsReqd, SrsType]]):
        sorted_rows = []
        for row in rows:
            type_id = row[2].id if row[2] else sys.maxsize
            type_id = 0 if row[0].type_code == "1" else type_id
            sorted_rows.append((-row[0].doc_id, type_id, row[0].code, row))
        sorted_rows.sort(key=lambda x: (x[0], x[1], x[2]))

        exist_codes = set()
        filtered_rows = []
        for row in sorted_rows:
            ucode = f"{row[0]}_{row[2]}"
            if ucode not in exist_codes:
                exist_codes.add(ucode)
                filtered_rows.append(row[3])
        
        filtered_rows.sort(key=lambda x: (-x[0].doc_id, x[0].code))
        return filtered_rows

    async def list_srs_reqd(self, product_id: int = None, doc_id: int = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 

        sql = select(SrsReq, SrsReqd, SrsType).outerjoin(SrsReqd, SrsReq.id == SrsReqd.req_id)
        sql = sql.outerjoin(SrsType, SrsReq.type_code == SrsType.type_code)
        sql = sql.outerjoin(SrsDoc, SrsReq.doc_id == SrsDoc.id)
        sql = sql.where(or_(SrsType.doc_id == SrsReq.doc_id, SrsReq.type_code.in_(["1", "2"])))
        sql = sql.where(SrsReq.type_code != "2")
        if product_id:
            sql = sql.where(SrsDoc.product_id == product_id)
        if doc_id:
            sql = sql.where(SrsReq.doc_id == doc_id)

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.offset(page_size * page_index).limit(page_size)
        rows: List[Tuple[SrsReq, SrsReqd, SrsType]] = db.session.execute(sql).all()
        rows = self.__resort_rows(rows)
        objs = []
        rcms_dict = self.__query_rcms([row_req.id for row_req, _, _ in rows])
        node_reqd_dict = self.__query_reqd_from_nodes(list({row_req.doc_id for row_req, _, _ in rows}))
        for row_req, row_reqd, _ in rows:
            node_reqd = (node_reqd_dict.get(row_req.doc_id) or {}).get(self.__normalize_req_code(row_req.code or ""), {})
            if not row_reqd:
                obj = SrsReqdObj(req_id=row_req.id)
                obj.name = self.__pick_req_name(row_req, node_reqd.get("name"))
                obj.overview = node_reqd.get("overview")
                obj.participant = node_reqd.get("participant")
                obj.pre_condition = node_reqd.get("pre_condition")
                obj.trigger = node_reqd.get("trigger")
                obj.work_flow = node_reqd.get("work_flow")
                obj.post_condition = node_reqd.get("post_condition")
                obj.exception = node_reqd.get("exception")
                obj.constraint = node_reqd.get("constraint")
            else:
                obj = SrsReqdObj(**row_reqd.dict())
                # 需求名称以 SRS主表(子功能/功能/模块)为准，保证 SRS表管理修改后实时体现
                obj.name = self.__pick_req_name(row_req, obj.name, node_reqd.get("name"))
                # 已有 reqd 时用节点详情补齐空字段，保证列表展示完整
                obj.overview = obj.overview or node_reqd.get("overview")
                obj.participant = obj.participant or node_reqd.get("participant")
                obj.pre_condition = obj.pre_condition or node_reqd.get("pre_condition")
                obj.trigger = obj.trigger or node_reqd.get("trigger")
                obj.work_flow = obj.work_flow or node_reqd.get("work_flow")
                obj.post_condition = obj.post_condition or node_reqd.get("post_condition")
                obj.exception = obj.exception or node_reqd.get("exception")
                obj.constraint = obj.constraint or node_reqd.get("constraint")
            obj.code = row_req.code
            obj.module = row_req.module
            obj.function = row_req.function
            obj.sub_function = row_req.sub_function
            obj.type_code = row_req.type_code
            rcms = rcms_dict.get(row_req.id) or []
            obj.rcm_codes = [rcm.code for rcm in rcms]
            obj.rcm_ids = [rcm.id for rcm in rcms]
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        
    async def get_srs_reqd(self, req_id: int):
        sql = select(SrsReq, SrsReqd).outerjoin(SrsReqd, SrsReq.id == SrsReqd.req_id).where(SrsReq.id == req_id)
        row: Tuple[SrsReq, SrsReqd] = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        row_req, row_reqd = row
        
        rcms_dict = self.__query_rcms([row_req.id])
        rcms = rcms_dict.get(row_req.id) or []
        rcm_codes = [rcm.code for rcm in rcms]
        rcm_ids = [rcm.id for rcm in rcms]
        if not row_reqd:
            name = self.__pick_req_name(row_req)
            return Resp.resp_ok(data=SrsReqdObj(req_id=row_req.id, type_code=row_req.type_code, rcm_codes=rcm_codes, rcm_ids=rcm_ids, name=name))
        return Resp.resp_ok(data=SrsReqdObj(**row_reqd.dict(), type_code=row_req.type_code, rcm_codes=rcm_codes, rcm_ids=rcm_ids))
    