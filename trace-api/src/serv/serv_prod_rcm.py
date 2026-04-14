import logging
import os
from typing import List
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from sqlalchemy.dialects.postgresql import insert as pg_insert
from openpyxl import load_workbook
from openpyxl.styles import Alignment
from ..obj.vobj_user import UserObj
from ..model.test_set import TestSet
from ..model.srs_doc import SrsDoc
from ..model.srs_req import ReqRcm
from ..model.product import Product, UserProd
from ..model.test_case import TestCase
from ..model.rcm import Rcm
from ..model.srs_req import SrsReq
from ..model.prod_rcm import ProdRcm
from ..obj.tobj_prod_rcm import ProdRcmsForm
from ..obj.vobj_prod_rcm import ProdRcmObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    async def add_prod_rcms(self, form: ProdRcmsForm):
        try:
            values = []
            for rcm_id in form.rcm_ids:
                values.append(dict(prod_id=form.prod_id, rcm_id=rcm_id))
            db.session.execute(pg_insert(ProdRcm).values(values).on_conflict_do_nothing())
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_prod_rcms(self, ids: List[str]):
        if ids:
            db.session.execute(delete(ProdRcm).where(ProdRcm.id.in_(ids)))
            db.session.commit()
        return Resp.resp_ok()
    
    def __query_srs_reqs(self, rcm_ids: List[int]) -> List[str]:
        sql = select(ReqRcm, SrsReq, SrsDoc).join(SrsReq, ReqRcm.req_id == SrsReq.id)
        sql = sql.join(SrsDoc, SrsReq.doc_id == SrsDoc.id)
        sql = sql.where(ReqRcm.rcm_id.in_(rcm_ids)).order_by(SrsReq.code)
        results = dict()
        srs_codes = []        
        for req_rcm, row_srs, row_doc in db.session.execute(sql):
            key = (row_doc.product_id, req_rcm.rcm_id)
            reqs = results.get(key) or []
            reqs.append(row_srs)
            results[key] = reqs
            srs_codes.append(row_srs.code)
        return srs_codes, results
    
    def __query_tests(self, srs_codes: List[str]) -> dict:
        sql = select(TestCase, TestSet).join(TestSet, TestCase.set_id == TestSet.id)
        sql = sql.where(TestCase.srs_code.in_(srs_codes)).order_by(TestCase.set_id, TestCase.code)
        rows: list[TestCase, TestSet] = db.session.execute(sql).all()
        results = dict()
        for row_test, row_set in rows:
            results.setdefault((row_set.product_id, row_test.srs_code), []).append(row_test)
        return results
    
    def __merge_tests(self, product_id, srs_codes: List[str], tests_dict: dict) -> List[str]:
        test_sets = dict()
        uniq_sets = dict()
        for srs_code in srs_codes:
            tests = tests_dict.get((product_id, srs_code)) or []
            for test in tests:
                key = (srs_code, test.set_id)
                uniq_set = uniq_sets.setdefault(key, set())
                if test.code not in uniq_set:
                    uniq_set.add(test.code)
                    test_sets.setdefault(key, []).append(test.code)
        results = []
        for key, tests in test_sets.items():
            if len(tests) > 1:
                result = "~".join([tests[0], tests[-1]])
                results.append(result)
            elif len(tests) == 1:
                results.append(tests[0])
        return results

    async def list_prod_rcm(self, op_user: UserObj, export = False, prod_id: int = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 

        sql = select(ProdRcm, Product, Rcm).join(Product, ProdRcm.prod_id == Product.id).outerjoin(Rcm, ProdRcm.rcm_id == Rcm.id)
        if prod_id:
            sql = sql.where(ProdRcm.prod_id == prod_id)
        if not prod_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))
        total = 0
        if not export:
            sql_count = select(func.count()).select_from(sql)
            total = db.session.execute(sql_count).scalars().first()
        sql = sql.order_by(Rcm.code)
        rows: list[ProdRcm, Product, Rcm] = db.session.execute(sql).all()
        objs = []
        all_srs_codes, reqs_dict = self.__query_srs_reqs([prod_rcm.rcm_id for prod_rcm, _, _ in rows])
        tests_dict = self.__query_tests(all_srs_codes)
        for row, row_prd, row_rcm in rows:
            obj = ProdRcmObj(**row_rcm.dict()) if row_rcm else ProdRcmObj()
            obj.id = row.id
            obj.rcm_id = row.rcm_id
            obj.create_time = row.create_time
            reqs = reqs_dict.get((row_prd.id, row.rcm_id)) or []
            obj.srs_codes = list(dict.fromkeys([req.code for req in reqs])) 
            obj.srs_flag = True if obj.srs_codes else False
            obj.test_codes = self.__merge_tests(row_prd.id, obj.srs_codes, tests_dict)
            
            obj.product_name = row_prd.name
            obj.product_version = row_prd.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))

    export_columns = [
        "code",
        "description",
        "srs_flag",
        "srs_codes",
        "test_codes",
        "proof",
        "note",
    ]

    async def export_prod_rcms(self, op_user: UserObj, output, *args, **kwargs):
        resp = await self.list_prod_rcm(op_user, *args, **kwargs)
        rows = resp.data.rows or []

        temp_path = os.path.join(os.path.dirname(__file__), "temp_prod_rcm.xlsx")
        wb = load_workbook(temp_path)
        ws = wb[wb.sheetnames[0]]
        for ridx, row in enumerate(rows, 2):
            obj = row.dict()
            for cidx, key in enumerate(self.export_columns, 1):
                value = obj.get(key)
                if key == "srs_codes" or key == "test_codes":
                    value = "，\n".join(value)
                if key == "srs_flag":
                    value = ts("yes") if value else ts("no")
                ws.cell(row=ridx, column=cidx, value=value)

        align = Alignment(vertical='center', wrap_text=True)
        for row in ws.iter_rows():
            for cell in row:
                cell.alignment = align
        wb.save(output)
        output.seek(0)
        