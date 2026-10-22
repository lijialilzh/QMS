import logging
from sqlalchemy import select, delete, func, or_
from sqlalchemy.sql import asc
from ..model.prod_algo_chapter import ProdAlgoChapter
from ..model.model_doc import ModelDoc
from ..model.data_doc import DataDoc
from ..obj.tobj_prod_algo_chapter import ProdAlgoChapterForm
from ..obj.vobj_prod_algo_chapter import ProdAlgoChapterObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


def _ensure_records(prod_id, chapter_id):
    # 建记录失败不影响模块本身的保存。
    from .serv_data_doc import ensure_module_records
    from .serv_model_doc import ensure_module_docs
    from ..model.prod_algo_module import ProdAlgoModule
    try:
        made = ensure_module_records(prod_id, chapter_id)
        ch = db.session.execute(select(ProdAlgoChapter).where(ProdAlgoChapter.id == chapter_id)).scalars().first()
        name = str(getattr(ch, "name", "") or "").strip()
        is_nav = name and db.session.execute(
            select(ProdAlgoModule.id).where(ProdAlgoModule.prod_id == prod_id, ProdAlgoModule.name == name)
        ).first()
        if is_nav:
            made += ensure_module_docs(prod_id, chapter_id)
        if made:
            db.session.commit()
    except Exception:
        logger.exception("")
        db.session.rollback()


class Server(object):

    async def add_prod_algo_chapter(self, form: ProdAlgoChapterForm):
        try:
            if not form.prod_id:
                return Resp.resp_err(msg=ts("msg_err_param"))
            row = ProdAlgoChapter(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.commit()
            _ensure_records(row.prod_id, row.id)
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_prod_algo_chapter(self, form: ProdAlgoChapterForm):
        try:
            sql = select(ProdAlgoChapter).where(ProdAlgoChapter.id == form.id)
            row: ProdAlgoChapter = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict().items():
                if key in ("id", "prod_id"):
                    continue
                setattr(row, key, value)
            db.session.commit()
            _ensure_records(row.prod_id, row.id)
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_prod_algo_chapters(self, ids: list):
        ids = [int(i) for i in (ids or []) if str(i).strip().isdigit()]
        if not ids:
            return Resp.resp_err(msg=ts("msg_err_param"))
        # 只删恰好以 _m{章节id} 结尾的文件，避免 _m1 误伤 _m18。
        conds = [ModelDoc.doc_type.op("~")(rf"_m{i}$") for i in ids]
        db.session.execute(delete(ModelDoc).where(or_(*conds)))
        dconds = [DataDoc.doc_type.op("~")(rf"_m{i}$") for i in ids]
        db.session.execute(delete(DataDoc).where(or_(*dconds)))
        db.session.execute(delete(ProdAlgoChapter).where(ProdAlgoChapter.id.in_(ids)))
        db.session.commit()
        return Resp.resp_ok()

    async def list_prod_algo_chapter(self, prod_id: int = None, page_index: int = 0, page_size: int = 100):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 100
        sql = select(ProdAlgoChapter)
        if prod_id:
            sql = sql.where(ProdAlgoChapter.prod_id == prod_id)
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.order_by(asc(ProdAlgoChapter.prod_id), asc(ProdAlgoChapter.sort_order), asc(ProdAlgoChapter.id))
        sql = sql.offset(page_size * page_index).limit(page_size)
        rows: list[ProdAlgoChapter] = db.session.execute(sql).scalars().all()
        objs = [ProdAlgoChapterObj(**row.dict()) for row in rows]
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))