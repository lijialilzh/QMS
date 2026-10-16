import logging
import io
import re
from openpyxl import load_workbook
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from sqlalchemy.exc import IntegrityError
from ..obj.vobj_user import UserObj
from ..model.product import Product, UserProd
from ..obj.tobj_role import Roles
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
    @staticmethod
    def __to_str(value):
        if value is None:
            return ""
        return str(value).strip()

    @staticmethod
    def __fit_varchar(value: str, size: int = 64):
        txt = (value or "").strip()
        return txt[:size] if len(txt) > size else txt

    @staticmethod
    def __match_col(header: str, aliases: list[str]):
        txt = Server.__to_str(header).lower().replace(" ", "")
        return any(alias in txt for alias in aliases)

    @staticmethod
    def __looks_like_case_code(value: str):
        txt = (value or "").strip()
        if not txt:
            return False
        # 常见用例编号如 TU01-001-0001 / TC-001，过滤标题和说明行
        return bool(re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$", txt)) and "-" in txt

    @staticmethod
    def __parse_upload_filename(filename: str):
        """文件名（去扩展名）按「编号 + 空格 + 名称」解析；无空格则编号=整段、名称为空。"""
        stem = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
        lower = stem.lower()
        if lower.endswith(".xlsx"):
            stem = stem[:-5]
        elif lower.endswith(".xls"):
            stem = stem[:-4]
        stem = stem.strip()
        if not stem:
            return "", ""
        parts = stem.split(None, 1)
        file_no = (parts[0] or "")[:256]
        file_name = (parts[1] if len(parts) > 1 else "")[:256]
        return file_no, file_name

    def __parse_sheet(self, ws, sheet_name: str):
        """解析单个 sheet；sheet_name 写入用例（用户测试多型号时 sheet 名=型号）。"""
        test_cases = []
        header_row_idx = None
        col_idx = {
            "code": 0,
            "srs_code": 1,
            "test_type": 2,
            "function": 4,
            "description": 5,
            "precondition": 6,
            "test_step": 7,
            "expect": 8,
            "note": 9,
        }

        max_scan_row = min(ws.max_row or 1, 30)
        for ridx in range(1, max_scan_row + 1):
            row_vals = [self.__to_str(v) for v in ws.iter_rows(min_row=ridx, max_row=ridx, values_only=True).__next__()]
            for cidx, cell_text in enumerate(row_vals):
                if self.__match_col(cell_text, ["case编号", "用例编号", "测试用例编号", "caseid"]):
                    col_idx["code"] = cidx
                    header_row_idx = ridx
                if self.__match_col(cell_text, ["需求编号", "srscode", "srs编号"]):
                    col_idx["srs_code"] = cidx
                    header_row_idx = ridx
                if self.__match_col(cell_text, ["测试类型", "testtype"]):
                    col_idx["test_type"] = cidx
                if self.__match_col(cell_text, ["功能点", "功能", "function"]):
                    col_idx["function"] = cidx
                if self.__match_col(cell_text, ["描述", "description"]):
                    col_idx["description"] = cidx
                if self.__match_col(cell_text, ["前置条件", "precondition"]):
                    col_idx["precondition"] = cidx
                if self.__match_col(cell_text, ["测试步骤", "步骤", "teststep"]):
                    col_idx["test_step"] = cidx
                if self.__match_col(cell_text, ["预期结果", "expect"]):
                    col_idx["expect"] = cidx
                if self.__match_col(cell_text, ["备注", "note"]):
                    col_idx["note"] = cidx
            if header_row_idx is not None:
                break

        data_start_row = (header_row_idx + 1) if header_row_idx else 2
        sheet_label = self.__fit_varchar(sheet_name or "", 128)
        for row in ws.iter_rows(min_row=data_start_row, values_only=True):
            code_raw = self.__to_str(row[col_idx["code"]] if len(row) > col_idx["code"] else None)
            if not code_raw:
                continue
            # 丢弃标题/说明行，避免导入脏数据导致长度超限
            if not self.__looks_like_case_code(code_raw):
                continue

            test_cases.append(TestCase(
                code=self.__fit_varchar(code_raw, 64),
                srs_code=self.__fit_varchar(self.__to_str(row[col_idx["srs_code"]] if len(row) > col_idx["srs_code"] else None), 64),
                test_type=self.__fit_varchar(self.__to_str(row[col_idx["test_type"]] if len(row) > col_idx["test_type"] else None), 64),
                function=self.__to_str(row[col_idx["function"]] if len(row) > col_idx["function"] else None),
                description=self.__to_str(row[col_idx["description"]] if len(row) > col_idx["description"] else None),
                precondition=self.__to_str(row[col_idx["precondition"]] if len(row) > col_idx["precondition"] else None),
                test_step=self.__to_str(row[col_idx["test_step"]] if len(row) > col_idx["test_step"] else None),
                expect=self.__to_str(row[col_idx["expect"]] if len(row) > col_idx["expect"] else None),
                note=self.__to_str(row[col_idx["note"]] if len(row) > col_idx["note"] else None),
                sheet_name=sheet_label or None,
            ))
        logger.info(
            "read_test_case_excel: sheet=%s, header_row=%s, data_start=%s, parsed_cases=%s",
            sheet_name, header_row_idx, data_start_row, len(test_cases),
        )
        return test_cases

    async def __read_excel(self, file):
        try:
            bys = await file.read()
            wb = load_workbook(io.BytesIO(bys))
            test_cases = []
            # 全部 sheet：用户测试用例多型号时每个 sheet 名=型号
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                test_cases.extend(self.__parse_sheet(ws, sheet_name))
            return None, test_cases
        except IntegrityError:
            logger.exception("")
            return ts("msg_dup_row"), None
        except Exception:
            logger.exception("")
            return ts(msg_err_db), None
    

    async def add_test_set(self, form: TestSetForm, file):
        try:
            file_no, file_name = "", ""
            if file and getattr(file, "filename", None):
                file_no, file_name = self.__parse_upload_filename(file.filename)
            # 有上传文件但解析不出编号时不落空串（避免与旧 legacy 空数据误判）
            if file and not (file_no or "").strip():
                return Resp.resp_err(msg="文件名格式无效")
            # 同产品下文件编号+名称已存在 → 视为已上传（忽略空编号）
            if (file_no or "").strip():
                sql = select(func.count(TestSet.id)).where(
                    TestSet.product_id == form.product_id,
                    TestSet.file_no == file_no,
                    TestSet.file_name == (file_name or ""),
                )
                if db.session.execute(sql).scalar() > 0:
                    tip = f"{file_no}{(' ' + file_name) if file_name else ''}".strip()
                    return Resp.resp_err(msg=f"已存在：{tip}")

            payload = form.dict()
            payload["file_no"] = file_no or f"tmp-{form.product_id}-{form.stage or ''}"
            payload["file_name"] = file_name or ""
            row = TestSet(**{k: v for k, v in payload.items() if k != "id"})
            row.id = None
            db.session.add(row)
            db.session.flush()
            if file:
                err, test_cases = await self.__read_excel(file)
                if err:
                    return Resp.resp_err(msg=err)
                logger.info("test_cases: %s file_no=%s file_name=%s", len(test_cases), file_no, file_name)
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
            if file:
                await self.__sync_records_after_import(form.product_id, form.stage or "")
            return Resp.resp_ok()
        except IntegrityError:
            logger.exception("")
            db.session.rollback()
            return Resp.resp_err(msg="保存冲突")
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_test_set(self, id):
        db.session.execute(delete(TestSet).where(TestSet.id == id))
        db.session.execute(delete(TestCase).where(TestCase.set_id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def __sync_records_after_import(self, product_id: int, stage: str):
        """导入用例后同步测试记录：用户测试→utp_record；单元/集成/系统→dev_test_record。"""
        stage = stage or ""
        try:
            if stage == "用户测试":
                from .serv_utp_record_doc import Server as UtpRecordServer
                await UtpRecordServer().ensure_from_user_test_import(product_id)
            elif stage in ("单元测试", "集成测试", "系统测试"):
                from .serv_dev_test_record_doc import Server as DevRecordServer
                await DevRecordServer().ensure_from_case_import(product_id, stage)
        except Exception:
            logger.exception("sync test record after import failed product_id=%s stage=%s", product_id, stage)
   
    async def update_test_set(self, form: TestSetForm, file):
        try:
            sql = select(TestSet).where(TestSet.id == form.id)
            row: TestSet = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))

            for key, value in form.dict().items():
                if key == "id" or value is None:
                    continue
                if key in ("file_no", "file_name"):
                    continue
                setattr(row, key, value)

            imported = False
            if file:
                file_no, file_name = self.__parse_upload_filename(getattr(file, "filename", "") or "")
                prod_id = form.product_id if form.product_id is not None else row.product_id
                dup = db.session.execute(
                    select(func.count(TestSet.id)).where(
                        TestSet.product_id == prod_id,
                        TestSet.file_no == file_no,
                        TestSet.file_name == file_name,
                        TestSet.id != form.id,
                    )
                ).scalar()
                if dup > 0:
                    return Resp.resp_err(msg=ts("msg_obj_exist"))
                row.file_no = file_no
                row.file_name = file_name
                db.session.execute(delete(TestCase).where(TestCase.set_id == row.id))
                err, test_cases = await self.__read_excel(file)
                if err:
                    return Resp.resp_err(msg=err)
                for test_case in test_cases:
                    test_case.set_id = row.id
                    db.session.add(test_case)
                imported = True
            db.session.commit()
            stage = (form.stage if form.stage is not None else row.stage) or ""
            if imported:
                await self.__sync_records_after_import(row.product_id, stage)
            return Resp.resp_ok()
        except IntegrityError:
            logger.exception("")
            db.session.rollback()
            return Resp.resp_err(msg=ts("msg_obj_exist"))
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
        if op_user and op_user.id != 1 and getattr(op_user, "role_code", None) == Roles.product_manager.value.code:
            sql = sql.where(Product.create_user_id == op_user.id)

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(TestSet.create_time))
        rows: list[TestSet] = db.session.execute(sql).all()

        objs = []
        for row, row_prd in rows:
            obj = TestSetObj(**row.dict())
            obj.file_no = getattr(row, "file_no", None) or ""
            obj.file_name = getattr(row, "file_name", None) or ""
            if row_prd:
                obj.product_name = row_prd.name
                obj.product_version = row_prd.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
             