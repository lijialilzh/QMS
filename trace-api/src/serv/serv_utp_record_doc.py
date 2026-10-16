#!/usr/bin/env python
# encoding: utf-8

# 用户测试记录服务层（测试文件 PD-010-QR-02）。
# 列表/编辑维护一份主文档；导出按 型号×用户测试人员 展开 zip。

import copy
import io
import json
import logging
import os
import re
import zipfile
from collections import OrderedDict
from typing import List, Tuple

from sqlalchemy import delete, func, select
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT

from ..model.product import Product
from ..model.utp_record_doc import UtpRecordDoc
from ..model.prod_dhf import ProdDhf
from ..model.project_member import ProjectMember
from ..model.test_set import TestSet
from ..model.test_case import TestCase
from ..obj import Page, Resp
from ..obj.tobj_role import Roles
from ..obj.vobj_user import UserObj
from ..obj.tobj_utp_record_doc import UtpRecordDocForm
from ..obj.vobj_utp_record_doc import UtpRecordDocObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from .serv_utils import new_version, sync_file_no_version
from .serv_utils import docx_util

logger = logging.getLogger(__name__)

DOC_NAME = "用户测试记录"
DOC_KEY = "utp_record"
BASE_NAME = "InferOperate Suite"
# 大表：0~10 为表头区，11 起为测试项
HEADER_ROWS = 11
PASS_EMPTY = "□通过 □不通过"

_DEFAULT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "src-res", "utp_record_default_content.json"
)
try:
    with open(_DEFAULT_FILE, encoding="utf-8") as _f:
        DEFAULT_CONTENT = json.load(_f)
except Exception:
    DEFAULT_CONTENT = {"sections": []}


