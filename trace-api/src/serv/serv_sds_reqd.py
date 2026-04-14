import logging
import sys
from typing import Any, List, Tuple
from sqlalchemy import select, func, delete, or_
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..model.srs_type import SrsType
from ..model.srs_reqd import SrsReqd
from ..model.sds_doc import SdsDoc
from ..model.srs_doc import SrsDoc
from ..model.product import Product, UserProd
from ..model.srs_req import SrsReq
from ..model.sds_reqd import SdsReqd, Logic
from ..obj.tobj_sds_reqd import SdsReqdForm, LogicForm
from ..obj.vobj_sds_reqd import SdsReqdObj
from ..utils.sql_ctx import db
from ..utils import get_uuid
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db, save_file

logger = logging.getLogger(__name__)


class Server(object):
    
    async def update_sds_reqd(self, form: SdsReqdForm, new_imgs: List[Any] = None, new_logics: List[LogicForm] = None, alt_logics: List[LogicForm] = None):
        try:
            row_reqd = db.session.execute(select(SdsReqd).where(SdsReqd.id == form.id)).scalars().first()
            if not row_reqd:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            
            for idx, alt_logic in enumerate(alt_logics or []):
                row = db.session.execute(select(Logic).where(Logic.id == alt_logic.id)).scalars().first()
                if not row:
                    continue
                row.txt = alt_logic.txt
            
            for idx, new_img in enumerate(new_imgs or []):
                new_logic = new_logics[idx] if idx < len(new_logics or []) else LogicForm()
                row = Logic(**new_logic.dict())
                row.reqd_id = row_reqd.id
                row.filename = new_img.filename
                db.session.add(row)
                db.session.flush()
                _, img_url = await save_file("sds_reqd_logic", row.id, new_img)
                row.img_url = img_url

            for key, value in form.dict().items():
                if key == "id":
                    continue
                setattr(row_reqd, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_sds_logic(self, logic_id: int):
        sql = delete(Logic).where(Logic.id == logic_id)
        db.session.execute(sql)
        db.session.commit()
        return Resp.resp_ok()
    
    def __resort_rows(self, rows: List[Tuple[SdsReqd, SrsReq, SrsReqd, SrsType, SdsDoc, SrsDoc, Product]]):
        sorted_rows = []
        for row_reqd, row_req, row_srsreqd, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            type_id = row_type.id if row_type else sys.maxsize
            type_id = 0 if row_req.type_code == "1" else type_id
            key = (-row_sdsdoc.id, type_id, row_req.code)
            sorted_rows.append((key, (row_reqd, row_req, row_srsreqd, row_type, row_sdsdoc, row_srsdoc, row_product)))
        sorted_rows.sort(key=lambda x: x[0])

        exist_codes = set()
        filtered_rows = []
        for row in sorted_rows:
            ucode = f"{row[0][0]}_{row[0][2]}"
            if ucode not in exist_codes:
                exist_codes.add(ucode)
                filtered_rows.append(row[1])

        filtered_rows.sort(key=lambda x: (-x[4].id, x[1].code))
        return filtered_rows


    async def list_sds_reqd(self, op_user: UserObj, prod_id: int = None, doc_id: int = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 

        sql = select(SdsReqd, SrsReq, SrsReqd, SrsType, SdsDoc, SrsDoc, Product)
        sql = sql.join(SrsReq, SdsReqd.req_id == SrsReq.id)
        sql = sql.outerjoin(SrsReqd,  SrsReq.id == SrsReqd.req_id)
        sql = sql.outerjoin(SrsType, SrsReq.type_code == SrsType.type_code)
        sql = sql.outerjoin(SrsDoc, SrsReq.doc_id == SrsDoc.id)
        sql = sql.outerjoin(Product, SrsDoc.product_id == Product.id)
        sql = sql.where(SdsReqd.doc_id == SdsDoc.id).where(SdsDoc.srsdoc_id == SrsDoc.id)
        sql = sql.where(or_(SrsType.doc_id == SrsReq.doc_id, SrsReq.type_code.in_(["1", "2"])))
        if prod_id:
            sql = sql.where(Product.id == prod_id)
        if doc_id:
            sql = sql.where(SdsDoc.id == doc_id)
        if not prod_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(SdsDoc.id), SrsReq.code)
        rows: List[Tuple[SdsReqd, SrsReq, SrsReqd, SrsType, SdsDoc, SrsDoc, Product]] = db.session.execute(sql).all()
        rows = self.__resort_rows(rows)
        objs = []
        for row_reqd, row_req, row_srsreqd, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            obj = SdsReqdObj(**row_reqd.dict())
            obj.srs_code = row_req.code
            if row_srsreqd:
                obj.name = row_srsreqd.name or row_req.sub_function or row_req.function or row_req.module
                obj.overview = row_reqd.overview or row_srsreqd.overview
                obj.func_detail = row_reqd.func_detail or row_srsreqd.work_flow
            else:
                obj.name = row_req.sub_function or row_req.function or row_req.module
            obj.module = row_req.module
            obj.function = row_req.function
            obj.sub_function = row_req.sub_function
            if row_srsdoc:
                obj.srsdoc_version = row_srsdoc.version
            if row_sdsdoc:
                obj.sdsdoc_version = row_sdsdoc.version
            if row_product:
                obj.product_name = row_product.name
                obj.product_version = row_product.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        
    async def get_sds_reqd(self, id: int):
        sql = select(SdsReqd, SrsReq, SrsReqd)
        sql = sql.join(SrsReq, SdsReqd.req_id == SrsReq.id)
        sql = sql.outerjoin(SrsReqd, SrsReq.id == SrsReqd.req_id)
        sql = sql.where(SdsReqd.id == id)
        row_reqd, row_req, row_srsreqd = db.session.execute(sql).first() or (None, None, None)
        if not row_reqd:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        
        sql = select(Logic).where(Logic.reqd_id == id).order_by(Logic.id)
        rows: List[Logic] = db.session.execute(sql).scalars().all()
        logics = [LogicForm(**row.dict()) for row in rows]

        obj = SdsReqdObj(**row_reqd.dict(), srs_code=row_req.code)
        obj.logics = logics
        obj.name = row_req.sub_function or row_req.function or row_req.module
        obj.overview = row_reqd.overview or row_srsreqd.overview
        obj.func_detail = row_reqd.func_detail or row_srsreqd.work_flow
        return Resp.resp_ok(data=obj)
    