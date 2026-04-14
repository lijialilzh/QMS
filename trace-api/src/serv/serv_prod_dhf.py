import logging
import io
import os
from openpyxl import load_workbook
from typing import List
from sqlalchemy import select, delete, func, or_
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..model.product import Product, UserProd
from ..model.prod_dhf import ProdDhf
from ..obj.tobj_prod_dhf import ProdDhfForm
from ..obj.vobj_prod_dhf import ProdDhfObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):
    @staticmethod
    def __to_str(value):
        if value is None:
            return ""
        return str(value).strip()

    async def add_prod_dhf(self, form: ProdDhfForm):
        try:
            sql = select(func.count(ProdDhf.id)).where(ProdDhf.prod_id == form.prod_id, ProdDhf.code == form.code)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = ProdDhf(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def import_prod_dhfs(self, prod_id: int, file):
        try:
            bys = await file.read()
            wb = load_workbook(io.BytesIO(bys), data_only=True)
            ws = wb[wb.sheetnames[0]]
            affected = 0
            for row in ws.iter_rows(min_row=2, values_only=True):
                # 模板列：序号、编号、名称
                code = self.__to_str(row[1] if len(row) > 1 else None)
                name = self.__to_str(row[2] if len(row) > 2 else None)
                if not code:
                    continue
                existed = db.session.execute(
                    select(ProdDhf).where(ProdDhf.prod_id == prod_id, ProdDhf.code == code)
                ).scalars().first()
                if existed:
                    existed.name = name
                else:
                    db.session.add(ProdDhf(prod_id=prod_id, code=code, name=name))
                affected += 1
            db.session.commit()
            return Resp.resp_ok(data={"count": affected})
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    async def update_prod_dhf(self, form: ProdDhfForm):
        try:
            sql = select(func.count(ProdDhf.id)).where(ProdDhf.prod_id == form.prod_id, ProdDhf.code == form.code, ProdDhf.id != form.id)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            sql = select(ProdDhf).where(ProdDhf.id == form.id)
            row:ProdDhf = db.session.execute(sql).scalars().first()
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
   
    async def delete_prod_dhf(self, id: int):
        db.session.execute(delete(ProdDhf).where(ProdDhf.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def delete_prod_dhfs(self, ids: List[int]):
        if not ids:
            return Resp.resp_ok()
        db.session.execute(delete(ProdDhf).where(ProdDhf.id.in_(ids)))
        db.session.commit()
        return Resp.resp_ok()
    
    async def get_prod_dhf(self, id: int):
        sql = select(ProdDhf, Product).outerjoin(Product, ProdDhf.prod_id == Product.id).where(ProdDhf.id == id)
        row:ProdDhf = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        row, row_prod = row
        obj = ProdDhfObj(**row.dict())
        if row_prod:
            obj.product_name = row_prod.name
            obj.product_version = row_prod.full_version
        return Resp.resp_ok(data=obj) 

    async def list_prod_dhf(self, op_user: UserObj, export=False, prod_id: int = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 

        sql = select(ProdDhf, Product).outerjoin(Product, ProdDhf.prod_id == Product.id)
        if prod_id:
            sql = sql.where(ProdDhf.prod_id == prod_id)

        if not prod_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            # 兼容历史数据：若产品未建立 UserProd 关联，也允许创建人看到其DHF。
            sql = sql.where(or_(Product.id.in_(subquery), Product.create_user_id == op_user.id))

        total = 0
        if not export:
            sql_count = select(func.count()).select_from(sql)
            total = db.session.execute(sql_count).scalars().first()

        sql = sql.order_by(ProdDhf.code)
        if not export:
            sql = sql.offset(page_size * page_index).limit(page_size)
        rows: List[ProdDhf, Product] = db.session.execute(sql).all()
        objs = []
        for row, row_prod in rows:
            obj = ProdDhfObj(**row.dict())
            if row_prod:
                obj.product_name = row_prod.name
                obj.product_version = row_prod.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        
    
    export_columns = ["code", "name"]
    
    async def export_prod_dhfs(self, op_user: UserObj, output, *args, **kwargs):
        resp = await self.list_prod_dhf(op_user, export=True, *args, **kwargs)
        rows = resp.data.rows or []

        temp_path = os.path.join(os.path.dirname(__file__), "temp_prod_dhf.xlsx")
        wb = load_workbook(temp_path)
        ws = wb[wb.sheetnames[0]]
        for ridx, row in enumerate(rows, 2):
            obj = row.dict()
            ws.cell(row=ridx, column=1, value=ridx-1)
            for cidx, key in enumerate(self.export_columns, 2):
                value = obj.get(key)
                ws.cell(row=ridx, column=cidx, value=value)
        wb.save(output)
        output.seek(0)
