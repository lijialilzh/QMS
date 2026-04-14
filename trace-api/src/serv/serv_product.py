import logging
import os
from typing import List, Tuple
from sqlalchemy import select, delete, func, or_
from sqlalchemy.sql import desc
from openpyxl import load_workbook

from ..obj.vobj_user import UserObj
from ..obj.tobj_role import Roles
from ..model.doc_file import DocFile
from ..model.project import Project
from ..model.prod_dhf import ProdDhf
from ..model.test_set import TestSet
from ..model.sds_doc import SdsDoc
from ..obj.vobj_product import ProductObj, TraceObj
from ..model.product import UserProd, Product
from ..model.srs_doc import SrsDoc
from ..obj.tobj_product import ProductForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    async def add_product(self, op_user: UserObj, form: ProductForm):
        try:
            sql = select(func.count(Product.id)).where(Product.name == form.name, Product.full_version == form.full_version)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            user_ids = form.user_ids or []
            form.user_ids = None
            row = Product(**form.dict(exclude_none=True))
            row.id = None
            row.create_user_id = op_user.id
            if op_user.role_code == Roles.product_manager.value.code:
                user_ids = [op_user.id]
            elif not user_ids:
                # 产品管理页目前不再传 user_ids，默认关联当前操作人，避免“新增成功但列表不可见”。
                user_ids = [op_user.id]
            db.session.add(row)
            db.session.flush()
            if user_ids:
                db.session.add_all([UserProd(user_id=user_id, product_id=row.id) for user_id in user_ids])
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_product(self, id):
        sql = select(func.count(SrsDoc.id)).where(SrsDoc.product_id == id)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_prod_x_srsdoc"))

        sql = select(func.count(TestSet.id)).where(TestSet.product_id == id)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_prod_x_testset"))
        
        sql = select(func.count(ProdDhf.id)).where(ProdDhf.prod_id == id)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_prod_x_proddhf"))
        
        sql = select(func.count(DocFile.id)).where(DocFile.product_id == id)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_prod_x_docfile"))

        db.session.execute(delete(Product).where(Product.id == id))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_product(self, op_user: UserObj, form: ProductForm):
        try:
            sql = select(func.count(Product.id)).where(Product.name == form.name, Product.full_version == form.full_version, Product.id != form.id)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            sql = select(Product).where(Product.id == form.id)
            row:Product = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            if op_user.role_code == Roles.product_manager.value.code and row.create_user_id != op_user.id:
                return Resp.resp_err(msg=ts("msg_no_perm"))
            user_ids = form.user_ids
            form.user_ids = None
            if op_user.role_code == Roles.product_manager.value.code:
                user_ids = [op_user.id]
            for key, value in form.dict(exclude_none=True).items():
                if key == "id" or value is None:
                    continue
                setattr(row, key, value)
            if user_ids is not None:
                db.session.execute(delete(UserProd).where(UserProd.product_id == row.id))
                if user_ids:
                    db.session.add_all([UserProd(user_id=user_id, product_id=row.id) for user_id in user_ids])
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def get_product(self, id:str, with_trace: int = 0):
        sql = select(Product).where(Product.id == id)
        row = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        obj = ProductObj(**row.dict())
        if with_trace:
            traces_dict = self.__query_traces([row])
            obj.traces = traces_dict.get(row.id, [])
            obj.srs_versions = list(dict.fromkeys([trace.srsdoc_version for trace in obj.traces]))
            obj.sds_versions = list(dict.fromkeys([trace.sdsdoc_version for trace in obj.traces]))
        return Resp.resp_ok(data=obj)
    
    async def export_product_trace(self, output, id: int):
        def __fix(rid, prod: ProductObj):
            ws.cell(row=rid, column=1, value=prod.name)
            ws.cell(row=rid, column=2, value=prod.type_code)
            ws.cell(row=rid, column=3, value=prod.full_version)

        resp = await self.get_product(id, with_trace=1)
        prod = resp.data
        if not prod:
            return
        temp_path = os.path.join(os.path.dirname(__file__), "temp_product_trace.xlsx")
        wb = load_workbook(temp_path)
        ws = wb[wb.sheetnames[0]]
        rid = 1
        for srs in prod.srs_versions:
            rid += 1
            __fix(rid, prod)
            ws.cell(row=rid, column=4, value=ts("product.doc_srs"))
            ws.cell(row=rid, column=5, value=srs)
        for sds in prod.sds_versions:
            rid += 1
            __fix(rid, prod)
            ws.cell(row=rid, column=4, value=ts("product.doc_sds"))
            ws.cell(row=rid, column=5, value=sds)
        wb.save(output)
        output.seek(0)

    def __query_traces(self, objs: List[Product]):
        sql = select(SdsDoc, SrsDoc).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id).where(SrsDoc.product_id.in_([obj.id for obj in objs])).order_by(SrsDoc.id, SdsDoc.id)
        rows: List[SdsDoc, SrsDoc] = db.session.execute(sql).all()
        result_dict = dict()
        for row_sds, row_srs in rows:
            trace = TraceObj(sdsdoc_version=row_sds.version, srsdoc_version=row_srs.version)
            result_dict.setdefault(row_srs.product_id, []).append(trace)
        return result_dict

    async def list_product(self, op_user: UserObj, export = False, fuzzy: str = None, with_trace: int = 0, page_index: int = 0, page_size: int = 10):
        def __query_users(prod_ids: List[int]):
            result_dict = dict()
            if prod_ids:
                sql = select(UserProd.user_id, UserProd.product_id).where(UserProd.product_id.in_(prod_ids))
                rows: List[Tuple[int, int]] = db.session.execute(sql).all()
                for row_user, row_prod in rows:
                    result_dict.setdefault(row_prod, []).append(row_user)
            return result_dict
        
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(Product, Project).outerjoin(Project, Product.project_id == Project.id)
        if fuzzy:
            sql = sql.where(
                or_(
                    Product.name.like(f"%{fuzzy}%"),
                    Product.category.like(f"%{fuzzy}%"),
                    Product.type_code.like(f"%{fuzzy}%"),
                    Product.full_version.like(f"%{fuzzy}%"),
                    Product.release_version.like(f"%{fuzzy}%"),
                    Product.udi.like(f"%{fuzzy}%"),
                    Product.product_code.like(f"%{fuzzy}%"),
                    Product.scope.like(f"%{fuzzy}%"),
                    Product.component.like(f"%{fuzzy}%"),
                    Product.note.like(f"%{fuzzy}%"),
                )
            )
        if op_user.id != 1 and op_user.role_code == Roles.product_manager.value.code:
            sql = sql.where(Product.create_user_id == op_user.id)
        elif op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            # 兼容历史数据：早期新增产品可能缺少 UserProd 关联，但 create_user_id 已记录。
            sql = sql.where(or_(Product.id.in_(subquery), Product.create_user_id == op_user.id))
        
        total = 0
        if not export:
            sql_count = select(func.count()).select_from(sql)
            total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(Product.create_time))
        rows: List[Tuple[Product, Project]] = db.session.execute(sql).all()
        prod_users = __query_users( [row[0].id for row in rows])
        objs: List[ProductObj] = []
        for row, row_proj in rows:
            obj = ProductObj(**row.dict())
            obj.user_ids = prod_users.get(row.id, [])
            if row_proj:
                obj.country = row_proj.country
            objs.append(obj)
        if with_trace:
            traces_dict = self.__query_traces(objs)
            for obj in objs:
                obj.traces = traces_dict.get(obj.id, [])
                obj.srs_versions = list(dict.fromkeys([trace.srsdoc_version for trace in obj.traces]))
                obj.sds_versions = list(dict.fromkeys([trace.sdsdoc_version for trace in obj.traces]))
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
      
    export_columns = [
        "name",
        "country",
        "category",
        "type_code",
        "full_version",
        "release_version",
        "udi",
        "product_code",
        "scope",
        "component",
        "note",
        "create_time"
    ]

    async def export_products(self, output, op_user: UserObj, *args, **kwargs):
        resp = await self.list_product(op_user, export=True, *args, **kwargs)
        rows = resp.data.rows or []

        temp_path = os.path.join(os.path.dirname(__file__), "temp_product.xlsx")
        wb = load_workbook(temp_path)
        ws = wb[wb.sheetnames[0]]
        for ridx, row in enumerate(rows, 2):
            obj = row.dict()
            for cidx, key in enumerate(self.export_columns, 1):
                value = obj.get(key)
                ws.cell(row=ridx, column=cidx, value=value)
        wb.save(output)
        output.seek(0)
        