import logging
from sqlalchemy import select, delete, func, or_
from ..obj.vobj_person_sign import PersonSignObj
from ..model.person_sign import PersonSign
from ..obj.tobj_person_sign import PersonSignForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):
    async def add_person_sign(self, form: PersonSignForm):
        try:
            row = PersonSign(**form.dict(exclude_none=True))
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_person_sign(self, id):
        db.session.execute(delete(PersonSign).where(PersonSign.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def update_person_sign(self, form: PersonSignForm):
        try:
            sql = select(PersonSign).where(PersonSign.id == form.id)
            row: PersonSign = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            # 图片/状态允许清空，故对这些字段即使为 None 也需按前端传入更新
            data = form.dict()
            for key, value in data.items():
                if key == "id":
                    continue
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def get_person_sign(self, id: str):
        sql = select(PersonSign).where(PersonSign.id == id)
        row = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        return Resp.resp_ok(data=PersonSignObj(**row.dict()))

    async def list_person_sign(self, fuzzy: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10

        sql = select(PersonSign)
        if fuzzy:
            sql = sql.where(
                or_(
                    PersonSign.name.like(f"%{fuzzy}%"),
                    PersonSign.position.like(f"%{fuzzy}%"),
                    PersonSign.status.like(f"%{fuzzy}%"),
                )
            )

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(PersonSign.sort_order.asc(), PersonSign.id.asc())
        rows: list[PersonSign] = db.session.execute(sql).scalars().all()
        objs = [PersonSignObj(**row.dict()) for row in rows]
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
