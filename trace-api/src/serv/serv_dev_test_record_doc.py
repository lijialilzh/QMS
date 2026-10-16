#!/usr/bin/env python
# encoding: utf-8

# 单元/集成/系统测试记录：导入用例后生成；导出按模版+用例多 sheet，表头自动获取。

import logging
import os
import re
from collections import OrderedDict

from openpyxl import load_workbook
from sqlalchemy import select

from ..model.dev_test_record_doc import DevTestRecordDoc
from ..model.prod_dhf import ProdDhf
from ..model.product import Product
from ..model.stp_doc import StpDoc
from ..model.test_case import TestCase
from ..model.test_set import TestSet
from ..utils.sql_ctx import db
from . import serv_review_util

logger = logging.getLogger(__name__)

STAGE_META = {
    "单元测试": {
        "title": "单元测试记录",
        "template": "unit_test_record_template.xlsx",
        "dhf_kw": "单元测试记录",
        "date_kw": ["单元测试记录", "单元测试"],
    },
    "集成测试": {
        "title": "集成测试记录",
        "template": "integration_test_record_template.xlsx",
        "dhf_kw": "集成测试记录",
        "date_kw": ["集成测试记录", "集成测试"],
    },
    "系统测试": {
        "title": "系统测试记录",
        "template": "system_test_record_template.xlsx",
        "dhf_kw": "系统测试记录",
        "date_kw": ["系统测试记录", "系统测试"],
    },
}

_TEMPLATE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "src-res",
    "dev_test_record",
)

_HEADER_KEYS = ("Case编号", "用例编号")


