import logging
import os
from sqlalchemy import select, delete, func, or_
from sqlalchemy.sql import desc
from openpyxl import load_workbook

from ..model.product import Product
from ..model.test_set import TestSet
from ..obj.vobj_test_case import TestCaseObj
from ..model.test_case import TestCase
from ..obj.tobj_test_case import TestCaseForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    async def add_test_case(self, form: TestCaseForm):
        try:
            sql = select(func.count(TestCase.id)).where(TestCase.code == form.code)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            
            row = TestCase(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_test_case(self, id):
        db.session.execute(delete(TestCase).where(TestCase.id == id))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_test_case(self, form: TestCaseForm):
        try:
            sql = select(TestCase).where(TestCase.id == form.id)
            row:TestCase = db.session.execute(sql).scalars().first()
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
   
    async def get_test_case(self, id:str):
        sql = select(TestCase).where(TestCase.id == id)
        row = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        return Resp.resp_ok(data=TestCaseObj(**row.dict()))

    async def list_test_case(self, set_id: int):
        sql = select(TestCase, TestSet, Product).outerjoin(TestSet, TestCase.set_id == TestSet.id).outerjoin(Product, TestSet.product_id == Product.id)
        sql = sql.where(TestCase.set_id == set_id)
        sql = sql.order_by(TestCase.id)
        rows: list[TestCase, TestSet, Product] = db.session.execute(sql).all()
        objs = []
        for row, row_set, row_prd in rows:
            obj = TestCaseObj(**row.dict())
            if row_set:
                obj.stage = row_set.stage
            if row_prd:
                obj.product_name = row_prd.name
                obj.product_version = row_prd.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(rows=objs))
      
    export_columns = [
        "code",
        "srs_code",
        "test_type",
        "stage",
        "function",
        "description",
        "precondition",
        "test_step",
        "expect",
        "note",
    ]

    def __write_export_sheet(self, ws, group_rows):
        if ws.max_row and ws.max_row > 1:
            ws.delete_rows(2, ws.max_row - 1)
        for ridx, row in enumerate(group_rows, 2):
            obj = row.dict() if hasattr(row, "dict") else dict(row)
            for cidx, key in enumerate(self.export_columns, 1):
                ws.cell(row=ridx, column=cidx, value=obj.get(key))

    async def export_test_cases(self, output, *args, **kwargs):
        """导出数据集：单元/集成/系统 → 测试记录模版 xlsx；其它阶段 → 用例表（按 sheet_name 分 sheet）。"""
        from collections import OrderedDict
        import re

        set_id = kwargs.get("set_id")
        if set_id is None and args:
            set_id = args[0]
        stage = None
        product_id = None
        if set_id:
            ts_row = db.session.execute(select(TestSet).where(TestSet.id == set_id)).scalars().first()
            if ts_row:
                stage = ts_row.stage
                product_id = ts_row.product_id
        if stage in ("单元测试", "集成测试", "系统测试") and product_id:
            from .serv_dev_test_record_doc import Server as DevRecordServer
            await DevRecordServer().ensure_from_case_import(product_id, stage)
            DevRecordServer().export_record_xlsx(output, product_id, stage)
            return

        resp = await self.list_test_case(*args, **kwargs)
        rows = resp.data.rows or []

        temp_path = os.path.join(os.path.dirname(__file__), "temp_test_case.xlsx")
        wb = load_workbook(temp_path)
        template = wb[wb.sheetnames[0]]

        groups = OrderedDict()
        for row in rows:
            sn = (getattr(row, "sheet_name", None) or "").strip() or "Sheet1"
            groups.setdefault(sn, []).append(row)
        if not groups:
            groups["Sheet1"] = []

        def _safe_title(name: str, used: set) -> str:
            base = re.sub(r'[\\/*?:\[\]]+', "_", name or "Sheet1").strip()[:31] or "Sheet1"
            title = base
            i = 2
            while title in used:
                suffix = f"_{i}"
                title = (base[: 31 - len(suffix)] + suffix)
                i += 1
            used.add(title)
            return title

        used_titles = set()
        names = list(groups.keys())
        first = names[0]
        self.__write_export_sheet(template, groups[first])
        template.title = _safe_title(first, used_titles)
        for name in names[1:]:
            ws = wb.copy_worksheet(template)
            self.__write_export_sheet(ws, groups[name])
            ws.title = _safe_title(name, used_titles)

        wb.save(output)
        output.seek(0)
