import logging
from sqlalchemy import select, delete, func, or_
from ..obj.vobj_company_info import CompanyInfoObj
from ..model.company_info import CompanyInfo
from ..obj.tobj_company_info import CompanyInfoForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):
    async def add_company_info(self, form: CompanyInfoForm):
        try:
            row = CompanyInfo(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_company_info(self, id):
        db.session.execute(delete(CompanyInfo).where(CompanyInfo.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def update_company_info(self, form: CompanyInfoForm):
        try:
            sql = select(CompanyInfo).where(CompanyInfo.id == form.id)
            row: CompanyInfo = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict().items():
                if key == "id" or value is None:
                    continue
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def get_company_info(self, id: str):
        sql = select(CompanyInfo).where(CompanyInfo.id == id)
        row = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        return Resp.resp_ok(data=CompanyInfoObj(**row.dict()))

    async def list_company_info(self, fuzzy: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10

        sql = select(CompanyInfo)
        if fuzzy:
            sql = sql.where(
                or_(
                    CompanyInfo.registrant.like(f"%{fuzzy}%"),
                    CompanyInfo.address.like(f"%{fuzzy}%"),
                    CompanyInfo.manufacturer.like(f"%{fuzzy}%"),
                    CompanyInfo.production_address.like(f"%{fuzzy}%"),
                    CompanyInfo.production_license_no.like(f"%{fuzzy}%"),
                    CompanyInfo.contact_phone.like(f"%{fuzzy}%"),
                )
            )

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(CompanyInfo.id.desc())
        rows: list[CompanyInfo] = db.session.execute(sql).scalars().all()
        objs = [CompanyInfoObj(**row.dict()) for row in rows]
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
