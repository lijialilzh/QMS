import logging
from sqlalchemy import select, delete, func, or_
from sqlalchemy.sql import asc
from ..model.prod_hospital import ProdHospital
from ..obj.tobj_prod_hospital import ProdHospitalForm
from ..obj.vobj_prod_hospital import ProdHospitalObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    async def add_prod_hospital(self, form: ProdHospitalForm):
        try:
            if not form.prod_id:
                return Resp.resp_err(msg=ts("msg_err_param"))
            row = ProdHospital(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_prod_hospital(self, form: ProdHospitalForm):
        try:
            sql = select(ProdHospital).where(ProdHospital.id == form.id)
            row: ProdHospital = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict().items():
                if key in ("id", "prod_id"):
                    continue
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_prod_hospitals(self, ids: list):
        ids = [int(i) for i in (ids or []) if str(i).strip().isdigit()]
        if not ids:
            return Resp.resp_err(msg=ts("msg_err_param"))
        db.session.execute(delete(ProdHospital).where(ProdHospital.id.in_(ids)))
        db.session.commit()
        return Resp.resp_ok()

    async def list_prod_hospital(self, prod_id: int = None, fuzzy: str = None,
                                 page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10
        if not prod_id:
            return Resp.resp_ok(data=Page(total=0, page_size=page_size, rows=[], page_index=page_index))

        sql = select(ProdHospital).where(ProdHospital.prod_id == prod_id)
        kw = (fuzzy or "").strip()
        if kw:
            like = f"%{kw}%"
            sql = sql.where(or_(
                ProdHospital.contract_no.like(like),
                ProdHospital.org_name.like(like),
                ProdHospital.hospital_no.like(like),
            ))

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.order_by(asc(ProdHospital.sort_order), asc(ProdHospital.id))
        sql = sql.offset(page_size * page_index).limit(page_size)
        rows: list[ProdHospital] = db.session.execute(sql).scalars().all()
        objs = [ProdHospitalObj(**row.dict()) for row in rows]
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
