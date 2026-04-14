import logging
import io
from openpyxl import load_workbook
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from sqlalchemy.exc import IntegrityError
from ..obj.vobj_user import UserObj
from ..model.product import Product, UserProd
from ..obj.vobj_test_set import TestSetObj
from ..model.test_set import TestSet
from ..model.test_case import TestCase
from ..obj.tobj_test_set import TestSetForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    async def __read_excel(self, file):
        try:
            bys = await file.read()
            wb = load_workbook(io.BytesIO(bys))
            ws = wb[wb.sheetnames[0]]
            test_cases = []
            for row in ws.iter_rows(min_row=2, values_only=True):
                test_case = TestCase(
                    code=str(row[0]), 
                    srs_code=str(row[1]), 
                    test_type=row[2] or "", 

                    function=row[4] or "", 
                    description=row[5] or "", 
                    precondition=row[6] or "", 
                    test_step=row[7] or "", 
                    expect=row[8] or "", 
                    note=row[9] or ""
                )
                test_cases.append(test_case)
            return None, test_cases
        except IntegrityError:
            logger.exception("")
            return ts("msg_dup_row"), None
        except Exception:
            logger.exception("")
            return ts(msg_err_db), None
    

    async def add_test_set(self, form: TestSetForm, file):
        try:
            sql = select(func.count(TestSet.id)).where(TestSet.product_id == form.product_id, TestSet.stage == form.stage)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            
            row = TestSet(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.flush()
            if file:
                err, test_cases = await self.__read_excel(file)
                if err:
                    return Resp.resp_err(msg=err)
                logger.info("test_cases: %s", len(test_cases))
                for test_case in test_cases:
                    test_case.set_id = row.id
                    logger.info("test_case: %s %s %s %s %s %s %s %s %s", 
                                test_case.code,
                                len(test_case.code), 
                                len(test_case.srs_code), 
                                len(test_case.function), 
                                len(test_case.description), 
                                len(test_case.precondition), 
                                len(test_case.test_step), 
                                len(test_case.expect), 
                                len(test_case.note)
                                )
                    db.session.add(test_case)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_test_set(self, id):
        db.session.execute(delete(TestSet).where(TestSet.id == id))
        db.session.execute(delete(TestCase).where(TestCase.set_id == id))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_test_set(self, form: TestSetForm, file):
        try:
            sql = select(func.count(TestSet.id)).where(TestSet.product_id == form.product_id, TestSet.stage == form.stage, TestSet.id != form.id)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))

            sql = select(TestSet).where(TestSet.id == form.id)
            row:TestSet = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            
            for key, value in form.dict().items():
                if key == "id" or value is None:
                    continue
                setattr(row, key, value)
            if file:
                db.session.execute(delete(TestCase).where(TestCase.set_id == row.id))
                err, test_cases = await self.__read_excel(file)
                if err:
                    return Resp.resp_err(msg=err)
                for test_case in test_cases:
                    test_case.set_id = row.id
                    db.session.add(test_case)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def get_test_set(self, id:str):
        sql = select(TestSet).where(TestSet.id == id)
        row = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        return Resp.resp_ok(data=TestSetObj(**row.dict()))

    async def list_test_set(self, op_user: UserObj, product_id: int = None, stage: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(TestSet, Product).outerjoin(Product, TestSet.product_id == Product.id)
        if product_id:
            sql = sql.where(TestSet.product_id == product_id)
        if stage:
            sql = sql.where(TestSet.stage == stage)
        if not product_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(TestSet.create_time))
        rows: list[TestSet] = db.session.execute(sql).all()

        objs = []
        for row, row_prd in rows:
            obj = TestSetObj(**row.dict())
            if row_prd:
                obj.product_name = row_prd.name
                obj.product_version = row_prd.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
             