class Server(object):

    def __template_path(self, stage: str) -> str:
        meta = STAGE_META.get(stage) or {}
        return os.path.join(_TEMPLATE_DIR, meta.get("template") or "")

    def __dhf_file_no(self, prod_id, stage: str) -> str:
        kw = (STAGE_META.get(stage) or {}).get("dhf_kw") or stage
        if not prod_id:
            return ""
        row = db.session.execute(
            select(ProdDhf).where(ProdDhf.prod_id == prod_id, ProdDhf.name == kw).order_by(ProdDhf.id.asc())
        ).scalars().first()
        if not row:
            row = db.session.execute(
                select(ProdDhf).where(ProdDhf.prod_id == prod_id, ProdDhf.name.like(f"%{kw}%")).order_by(ProdDhf.id.asc())
            ).scalars().first()
        return (row.code or "").strip() if row and row.code else ""

    def __latest_test_set(self, prod_id, stage: str):
        # 同阶段可有多份合集：取 create_time 最新
        return db.session.execute(
            select(TestSet)
            .where(TestSet.product_id == prod_id, TestSet.stage == stage)
            .order_by(TestSet.create_time.desc(), TestSet.id.desc())
            .limit(1)
        ).scalars().first()

    def __cases(self, prod_id, stage: str):
        ts_row = self.__latest_test_set(prod_id, stage)
        if not ts_row:
            return []
        return list(db.session.execute(
            select(TestCase).where(TestCase.set_id == ts_row.id).order_by(TestCase.id.asc())
        ).scalars().all())

    @staticmethod
    def __ver_from_file_no(file_no: str) -> str:
        # 从合集文件编号取版本段，如 TX-…-A1 → A1
        s = file_no or ""
        m = re.search(r"-(A\d+)\b", s, re.I) or re.search(r"\b(A\d+)\b", s, re.I)
        return m.group(1).upper() if m else ""

    @staticmethod
    def __sync_record_file_no(base_no: str, set_ver: str) -> str:
        """将记录文件编号同步为合集版本：已有 -Ax 则替换；无版本段则追加 -Ax。"""
        base_no = (base_no or "").strip()
        set_ver = (set_ver or "").strip()
        if not base_no or not set_ver:
            return base_no
        from .serv_utils import sync_file_no_version
        synced = sync_file_no_version(base_no, set_ver) or base_no
        if re.search(r"-(A\d+)$", synced, re.I):
            return synced
        return f"{synced}-{set_ver}"

    def __stp_devices_and_net(self, prod_id):
        """从软件测试计划运行环境：第5表设备、第4表网络；测试工具取浏览器。"""
        client_info, client_qty, client_browser = "", "1台", ""
        server_info, server_qty = "", "1台"
        network, tool = "", ""
        if not prod_id:
            return client_info, client_qty, client_browser, server_info, server_qty, network, tool
        stp = db.session.execute(
            select(StpDoc).where(StpDoc.product_id == prod_id).order_by(StpDoc.id.desc())
        ).scalars().first()
        if not stp or not isinstance(stp.content, dict):
            return client_info, client_qty, client_browser, server_info, server_qty, network, tool

        def walk(nodes):
            for n in nodes or []:
                if not isinstance(n, dict):
                    continue
                title = str(n.get("title") or "")
                tables = n.get("tables") or []
                if "运行环境" in title and isinstance(tables, list) and tables:
                    return tables
                hit = walk(n.get("children") or [])
                if hit:
                    return hit
            return []

        tables = walk(stp.content.get("sections") or [])
        # 表4 网络
        if len(tables) >= 4 and isinstance(tables[3], list):
            net_tbl = tables[3]
            lan, wan = "", ""
            for r in net_tbl:
                if not isinstance(r, list) or not r:
                    continue
                row = [str(c or "") for c in r]
                joined = " ".join(row)
                if "带宽" in row[0] or "局域" in joined or "广域" in joined:
                    # ["带宽", lan, wan] 或类似
                    if len(row) > 1:
                        lan = row[1]
                    if len(row) > 2:
                        wan = row[2]
            parts = []
            if lan:
                parts.append(f"局域网{lan}" if "局域" not in lan else lan)
            if wan:
                parts.append(f"广域网{wan}" if "广域" not in wan else wan)
            network = "&".join(parts) if parts else ""
        # 表5 设备
        if len(tables) >= 5 and isinstance(tables[4], list):
            clients, servers = [], []
            for r in tables[4]:
                if not isinstance(r, list) or not r:
                    continue
                label = str(r[0] or "").strip()
                if label == "用户端":
                    clients.append(r)
                elif label == "服务端":
                    servers.append(r)
            client = None
            if clients:
                win10 = [r for r in clients if re.search(r"Windows\s*10|Win\s*10|Win10", str(r[1] if len(r) > 1 else ""), re.I)]
                client = win10[0] if win10 else clients[0]
            if client:
                client_info = str(client[1] if len(client) > 1 else "")
                client_qty = str(client[2] if len(client) > 2 else "") or "1台"
                m = re.search(r"(Chrome[^\n]*)", client_info, re.I)
                client_browser = (m.group(1).strip() if m else "").strip(" 、,;")
                if client_browser:
                    tool = client_browser.split("、")[0].strip() or "Chrome"
            if servers:
                server = servers[0]
                server_info = str(server[1] if len(server) > 1 else "")
                server_qty = str(server[2] if len(server) > 2 else "") or "1台"
        if not tool:
            tool = "Chrome"
        return client_info, client_qty, client_browser, server_info, server_qty, network, tool

    def __build_header(self, product_id, stage, product, record) -> dict:
        meta = STAGE_META.get(stage) or {}
        header = {}
        if record and isinstance(record.content, dict):
            header = dict(record.content.get("header") or {})
        start, end = serv_review_util.date_range(product_id, meta.get("date_kw") or [stage])
        header["start_date"] = start or header.get("start_date") or ""
        header["end_date"] = end or header.get("end_date") or ""
        # 创建人、测试人员同一人：测试人员日期规则
        person = "宋月" if serv_review_util._before_202509(header["start_date"] or header["end_date"]) else "孙家旭"
        header["designer"] = person
        header["tester"] = person
        dhf_no = (self.__dhf_file_no(product_id, stage) or "").strip()
        base_no = dhf_no or ((record.file_no if record and record.file_no else "") or "").strip()
        ts_row = self.__latest_test_set(product_id, stage)
        set_ver = self.__ver_from_file_no(getattr(ts_row, "file_no", None) or "") if ts_row else ""
        if not set_ver and record and (record.version or "").strip():
            set_ver = (record.version or "").strip().upper()
        if base_no and set_ver:
            base_no = self.__sync_record_file_no(base_no, set_ver)
        header["file_no"] = base_no
        header["doc_version"] = set_ver or "A0"
        header["product_name"] = (product.name or "").strip() if product else ""
        header["full_version"] = (product.full_version or "").strip() if product else ""
        cli, cq, cb, srv, sq, net, tool = self.__stp_devices_and_net(product_id)
        header["client_info"] = cli
        header["client_qty"] = cq
        header["client_browser"] = cb
        header["server_info"] = srv
        header["server_qty"] = sq
        header["network"] = net
        header["test_tool"] = tool
        return header

    def __persist_header(self, record: DevTestRecordDoc, header: dict):
        if not record:
            return
        content = record.content if isinstance(record.content, dict) else {}
        content = dict(content)
        content["header"] = header
        if "results" not in content:
            content["results"] = {}
        record.content = content
        if header.get("file_no"):
            record.file_no = header["file_no"]
        if header.get("doc_version"):
            record.version = header["doc_version"]
        db.session.commit()

    def __apply_header_to_sheet(self, ws, stage: str, header: dict):
        meta = STAGE_META.get(stage) or {}
        title = meta.get("title") or stage
        file_no = header.get("file_no") or ""
        if file_no:
            ws.cell(1, 1, value=file_no)
        ws.cell(2, 1, value=title)
        name = header.get("product_name") or ""
        ver = header.get("full_version") or ""
        doc_ver = header.get("doc_version") or ""
        # 封面区「文件版本」
        for r in range(1, min(20, (ws.max_row or 0) + 1)):
            for c in range(1, min(12, (ws.max_column or 0) + 1)):
                if str(ws.cell(r, c).value or "").strip() == "文件版本" and doc_ver:
                    ws.cell(r, c + 1, value=doc_ver)
        for r in range(60, min(95, (ws.max_row or 90) + 1)):
            label = str(ws.cell(r, 1).value or "").strip()
            if label == "总述" and name:
                ws.cell(r, 2, value=f"该文档是{name}项目{ver}版本{stage}用例设计，它详细描述了测试步骤，预期结果等")
            elif label == "测试设备需求" or (r > 1 and str(ws.cell(r, 2).value or "").strip() == "用户端"):
                pass
            if str(ws.cell(r, 2).value or "").strip() == "用户端" and header.get("client_info"):
                ws.cell(r, 4, value=header["client_info"])
                if header.get("client_qty"):
                    ws.cell(r, 6, value=header["client_qty"])
                if header.get("client_browser"):
                    ws.cell(r, 7, value=header["client_browser"])
            if str(ws.cell(r, 2).value or "").strip() == "服务端" and header.get("server_info"):
                ws.cell(r, 4, value=header["server_info"])
                if header.get("server_qty"):
                    ws.cell(r, 6, value=header["server_qty"])
            if label == "网络环境" and header.get("network"):
                ws.cell(r, 2, value=header["network"])
            if label == "测试版本":
                if ver:
                    ws.cell(r, 2, value=ver)
                if header.get("start_date"):
                    ws.cell(r, 4, value=header["start_date"])
                if header.get("designer"):
                    ws.cell(r, 6, value=header["designer"])
                if header.get("test_tool"):
                    ws.cell(r, 8, value=header["test_tool"])
            if label == "代码版本":
                # 代码版本沿用模版，不覆盖 col2
                if header.get("end_date"):
                    ws.cell(r, 4, value=header["end_date"])
                if header.get("tester"):
                    ws.cell(r, 6, value=header["tester"])

    async def ensure_from_case_import(self, product_id: int, stage: str):
        """单元/集成/系统用例导入成功后：无记录则建 A0，有则仅保证存在。"""
        if not product_id or stage not in STAGE_META:
            return
        try:
            existing = db.session.execute(
                select(DevTestRecordDoc).where(
                    DevTestRecordDoc.product_id == product_id,
                    DevTestRecordDoc.stage == stage,
                ).order_by(DevTestRecordDoc.id.desc())
            ).scalars().first()
            if existing:
                logger.info("dev_test_record exists id=%s stage=%s product_id=%s", existing.id, stage, product_id)
                return
            row = DevTestRecordDoc(
                product_id=product_id,
                stage=stage,
                version="A0",
                file_no=self.__dhf_file_no(product_id, stage) or None,
                content={"header": {}, "results": {}},
            )
            db.session.add(row)
            db.session.commit()
            logger.info("dev_test_record created id=%s stage=%s product_id=%s", row.id, stage, product_id)
        except Exception:
            logger.exception("ensure_from_case_import failed product_id=%s stage=%s", product_id, stage)
            db.session.rollback()

    def __find_header_row(self, ws):
        for r in range(1, min(120, (ws.max_row or 0) + 1)):
            v = ws.cell(r, 1).value
            if v and any(k in str(v) for k in _HEADER_KEYS):
                return r
        return None

    def __clear_data_rows(self, ws, header_row: int):
        if not header_row or not ws.max_row or ws.max_row <= header_row:
            return
        ws.delete_rows(header_row + 1, ws.max_row - header_row)

    def __write_case_block(self, ws, header_row: int, stage: str, group_cases, results: dict):
        for i, c in enumerate(group_cases):
            ridx = header_row + 1 + i
            code = (c.code or "").strip()
            res = results.get(code) or {}
            actual = res.get("actual")
            if actual is None or actual == "":
                actual = c.expect or ""
            vals = [
                code,
                c.srs_code or "",
                c.test_type or "",
                stage,
                c.function or "",
                c.description or "",
                c.precondition or "",
                c.test_step or "",
                c.expect or "",
                actual,
                res.get("result") or "",
                res.get("remark") if res.get("remark") is not None else (c.note or ""),
            ]
            for col, val in enumerate(vals, 1):
                ws.cell(ridx, col, value=val)

    def export_record_xlsx(self, output, product_id: int, stage: str):
        """导出测试记录：表头自动获取；按 sheet_name 分 sheet。"""
        meta = STAGE_META.get(stage)
        if not meta:
            raise ValueError(f"unsupported stage: {stage}")
        path = self.__template_path(stage)
        if not os.path.isfile(path):
            raise FileNotFoundError(path)

        record = db.session.execute(
            select(DevTestRecordDoc).where(
                DevTestRecordDoc.product_id == product_id,
                DevTestRecordDoc.stage == stage,
            ).order_by(DevTestRecordDoc.id.desc())
        ).scalars().first()
        results = {}
        if record and isinstance(record.content, dict):
            results = record.content.get("results") or {}

        product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
        header = self.__build_header(product_id, stage, product, record)
        self.__persist_header(record, header)

        cases = self.__cases(product_id, stage)
        groups = OrderedDict()
        for c in cases:
            sn = (getattr(c, "sheet_name", None) or "").strip() or meta["title"]
            groups.setdefault(sn, []).append(c)
        if not groups:
            groups[meta["title"]] = []

        wb = load_workbook(path)
        template = wb[wb.sheetnames[0]]
        header_row = self.__find_header_row(template) or 78

        def safe_title(name, used):
            base = re.sub(r'[\\/*?:\[\]]+', "_", name or meta["title"]).strip()[:31] or "Sheet1"
            title = base
            i = 2
            while title in used:
                suffix = f"_{i}"
                title = base[: 31 - len(suffix)] + suffix
                i += 1
            used.add(title)
            return title

        used = set()
        names = list(groups.keys())

        self.__clear_data_rows(template, header_row)
        self.__apply_header_to_sheet(template, stage, header)
        self.__write_case_block(template, header_row, stage, groups[names[0]], results)
        template.title = safe_title(names[0], used)

        for name in names[1:]:
            ws = wb.copy_worksheet(template)
            hr = self.__find_header_row(ws) or header_row
            self.__clear_data_rows(ws, hr)
            self.__apply_header_to_sheet(ws, stage, header)
            self.__write_case_block(ws, hr, stage, groups[name], results)
            ws.title = safe_title(name, used)

        wb.save(output)
        output.seek(0)
