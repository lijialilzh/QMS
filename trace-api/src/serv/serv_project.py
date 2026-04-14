import logging
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from ..model.product import Product
from ..obj.vobj_project import ProjectObj
from ..model.project import Project
from ..obj.tobj_project import ProjectForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    async def add_project(self, form: ProjectForm):
        try:
            sql = select(func.count(Project.id)).where(Project.name == form.name)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            
            row = Project(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_project(self, id):
        sql = select(func.count(Product.id)).where(Product.project_id == id)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_proj_x_product"))
        db.session.execute(delete(Project).where(Project.id == id))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_project(self, form: ProjectForm):
        try:
            sql = select(Project).where(Project.id == form.id)
            row:Project = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict().items():
                if key == "id":
                    continue
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def get_project(self, id:str):
        sql = select(Project).where(Project.id == id)
        row = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        return Resp.resp_ok(data=ProjectObj(**row.dict()))

    async def list_project(self, name: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(Project)
        if name:
            sql = sql.where(Project.name.like(f"%{name}%"))
        
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(Project.create_time))
        rows: list[Project] = db.session.execute(sql).scalars().all()
        project_ids = [row.id for row in rows]
        prod_count_dict = {}
        if project_ids:
            sql_prod_count = (
                select(Product.project_id, func.count(Product.id))
                .where(Product.project_id.in_(project_ids))
                .group_by(Product.project_id)
            )
            prod_count_dict = {pid: cnt for pid, cnt in db.session.execute(sql_prod_count).all()}

        objs = []
        for row in rows:
            obj = ProjectObj(**row.dict(), product_count=prod_count_dict.get(row.id, 0))
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
      