class Server(object):

    def __normalize_content(self, content):
        if not isinstance(content, dict) or not isinstance(content.get("sections"), list):
            return copy.deepcopy(DEFAULT_CONTENT)
        result = {"sections": []}
        for s in content["sections"]:
            node = dict(s)
            node["title"] = str(node.get("title") or "") or DOC_NAME
            node["body"] = str(node.get("body") or "")
            tables = node.get("tables")
            if not isinstance(tables, list):
                tables = []
            norm = []
            for t in tables:
                if isinstance(t, list):
                    grid = []
                    for r in t:
                        if not isinstance(r, list):
                            continue
                        row = [str(c) if c is not None else "" for c in r]
                        while len(row) < 8:
                            row.append(row[-1] if row else "")
                        grid.append(row[:8])
                    norm.append(grid)
            node["tables"] = norm
            node["children"] = []
            result["sections"].append(node)
        return result

    def __replace_name(self, node, base, name):
        if not name or base == name:
            return
        if node.get("body"):
            node["body"] = node["body"].replace(base, name)
        for tbl in (node.get("tables") or []):
            for row in tbl:
                for i in range(len(row)):
                    if isinstance(row[i], str) and base in row[i]:
                        row[i] = row[i].replace(base, name)

    def __dhf_file_no(self, prod_id):
        if not prod_id:
            return ""
        row = db.session.execute(
            select(ProdDhf).where(ProdDhf.prod_id == prod_id, ProdDhf.name == DOC_NAME).order_by(ProdDhf.id.asc())
        ).scalars().first()
        if not row:
            row = db.session.execute(
                select(ProdDhf).where(ProdDhf.prod_id == prod_id, ProdDhf.name.like(f"%{DOC_NAME}%")).order_by(ProdDhf.id.asc())
            ).scalars().first()
        return (row.code or "").strip() if row and row.code else ""

    def __user_testers(self, prod_id) -> List[str]:
        if not prod_id:
            return []
        members = db.session.execute(
            select(ProjectMember).where(ProjectMember.prod_id == prod_id)
        ).scalars().all()
        names = []
        for m in members:
            if "用户测试" not in str(m.role or ""):
                continue
            nm = (m.name or "").strip()
            if nm and nm not in names:
                names.append(nm)
        return names

    def __user_test_cases(self, prod_id) -> List[TestCase]:
        if not prod_id:
            return []
        ts_row = db.session.execute(
            select(TestSet).where(TestSet.product_id == prod_id, TestSet.stage == "用户测试")
        ).scalars().first()
        if not ts_row:
            return []
        return list(db.session.execute(
            select(TestCase).where(TestCase.set_id == ts_row.id).order_by(TestCase.id.asc())
        ).scalars().all())

    def __model_names(self, prod_id, product: Product = None) -> List[str]:
        cases = self.__user_test_cases(prod_id)
        models = []
        for c in cases:
            sn = (getattr(c, "sheet_name", None) or "").strip()
            if sn and sn not in models:
                models.append(sn)
        if models:
            return models
        # 无 sheet 名：单一型号，优先产品 type_code
        tip = (getattr(product, "type_code", None) or "").strip() if product else ""
        return [tip] if tip else ["默认"]

    @staticmethod
    def __case_item_rows(cases: List[TestCase]) -> List[list]:
        groups = OrderedDict()
        for c in cases:
            fn = (c.function or "").strip() or "未分类"
            code = (c.code or "").strip()
            if not code:
                continue
            groups.setdefault(fn, []).append(code)
        rows = []
        for fn, codes in groups.items():
            rng = codes[0] if len(codes) == 1 else f"{codes[0]} 至 {codes[-1]}"
            rows.append([rng, rng, fn, fn, PASS_EMPTY, PASS_EMPTY, "", ""])
        return rows

    def __cases_for_model(self, all_cases: List[TestCase], model: str) -> List[TestCase]:
        model = (model or "").strip()
        named = [c for c in all_cases if (getattr(c, "sheet_name", None) or "").strip()]
        if not named:
            return list(all_cases)
        hit = [c for c in all_cases if (getattr(c, "sheet_name", None) or "").strip() == model]
        return hit if hit else list(all_cases)

    @staticmethod
    def __result_map(grid: list) -> dict:
        """旧测试项：key=(功能模块, Case区间前缀) → (是否通过, 备注)。"""
        out = {}
        for r in (grid or [])[HEADER_ROWS:]:
            if not isinstance(r, list) or len(r) < 7:
                continue
            case_key = str(r[0] or "").strip()
            mod = str(r[2] or "").strip()
            out[(mod, case_key)] = (str(r[4] or ""), str(r[6] or ""))
        return out

    def __apply_item_rows(self, grid: list, item_rows: List[list]):
        prev = self.__result_map(grid)
        head = [list(r) for r in grid[:HEADER_ROWS]]
        merged = []
        for r in item_rows:
            key = (str(r[2] or "").strip(), str(r[0] or "").strip())
            if key in prev:
                pass_v, remark = prev[key]
                r = list(r)
                r[4] = r[5] = pass_v or PASS_EMPTY
                r[6] = r[7] = remark or ""
            merged.append(r)
        return head + merged

    def __fill_test_items(self, content, prod_id, product=None, model: str = None):
        """按型号刷新测试项行（保留已填通过/备注）。"""
        if not isinstance(content, dict):
            return content
        models = self.__model_names(prod_id, product)
        use_model = (model or "").strip() or (models[0] if models else "")
        all_cases = self.__user_test_cases(prod_id)
        cases = self.__cases_for_model(all_cases, use_model)
        item_rows = self.__case_item_rows(cases)
        for s in (content.get("sections") or []):
            tables = s.get("tables") or []
            if not tables:
                continue
            grid = tables[0]
            if not isinstance(grid, list) or len(grid) < HEADER_ROWS:
                continue
            # 产品型号展示优先 type_code，避免被用例 sheet 名（如「用户测试用例」）覆盖
            tip = ""
            if product:
                tip = (getattr(product, "type_code", None) or "").strip()
            tip = tip or (model or "").strip() or use_model
            if tip and len(grid) > 1 and isinstance(grid[1], list) and len(grid[1]) > 1:
                for i in range(1, 5):
                    if i < len(grid[1]):
                        grid[1][i] = tip
            tables[0] = self.__apply_item_rows(grid, item_rows)
        return content

    def __fill_runtime_fields(self, content, prod_id):
        """测试工具←浏览器；网络环境←局域网&广域网（来自产品运行环境）。"""
        from .serv_prod_runtime_env import get_runtime_payload
        payload = get_runtime_payload(prod_id) or {}
        tool = (payload.get("cli_browser") or "").strip()
        lan = (payload.get("net_lan") or "").strip()
        wan = (payload.get("net_wan") or "").strip()
        net_parts = []
        if lan:
            net_parts.append(f"局域网{lan}" if "局域" not in lan else lan)
        if wan:
            net_parts.append(f"广域网{wan}" if "广域" not in wan else wan)
        net = "&".join(net_parts)
        for s in (content.get("sections") or []):
            for tbl in (s.get("tables") or []):
                if not tbl or not isinstance(tbl, list):
                    continue
                # 行1：产品型号 | 测试工具
                if len(tbl) > 1 and isinstance(tbl[1], list) and len(tbl[1]) >= 7 and tool:
                    tbl[1][6] = tbl[1][7] = tool
                # 行2：网络环境
                if len(tbl) > 2 and isinstance(tbl[2], list) and net:
                    for i in range(1, min(8, len(tbl[2]))):
                        tbl[2][i] = net

    def __str_device_rows(self, prod_id) -> List[list]:
        """取产品最新软件测试报告「测试设备详情」表数据行。"""
        if not prod_id:
            return []
        from ..model.str_doc import StrDoc
        row = db.session.execute(
            select(StrDoc).where(StrDoc.product_id == prod_id).order_by(StrDoc.id.desc())
        ).scalars().first()
        if not row or not isinstance(row.content, dict):
            return []

        def walk(nodes):
            for n in nodes or []:
                if not isinstance(n, dict):
                    continue
                title = str(n.get("title") or "")
                if "测试设备详情" in title:
                    tables = n.get("tables") or []
                    if tables and isinstance(tables[0], list):
                        return [r for r in tables[0] if isinstance(r, list)]
                hit = walk(n.get("children") or [])
                if hit:
                    return hit
            return []

        return walk(row.content.get("sections") or [])

    @staticmethod
    def __pick_lowest_client(client_rows: List[list]) -> list:
        """多台用户端取最低配：优先 Win10，否则第一条。"""
        if not client_rows:
            return []
        win10 = []
        for r in client_rows:
            info = str(r[1] if len(r) > 1 else "")
            if re.search(r"Windows\s*10|Win\s*10|Win10", info, re.I):
                win10.append(r)
        return win10[0] if win10 else client_rows[0]

    @staticmethod
    def __extract_browser(info: str) -> str:
        m = re.search(r"(Chrome[^\n]*)", info or "", re.I)
        return (m.group(1).strip() if m else "").strip(" 、,;")

    def __fill_devices_from_str(self, content, prod_id):
        """用户端/服务端设备信息从软件测试报告「测试设备详情」获取。"""
        rows = self.__str_device_rows(prod_id)
        if not rows:
            return
        clients = [r for r in rows if str(r[0] or "").strip() == "用户端"]
        servers = [r for r in rows if str(r[0] or "").strip() == "服务端"]
        client = self.__pick_lowest_client(clients)
        server = servers[0] if servers else []
        for s in (content.get("sections") or []):
            for tbl in (s.get("tables") or []):
                if not tbl or len(tbl) < 6:
                    continue
                if client and isinstance(tbl[4], list) and len(tbl[4]) >= 7:
                    info = str(client[1] if len(client) > 1 else "")
                    qty = str(client[2] if len(client) > 2 else "") or "1台"
                    browser = self.__extract_browser(info)
                    for i in range(3, 6):
                        if i < len(tbl[4]):
                            tbl[4][i] = info
                    tbl[4][6] = qty
                    if browser:
                        tbl[4][7] = browser
                if server and isinstance(tbl[5], list) and len(tbl[5]) >= 7:
                    info = str(server[1] if len(server) > 1 else "")
                    qty = str(server[2] if len(server) > 2 else "") or "1台"
                    for i in range(3, 6):
                        if i < len(tbl[5]):
                            tbl[5][i] = info
                    tbl[5][6] = qty
                    if len(tbl[5]) > 7:
                        tbl[5][7] = "/"

    def __fill_tester_and_date(self, content, prod_id):
        """编辑页：测试人员默认第一人；测试日期取时间逻辑线。"""
        from . import serv_review_util
        testers = self.__user_testers(prod_id)
        first = testers[0] if testers else ""
        test_date = serv_review_util.review_date(prod_id, ["用户测试记录", "用户测试"]) or ""
        for s in (content.get("sections") or []):
            for tbl in (s.get("tables") or []):
                if not tbl or len(tbl) < 7 or not isinstance(tbl[6], list):
                    continue
                if first:
                    for i in range(1, 5):
                        if i < len(tbl[6]):
                            tbl[6][i] = first
                if test_date and len(tbl[6]) >= 8:
                    tbl[6][6] = tbl[6][7] = test_date

    def __autofill(self, content, prod_id, product=None, version="", force=False, model: str = None):
        if not isinstance(content, dict):
            return content
        if product and product.name:
            for s in (content.get("sections") or []):
                self.__replace_name(s, BASE_NAME, product.name)
        if product:
            new_fv = (product.full_version or "").strip()
            type_code = (product.type_code or "").strip()
            for s in (content.get("sections") or []):
                for tbl in (s.get("tables") or []):
                    if not tbl:
                        continue
                    # 产品名称 / 完整版本
                    if isinstance(tbl[0], list) and len(tbl[0]) >= 7:
                        if product.name:
                            for i in range(1, 5):
                                if i < len(tbl[0]):
                                    tbl[0][i] = product.name
                        if new_fv:
                            tbl[0][6] = tbl[0][7] = new_fv
                    # 产品型号：编辑页优先产品 type_code（不用用例 sheet 名占位）
                    if len(tbl) > 1 and isinstance(tbl[1], list) and len(tbl[1]) >= 5:
                        tip = (model or type_code or "").strip()
                        if tip or force:
                            for i in range(1, 5):
                                if i < len(tbl[1]):
                                    tbl[1][i] = tip
                    # 其余格子里的版本号串（勿改浏览器/设备信息中的版本）
                    if new_fv:
                        skip_labels = {
                            "产品名称", "完整版本号", "产品型号", "测试设备需求",
                            "网络环境", "测试工具", "测试人员", "测试日期",
                        }
                        for r in tbl:
                            label0 = str(r[0] or "").strip()
                            if label0 in skip_labels:
                                continue
                            for i in range(len(r)):
                                cell = r[i]
                                if not isinstance(cell, str) or not re.search(r"\d+\.\d+\.\d+\.\d+", cell):
                                    continue
                                if re.search(r"Chrome|浏览器|CUDA|Ubuntu|Windows", cell, re.I):
                                    continue
                                r[i] = re.sub(r"\d+\.\d+\.\d+\.\d+", new_fv, cell)
        self.__fill_runtime_fields(content, prod_id)
        self.__fill_devices_from_str(content, prod_id)
        self.__fill_tester_and_date(content, prod_id)
        fill_model = (model or "").strip()
        if not fill_model and product:
            fill_model = (product.type_code or "").strip() or None
        self.__fill_test_items(content, prod_id, product, model=fill_model)
        return content

    def __to_obj(self, row: UtpRecordDoc, product: Product = None):
        obj = UtpRecordDocObj(**row.dict())
        obj.content = self.__autofill(self.__normalize_content(obj.content), row.product_id, product, row.version)
        if not (obj.file_no or "").strip():
            obj.file_no = self.__dhf_file_no(row.product_id)
        if product:
            obj.product_name = product.name
            obj.product_version = product.full_version
            obj.product_full_version = product.full_version
            obj.product_type_code = product.type_code
        obj.model_names = self.__model_names(row.product_id, product)
        obj.tester_names = self.__user_testers(row.product_id)
        obj.file_no = sync_file_no_version(obj.file_no or "", getattr(row, "version", None) or "") or obj.file_no
        return obj

    async def ensure_from_user_test_import(self, product_id: int):
        """用户测试用例导入成功后：无记录则建 A0；有则刷新测试项（保留通过/备注）。"""
        if not product_id:
            return
        try:
            product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            existing = db.session.execute(
                select(UtpRecordDoc).where(UtpRecordDoc.product_id == product_id).order_by(UtpRecordDoc.id.desc())
            ).scalars().first()
            if existing:
                content = self.__normalize_content(existing.content)
                content = self.__autofill(content, product_id, product, existing.version or "", force=True)
                existing.content = content
                if not (existing.file_no or "").strip():
                    existing.file_no = self.__dhf_file_no(product_id) or None
                db.session.commit()
                logger.info("utp_record refreshed after user-test import, id=%s product_id=%s", existing.id, product_id)
                return
            version = "A0"
            content = self.__normalize_content(copy.deepcopy(DEFAULT_CONTENT))
            content = self.__autofill(content, product_id, product, version, force=True)
            row = UtpRecordDoc(
                product_id=product_id,
                version=version,
                file_no=self.__dhf_file_no(product_id) or None,
                content=content,
            )
            db.session.add(row)
            db.session.commit()
            logger.info("utp_record created after user-test import, id=%s product_id=%s", row.id, product_id)
        except Exception:
            logger.exception("ensure_from_user_test_import failed product_id=%s", product_id)
            db.session.rollback()

    async def add_utp_record_doc(self, form: UtpRecordDocForm):
        try:
            sql = select(func.count(UtpRecordDoc.id)).where(
                UtpRecordDoc.product_id == form.product_id, UtpRecordDoc.version == form.version
            )
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = UtpRecordDoc(**form.dict(exclude_none=True))
            row.id = None
            product = db.session.execute(select(Product).where(Product.id == form.product_id)).scalars().first()
            content = self.__normalize_content(row.content)
            content = self.__autofill(content, form.product_id, product, form.version or "", force=True)
            row.content = content
            if not (row.file_no or "").strip():
                row.file_no = self.__dhf_file_no(form.product_id) or None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=UtpRecordDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def duplicate_utp_record_doc(self, id: int, product_id: int = None):
        try:
            fromdoc: UtpRecordDoc = db.session.execute(select(UtpRecordDoc).where(UtpRecordDoc.id == id)).scalars().first()
            if not fromdoc:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            target_pid = product_id or fromdoc.product_id
            all_versions = db.session.execute(select(UtpRecordDoc.version).where(UtpRecordDoc.product_id == target_pid)).scalars().all()
            existing_set = {v for v in all_versions if v}
            if target_pid == fromdoc.product_id:
                version = new_version(fromdoc.version)
            else:
                def _seq(v):
                    m = re.search(r"(\d+)(?!.*\d)", v or "")
                    return int(m.group(1)) if m else -1
                valid = [v for v in all_versions if v]
                version = new_version(max(valid, key=_seq)) if valid else fromdoc.version
            while version in existing_set:
                version = new_version(version)
            newdoc = UtpRecordDoc(
                product_id=target_pid, version=version,
                file_no=sync_file_no_version((fromdoc.file_no or "").strip() or self.__dhf_file_no(target_pid), version) or None,
                change_log=fromdoc.change_log,
                content=copy.deepcopy(self.__normalize_content(fromdoc.content)),
            )
            db.session.add(newdoc)
            db.session.commit()
            if target_pid != fromdoc.product_id:
                await self.rebind_product(newdoc.id, target_pid)
            return Resp.resp_ok(data=UtpRecordDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_utp_record_doc(self, form: UtpRecordDocForm):
        try:
            row: UtpRecordDoc = db.session.execute(select(UtpRecordDoc).where(UtpRecordDoc.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict(exclude_none=True).items():
                if key == "id":
                    continue
                if key == "content":
                    value = self.__normalize_content(value)
                setattr(row, key, value)
            if getattr(form, "version", None) and hasattr(row, "file_no"):
                row.file_no = sync_file_no_version(row.file_no or "", form.version or row.version) or row.file_no
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def rebind_product(self, id: int, product_id: int):
        try:
            row: UtpRecordDoc = db.session.execute(select(UtpRecordDoc).where(UtpRecordDoc.id == id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            product: Product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            if not product:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            db.session.execute(delete(UtpRecordDoc).where(
                UtpRecordDoc.product_id == product_id, UtpRecordDoc.version == row.version, UtpRecordDoc.id != id
            ))
            content = copy.deepcopy(DEFAULT_CONTENT) if isinstance(DEFAULT_CONTENT, dict) else {"sections": []}
            content = self.__autofill(content, product_id, product, row.version, force=True)
            row.product_id = product_id
            row.content = content
            db.session.commit()
            return Resp.resp_ok(data=self.__to_obj(row, product))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_utp_record_doc(self, id: int):
        db.session.execute(delete(UtpRecordDoc).where(UtpRecordDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def get_utp_record_doc(self, id: int):
        sql = select(UtpRecordDoc, Product).join(Product, UtpRecordDoc.product_id == Product.id).where(UtpRecordDoc.id == id)
        row = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        return Resp.resp_ok(data=self.__to_obj(doc, product))

    async def list_utp_record_doc(self, op_user: UserObj = None, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if product_id:
            wheres.append(UtpRecordDoc.product_id == product_id)
        if version:
            wheres.append(UtpRecordDoc.version.like(f"%{version}%"))
        if op_user and op_user.id != 1 and op_user.role_code == Roles.product_manager.value.code:
            wheres.append(Product.create_user_id == op_user.id)
        sql_total = select(func.count(UtpRecordDoc.id)).join(Product, UtpRecordDoc.product_id == Product.id).where(*wheres)
        total = db.session.execute(sql_total).scalar() or 0
        sql = (select(UtpRecordDoc, Product).join(Product, UtpRecordDoc.product_id == Product.id).where(*wheres)
               .order_by(UtpRecordDoc.id.desc()).offset(page_index * page_size).limit(page_size))
        rows: List[UtpRecordDocObj] = [self.__to_obj(doc, product) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    def __build_export_grid(self, base_grid: list, product: Product, model: str, tester: str, all_cases: List[TestCase]) -> list:
        grid = copy.deepcopy(base_grid)
        cases = self.__cases_for_model(all_cases, model)
        item_rows = self.__case_item_rows(cases)
        grid = self.__apply_item_rows(grid, item_rows)
        # 填型号 / 测试人员
        if len(grid) > 1 and isinstance(grid[1], list):
            for i in range(1, 5):
                if i < len(grid[1]):
                    grid[1][i] = model or ""
        if len(grid) > 6 and isinstance(grid[6], list):
            for i in range(1, 5):
                if i < len(grid[6]):
                    grid[6][i] = tester or ""
        if product:
            if isinstance(grid[0], list) and len(grid[0]) >= 7:
                if product.name:
                    for i in range(1, 5):
                        if i < len(grid[0]):
                            grid[0][i] = product.name
                fv = (product.full_version or "").strip()
                if fv:
                    grid[0][6] = grid[0][7] = fv
        return grid

    def __write_docx(self, output, file_no: str, grid: list):
        document = Document()
        section = document.sections[0]
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.7)
        section.right_margin = Inches(0.7)
        header_para = section.header.add_paragraph()
        header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        docx_util.fonted_txt(header_para, file_no or "")
        docx_util.add_page_number_footer(section, file_no or "")

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT):
            s = str(text or "")
            cell.text = ""
            for i, line in enumerate(s.split("\n")):
                para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
                para.alignment = align
                para.paragraph_format.line_spacing = 1.3
                docx_util.fonted_txt(para, line, font_size=10.5, bold=bold)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        p = document.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        docx_util.fonted_txt(p, DOC_NAME, font_size=18.0, bold=True)
        document.add_paragraph()

        grid = [r for r in (grid or []) if isinstance(r, list)]
        cols = 8
        table = document.add_table(rows=0, cols=cols)
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        for r_idx, r in enumerate(grid):
            cells = table.add_row().cells
            for c in cells:
                c.text = ""
            # 合并规则对齐 Word 模版
            if r_idx == 0:
                cells[1].merge(cells[4])
                cells[6].merge(cells[7])
                spans = [(0, r[0]), (1, r[1]), (5, r[5]), (6, r[6])]
            elif r_idx == 1:
                cells[1].merge(cells[4])
                cells[6].merge(cells[7])
                spans = [(0, r[0]), (1, r[1]), (5, r[5]), (6, r[6])]
            elif r_idx == 2:
                cells[1].merge(cells[7])
                spans = [(0, r[0]), (1, r[1])]
            elif r_idx == 3:
                cells[1].merge(cells[2])
                cells[3].merge(cells[5])
                spans = [(0, r[0]), (1, r[1]), (3, r[3]), (6, r[6]), (7, r[7])]
            elif r_idx in (4, 5):
                cells[1].merge(cells[2])
                cells[3].merge(cells[5])
                spans = [(0, r[0]), (1, r[1]), (3, r[3]), (6, r[6]), (7, r[7])]
            elif r_idx == 6:
                cells[1].merge(cells[4])
                cells[6].merge(cells[7])
                spans = [(0, r[0]), (1, r[1]), (5, r[5]), (6, r[6])]
            elif r_idx in (7, 8):
                cells[1].merge(cells[7])
                spans = [(0, r[0]), (1, r[1])]
            elif r_idx == 9:
                cells[0].merge(cells[7])
                spans = [(0, r[0])]
            else:
                cells[0].merge(cells[1])
                cells[2].merge(cells[3])
                cells[4].merge(cells[5])
                cells[6].merge(cells[7])
                # Case 编号在「至」处换行，便于阅读
                case_txt = re.sub(r"\s*至\s*", "\n至\n", str(r[0] or ""))
                spans = [(0, case_txt), (2, r[2]), (4, r[4]), (6, r[6])]
            for c_idx, val in spans:
                set_cell(cells[c_idx], val, bold=(r_idx <= 10 and c_idx in (0, 2, 5) and r_idx < 11))

        # 纵向合并功能模块列（数据行）
        rows_total = len(grid)
        if rows_total > HEADER_ROWS:
            group_start = HEADER_ROWS
            prev_module = grid[HEADER_ROWS][2] if len(grid[HEADER_ROWS]) > 2 else ""
            for r_idx in range(HEADER_ROWS + 1, rows_total):
                cur_module = grid[r_idx][2] if len(grid[r_idx]) > 2 else ""
                if cur_module != prev_module:
                    if r_idx - 1 > group_start:
                        for rr in range(group_start + 1, r_idx):
                            table.cell(rr, 2).text = ""
                        table.cell(group_start, 2).merge(table.cell(r_idx - 1, 2))
                    group_start = r_idx
                    prev_module = cur_module
            if rows_total - 1 > group_start:
                for rr in range(group_start + 1, rows_total):
                    table.cell(rr, 2).text = ""
                table.cell(group_start, 2).merge(table.cell(rows_total - 1, 2))

        document.add_paragraph()
        p2 = document.add_paragraph()
        docx_util.fonted_txt(p2, "签名：", font_size=12.0)
        p3 = document.add_paragraph()
        docx_util.fonted_txt(p3, "日期：", font_size=12.0)
        document.save(output)
        output.seek(0)

    async def export_utp_record_doc(self, output, id: int):
        """导出 zip：型号 × 用户测试人员 → 多份 docx。"""
        resp = await self.get_utp_record_doc(id)
        obj: UtpRecordDocObj = resp.data
        if obj is None:
            # 空 zip
            with zipfile.ZipFile(output, "w"):
                pass
            output.seek(0)
            return
        product = db.session.execute(select(Product).where(Product.id == obj.product_id)).scalars().first()
        content = obj.content if isinstance(obj.content, dict) else self.__normalize_content(obj.content)
        sections = content.get("sections") or []
        base_grid = []
        if sections and (sections[0].get("tables") or []):
            base_grid = sections[0]["tables"][0]
        models = obj.model_names or self.__model_names(obj.product_id, product)
        testers = obj.tester_names or self.__user_testers(obj.product_id)
        all_cases = self.__user_test_cases(obj.product_id)
        if not models:
            models = ["默认"]
        if not testers:
            testers = [""]

        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
            for model in models:
                for tester in testers:
                    grid = self.__build_export_grid(base_grid, product, model, tester, all_cases)
                    buf = io.BytesIO()
                    self.__write_docx(buf, obj.file_no or "", grid)
                    safe_model = re.sub(r'[\\/:*?"<>|]+', "_", model or "型号")
                    safe_tester = re.sub(r'[\\/:*?"<>|]+', "_", tester or "测试人员")
                    fname = f"{DOC_NAME}_{safe_model}_{safe_tester}.docx"
                    zf.writestr(fname, buf.getvalue())
        output.seek(0)
        # 供集成导出识别扩展名为 zip（嵌套进总 zip）
        return ("ok", "zip")
