import logging
from sqlalchemy import select, delete, func, or_
from sqlalchemy.sql import desc
from ..model.srs_req import SrsReq
from ..model.srs_type import SrsType
from ..obj.tobj_srs_type import SrsTypeForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..utils import get_uuid
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    async def add_srs_type(self, form: SrsTypeForm):
        try:  
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
        if row:
            db.session.execute(delete(SrsReq).where(SrsReq.type_code == row.type_code))
        db.session.execute(delete(SrsType).where(SrsType.id == id))
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
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(SrsType.id)
        rows: list[SrsType] = db.session.execute(sql).scalars().all()
        objs = []
        for row in rows:
            obj = SrsTypeForm(**row.dict())
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
