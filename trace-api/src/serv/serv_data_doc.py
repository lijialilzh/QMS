#!/usr/bin/env python
# encoding: utf-8

# 数据文件服务层，详见 docs/function_docs/100_数据文件管理.md。
# 单表 data_doc + doc_type；导出结构与产品立项报告一致：封面→分页→修订记录→分页→目录→分页→正文。

import base64
import copy
import logging
import re
from io import BytesIO
from typing import List
from sqlalchemy import delete, func, select
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT

from ..model.product import Product
from ..model.data_doc import DataDoc
from ..model.project_timeline import ProjectTimelineRow, ProjectTimelineCell
from ..model.project_member import ProjectMember
from ..obj import Page, Resp
from ..obj.tobj_role import Roles
from ..obj.vobj_user import UserObj
from ..obj.tobj_data_doc import DataDocForm
from ..obj.vobj_data_doc import DataDocObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from . import serv_review_util
from .serv_utils import new_version, sync_file_no_version
from .serv_utils import docx_util
from .data_doc_templates import DOC_META, DEFAULT_CONTENTS

logger = logging.getLogger(__name__)

COVER_DEPT = "数据部"


def doc_title(doc_type):
    return (DOC_META.get(doc_type) or {}).get("title") or "数据文件"


def doc_keywords(doc_type):
    return list((DOC_META.get(doc_type) or {}).get("keywords") or [])


def doc_format(doc_type):
    return (DOC_META.get(doc_type) or {}).get("format") or "docx"


def _empty_template(doc_type):
    title = doc_title(doc_type)
    return {
        "sections": [
            {
                "title": title, "ref_type": "cover", "body": "", "children": [],
                "tables": [[
                    ["编制部门", COVER_DEPT, "文件版本", "A0"],
                    ["编制人", "", "日期", ""],
                    ["审核人", "", "日期", ""],
                    ["批准人", "", "日期", ""],
                    ["生效日期", "", "", ""],
                ]],
            },
            {
                "title": "文件修订记录", "ref_type": "revision", "body": "", "children": [],
                "tables": [[
                    ["修改日期", "版本号", "修订说明", "修订人", "批准人"],
                    ["", "", "首次发布", "", ""],
                    ["", "", "", "", ""],
                    ["", "", "", "", ""],
                    ["", "", "", "", ""],
                    ["", "", "", "", ""],
                ]],
            },
            {
                "title": "产品信息", "ref_type": "basic_info", "body": "", "children": [],
                "tables": [[
                    ["基本信息", "描述"],
                    ["产品名称", ""],
                    ["软件版本", ""],
                    ["产品标识", ""],
                    ["预期用途", ""],
                ]],
            },
        ]
    }


class Server(object):

    def __default_content(self, doc_type):
        raw = DEFAULT_CONTENTS.get(doc_type)
        return copy.deepcopy(raw) if raw else _empty_template(doc_type)

    def __to_obj(self, row: DataDoc, product: Product = None):
        obj = DataDocObj(**row.dict())
        obj.content = self.__normalize_content(obj.content, row.doc_type)
        self.__fill_cover_meta(obj.content, obj.version)
        key = row.doc_type or ""
        serv_review_util.fill_cover_dates(
            obj.content, serv_review_util.cover_date(row.product_id, key) if row.product_id else ""
        )
        serv_review_util.fill_cover_signers(
            obj.content, serv_review_util.cover_signers(row.product_id, key) if row.product_id else {}
        )
        if product:
            obj.product_name = product.name
            obj.product_version = product.full_version
            obj.product_full_version = product.full_version
            obj.product_type_code = product.type_code
            if not (obj.file_no or "").strip():
                resolved = serv_review_util.resolve_doc_file_no(product.id, obj.file_no, obj.version, key)
                if resolved:
                    obj.file_no = resolved
        return obj

    @staticmethod
    def __migrate_cover_table(rows):
        """把旧版 2 列或「使用部门/版本号」封面迁移为 4 列：编制部门 / 数据部。"""
        rows = [r for r in (rows or []) if isinstance(r, list)]
        if rows and len(rows[0]) >= 4 and str(rows[0][0]).strip() == "编制部门":
            if not str(rows[0][1] if len(rows[0]) > 1 else "").strip():
                rows[0][1] = COVER_DEPT
            return rows
        items = [(str(r[0]).strip(), str(r[1]).strip() if len(r) > 1 else "") for r in rows if r]
        def val(*labels):
            for want in labels:
                for l, v in items:
                    if l == want:
                        return v
            return ""
        dates = [v for l, v in items if l == "日期"]
        d = lambda i: dates[i] if i < len(dates) else ""
        dept = val("编制部门", "使用部门", "编写部门") or COVER_DEPT
        ver = val("文件版本", "版本号") or "A0"
        return [
            ["编制部门", dept, "文件版本", ver],
            ["编制人", val("编制人"), "日期", d(0)],
            ["审核人", val("审核人"), "日期", d(1)],
            ["批准人", val("批准人"), "日期", d(2)],
            ["生效日期", val("生效日期"), "", ""],
        ]

    def __normalize_node(self, node):
        if not isinstance(node, dict):
            return {"title": str(node or ""), "body": "", "tables": [], "children": []}
        result = dict(node)
        result["title"] = str(result.get("title") or "")
        result["body"] = str(result.get("body") or "")
        tables = result.get("tables")
        if not isinstance(tables, list):
            tables = []
        norm_tables = []
        for table in tables:
            if isinstance(table, list):
                norm_tables.append([[str(c) if c is not None else "" for c in (row or [])] for row in table if isinstance(row, list)])
        if result.get("ref_type") == "cover" and norm_tables:
            norm_tables = [self.__migrate_cover_table(norm_tables[0])] + norm_tables[1:]
        result["tables"] = norm_tables
        children = result.get("children")
        result["children"] = [self.__normalize_node(c) for c in children] if isinstance(children, list) else []
        return result

    def __normalize_content(self, content, doc_type=None):
        if not isinstance(content, dict) or not isinstance(content.get("sections"), list):
            return self.__default_content(doc_type)
        return {"sections": [self.__normalize_node(s) for s in content["sections"]]}

    @staticmethod
    def __fill_cover_meta(content, version):
        """封面编制部门 / 文件版本：仅填空。"""
        for section in (content or {}).get("sections") or []:
            if not isinstance(section, dict):
                continue
            for table in (section.get("tables") or []):
                if not isinstance(table, list):
                    continue
                for row in table:
                    if not isinstance(row, list) or not row:
                        continue
                    label = str(row[0] or "").strip()
                    if label in ("编制部门", "使用部门", "编写部门") and len(row) >= 2:
                        if not str(row[1] or "").strip():
                            row[1] = COVER_DEPT
                    if label in ("文件版本", "版本号") and len(row) >= 4:
                        if version and not str(row[3] or "").strip():
                            row[3] = version

    def __autofill_for_export(self, content, obj: DataDocObj):
        sections = (content or {}).get("sections") or []
        prod_id = obj.product_id
        if not prod_id:
            return content
        product = db.session.execute(select(Product).where(Product.id == prod_id)).scalars().first()
        info = self.__collect_autofill(prod_id, product, obj.version, obj.doc_type)
        for node in sections:
            self.__fill_node(node, info)
        self.__fill_cover_meta(content, obj.version)
        key = obj.doc_type or ""
        serv_review_util.fill_cover_dates(content, serv_review_util.cover_date(prod_id, key))
        serv_review_util.fill_cover_signers(content, serv_review_util.cover_signers(prod_id, key))
        return content

    def __collect_autofill(self, prod_id, product, doc_version, doc_type):
        prod_name = (getattr(product, "name", "") or "").strip()
        full_version = (getattr(product, "full_version", "") or "").strip()
        product_code = (getattr(product, "product_code", "") or "").strip()
        scope = (getattr(product, "scope", "") or "").strip()

        tl_rows = db.session.execute(
            select(ProjectTimelineRow).where(ProjectTimelineRow.prod_id == prod_id)
        ).scalars().all()
        cell_map = {}
        if tl_rows:
            for c in db.session.execute(
                select(ProjectTimelineCell).where(ProjectTimelineCell.row_id.in_([r.id for r in tl_rows]))
            ).scalars().all():
                cell_map.setdefault(c.row_id, []).append(c.output_result or "")

        def to_int(v):
            digits = re.sub(r"[^\d]", "", str(v or ""))
            return int(digits) if digits else None

        date_rows = [r for r in tl_rows if (r.row_type or "date") == "date" and to_int(r.year) and to_int(r.month)]

        def date_key(r):
            return to_int(r.year) * 10000 + to_int(r.month) * 100 + (to_int(r.day) or 0)

        kws = doc_keywords(doc_type) or [doc_title(doc_type)]
        file_rows = [
            r for r in date_rows
            if any(any(k in str(v or "") for k in kws) for v in cell_map.get(r.id, []))
        ]
        file_date = ""
        if file_rows:
            fr = min(file_rows, key=date_key)
            file_date = f"{to_int(fr.year)}年{to_int(fr.month)}月{to_int(fr.day)}日"

        members = db.session.execute(select(ProjectMember).where(ProjectMember.prod_id == prod_id)).scalars().all()
        def find_member(pred):
            for m in members:
                if pred(str(m.role or "")):
                    return (m.name or "").strip()
            return ""
        modeler = find_member(lambda r: "模型" in r)
        algo = find_member(lambda r: "算法" in r)
        approver = find_member(lambda r: "负责人" in r)

        return {
            "prod_name": prod_name, "full_version": full_version, "product_code": product_code,
            "scope": scope, "file_date": file_date, "version": doc_version,
            "reviser": modeler or algo, "approver": approver,
        }

    @staticmethod
    def __strip_num(title):
        return re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(title or "")).strip()

    def __fill_node(self, node, info):
        ref = node.get("ref_type")
        title = self.__strip_num(node.get("title"))
        if ref == "revision" or title == "文件修订记录":
            tables = node.get("tables") or []
            if tables and isinstance(tables[0], list):
                t = tables[0]
                cols = len(t[0]) if t and t[0] else 5
                while len(t) < 6:
                    t.append([""] * cols)
                row = t[1]
                def set_if(i, val):
                    if val and not str(row[i] if i < len(row) else "").strip():
                        row[i] = val
                set_if(0, info["file_date"])
                set_if(1, info["version"])
                if not str(row[2] if len(row) > 2 else "").strip():
                    row[2] = "首次发布"
                set_if(3, info["reviser"])
                set_if(4, info["approver"])
        if ref == "basic_info" or title == "产品信息":
            label_map = {
                "产品名称": info["prod_name"],
                "软件版本": info["full_version"],
                "完整版本": info["full_version"],
                "产品标识": info["product_code"],
                "产品代码": info["product_code"],
                "适用范围": info["scope"],
                "预期用途": info["scope"],
                "项目名称": info["prod_name"],
            }
            for table in (node.get("tables") or []):
                for row in table:
                    if not isinstance(row, list) or len(row) < 2:
                        continue
                    key = str(row[0]).strip()
                    if key in label_map and label_map[key] and not str(row[1] or "").strip():
                        row[1] = label_map[key]
        for child in (node.get("children") or []):
            self.__fill_node(child, info)

    def __exists(self, product_id, doc_type, version, exclude_id=None):
        sql = select(func.count(DataDoc.id)).where(
            DataDoc.product_id == product_id,
            DataDoc.doc_type == doc_type,
            DataDoc.version == version,
        )
        if exclude_id:
            sql = sql.where(DataDoc.id != exclude_id)
        return (db.session.execute(sql).scalar() or 0) > 0

    async def add_data_doc(self, form: DataDocForm):
        try:
            doc_type = (form.doc_type or "").strip()
            if doc_type not in DOC_META:
                return Resp.resp_err(msg=ts("msg_err_param"))
            if self.__exists(form.product_id, doc_type, form.version):
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            payload = form.dict(exclude_none=True)
            payload["doc_type"] = doc_type
            row = DataDoc(**payload)
            row.id = None
            row.file_no = serv_review_util.resolve_doc_file_no(form.product_id, form.file_no, form.version, doc_type) or None
            row.content = self.__normalize_content(row.content, doc_type)
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=DataDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def duplicate_data_doc(self, id: int, product_id: int = None):
        try:
            fromdoc: DataDoc = db.session.execute(select(DataDoc).where(DataDoc.id == id)).scalars().first()
            if not fromdoc:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            target_pid = product_id or fromdoc.product_id
            all_versions = db.session.execute(
                select(DataDoc.version).where(DataDoc.product_id == target_pid, DataDoc.doc_type == fromdoc.doc_type)
            ).scalars().all()
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
            newdoc = DataDoc(
                product_id=target_pid,
                doc_type=fromdoc.doc_type,
                version=version,
                file_no=sync_file_no_version(
                    (fromdoc.file_no or "").strip()
                    or serv_review_util.resolve_doc_file_no(target_pid, "", version, fromdoc.doc_type)
                    or "",
                    version,
                ) or None,
                change_log=fromdoc.change_log,
                content=copy.deepcopy(self.__normalize_content(fromdoc.content, fromdoc.doc_type)),
            )
            db.session.add(newdoc)
            db.session.commit()
            return Resp.resp_ok(data=DataDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_data_doc(self, form: DataDocForm):
        try:
            row: DataDoc = db.session.execute(select(DataDoc).where(DataDoc.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            payload = form.dict(exclude_none=True)
            payload.pop("doc_type", None)
            next_pid = payload.get("product_id", row.product_id)
            next_ver = payload.get("version", row.version)
            if next_pid != row.product_id or next_ver != row.version:
                if self.__exists(next_pid, row.doc_type, next_ver, exclude_id=row.id):
                    return Resp.resp_err(msg=ts("msg_obj_exist"))
            for key, value in payload.items():
                if key == "id":
                    continue
                if key == "content":
                    value = self.__normalize_content(value, row.doc_type)
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_data_doc(self, id: int):
        db.session.execute(delete(DataDoc).where(DataDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def get_data_doc(self, id: int):
        sql = select(DataDoc, Product).join(Product, DataDoc.product_id == Product.id).where(DataDoc.id == id)
        row = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        return Resp.resp_ok(data=self.__to_obj(doc, product))

    def parse_stats_excel(self, raw: bytes):
        """解析统计脚本输出的 xlsx：每个工作表一章，供编辑页展示。不落库。"""
        from openpyxl import load_workbook
        if not raw:
            return Resp.resp_err(msg="请选择 Excel 文件")
        try:
            wb = load_workbook(BytesIO(raw), data_only=True)
        except Exception:
            return Resp.resp_err(msg="无法读取 Excel")
        sections = []
        for name in wb.sheetnames:
            ws = wb[name]
            grid = []
            max_col = ws.max_column or 1
            max_row = ws.max_row or 1
            for row in ws.iter_rows(min_row=1, max_row=max_row, max_col=max_col, values_only=True):
                cells = ["" if v is None else str(v) for v in row]
                if not any(str(c).strip() for c in cells):
                    continue
                while cells and not str(cells[-1]).strip():
                    cells.pop()
                grid.append(cells)
            sections.append({
                "title": (name or "Sheet")[:64],
                "body": "",
                "tables": [grid] if grid else [],
                "children": [],
            })
        if not sections or not any((s.get("tables") or [None])[0] for s in sections):
            return Resp.resp_err(msg="Excel 无有效表格")
        return Resp.resp_ok(data={"sections": sections})

    async def list_data_doc(self, op_user: UserObj = None, product_id: int = 0, version: str = None,
                             doc_type: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if doc_type:
            wheres.append(DataDoc.doc_type == doc_type)
        if product_id:
            wheres.append(DataDoc.product_id == product_id)
        if version:
            wheres.append(DataDoc.version.like(f"%{version}%"))
        if op_user and op_user.id != 1 and op_user.role_code == Roles.product_manager.value.code:
            wheres.append(Product.create_user_id == op_user.id)
        sql_total = select(func.count(DataDoc.id)).join(Product, DataDoc.product_id == Product.id).where(*wheres)
        total = db.session.execute(sql_total).scalar() or 0
        sql = (
            select(DataDoc, Product)
            .join(Product, DataDoc.product_id == Product.id)
            .where(*wheres)
            .order_by(DataDoc.id.desc())
            .offset(page_index * page_size)
            .limit(page_size)
        )
        rows: List[DataDocObj] = [self.__to_obj(doc, product) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    def __export_xlsx(self, output, obj: DataDocObj, content):
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, Border, Side

        wb = Workbook()
        default = wb.active
        used_names = set()
        thin = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )

        def sheet_name(title):
            raw = self.__strip_num(title) or "Sheet"
            name = re.sub(r'[:\\/\?\*\[\]]', "_", raw)[:31] or "Sheet"
            base = name
            idx = 2
            while name.lower() in used_names:
                suffix = str(idx)
                name = (base[: 31 - len(suffix)] + suffix)
                idx += 1
            used_names.add(name.lower())
            return name

        def write_table(ws, grid, start_row=1):
            r_idx = start_row
            for r_i, row in enumerate(grid or []):
                if not isinstance(row, list):
                    continue
                for c_i, val in enumerate(row, 1):
                    s = str(val or "")
                    if s.startswith("data:image"):
                        s = "[签名]"
                    cell = ws.cell(r_idx, c_i, s)
                    cell.alignment = Alignment(wrap_text=True, vertical="center")
                    cell.border = thin
                    if r_i == 0:
                        cell.font = Font(bold=True, name="宋体")
                    else:
                        cell.font = Font(name="宋体")
                r_idx += 1
            return r_idx

        first = True
        for node in (content or {}).get("sections") or []:
            ws = default if first else wb.create_sheet()
            first = False
            ws.title = sheet_name(node.get("title"))
            title = self.__strip_num(node.get("title"))
            ws.cell(1, 1, title).font = Font(bold=True, size=14, name="宋体")
            row = 3
            if (node.get("body") or "").strip():
                ws.cell(row, 1, node.get("body"))
                row += 2
            for table in (node.get("tables") or []):
                row = write_table(ws, table, row) + 2
            for child in (node.get("children") or []):
                ws.cell(row, 1, self.__strip_num(child.get("title"))).font = Font(bold=True, name="宋体")
                row += 1
                if (child.get("body") or "").strip():
                    ws.cell(row, 1, child.get("body"))
                    row += 1
                for table in (child.get("tables") or []):
                    row = write_table(ws, table, row) + 2
        if first:
            default.title = "数据文件"
        wb.save(output)
        output.seek(0)

    async def export_data_doc(self, output, id: int):
        resp = await self.get_data_doc(id)
        obj: DataDocObj = resp.data
        if obj is None:
            Document().save(output)
            output.seek(0)
            return "数据文件", "docx"
        c = self.__autofill_for_export(self.__normalize_content(obj.content, obj.doc_type), obj)
        title = doc_title(obj.doc_type)
        if doc_format(obj.doc_type) == "xlsx":
            self.__export_xlsx(output, obj, c)
            return title, "xlsx"
        sections = c.get("sections") or []
        document = Document()
        section = document.sections[0]
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.7)
        section.right_margin = Inches(0.7)
        update_fields = OxmlElement("w:updateFields")
        update_fields.set(qn("w:val"), "true")
        document.settings.element.append(update_fields)
        header_para = section.header.add_paragraph()
        header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        docx_util.fonted_txt(header_para, obj.file_no or "")
        docx_util.add_page_number_footer(section, obj.file_no or "")

        def write_center_title(text, size=22.0, bold=False):
            p = document.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.first_line_indent = Pt(0)
            p.paragraph_format.left_indent = Pt(0)
            p.paragraph_format.right_indent = Pt(0)
            p.paragraph_format.line_spacing = 1.5
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            docx_util.fonted_txt(p, text, font_size=size, bold=bold)

        def add_blank_lines(count):
            for _ in range(max(0, int(count or 0))):
                document.add_paragraph("")

        def add_text(text):
            docx_util.save_txt2docx(str(text or ""), document)

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT):
            s = str(text or "")
            if s.startswith("data:image"):
                try:
                    b64 = s.split(",", 1)[1] if "," in s else ""
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = align
                    para.add_run().add_picture(BytesIO(base64.b64decode(b64)), height=Pt(33))
                    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    return
                except Exception:
                    pass
            cell.text = ""
            lines = s.split("\n")
            for i, line in enumerate(lines):
                para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
                para.alignment = align
                para.paragraph_format.line_spacing = 1.3
                docx_util.fonted_txt(para, line, font_size=10.5, bold=bold)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER if align == WD_ALIGN_PARAGRAPH.CENTER else WD_CELL_VERTICAL_ALIGNMENT.TOP

        def add_grid(grid):
            grid = [row for row in (grid or []) if isinstance(row, list)]
            cols = max((len(row) for row in grid), default=0)
            if cols <= 0:
                return
            table = document.add_table(rows=0, cols=cols)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            for r_idx, row in enumerate(grid):
                cells = table.add_row().cells
                for c_idx in range(cols):
                    set_cell(cells[c_idx], row[c_idx] if c_idx < len(row) else "", bold=(r_idx == 0))
            document.add_paragraph()

        def add_cover_grid(grid):
            grid = [row for row in (grid or []) if isinstance(row, list)]
            cols = max((len(row) for row in grid), default=0)
            if cols <= 0:
                return
            table = document.add_table(rows=0, cols=cols)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            for row in grid:
                cells = table.add_row().cells
                for c_idx in range(cols):
                    text = row[c_idx] if c_idx < len(row) else ""
                    set_cell(cells[c_idx], text, bold=(c_idx % 2 == 0), align=WD_ALIGN_PARAGRAPH.CENTER)
                if (str(row[0]).strip() if row else "") == "生效日期" and cols > 2:
                    merged = cells[1]
                    for c_idx in range(2, cols):
                        merged = merged.merge(cells[c_idx])
                    set_cell(merged, row[1] if len(row) > 1 else "", align=WD_ALIGN_PARAGRAPH.CENTER)
            document.add_paragraph()

        def add_body_heading(title, level):
            size = {1: 16.0, 2: 14.0, 3: 12.0}.get(level, 11.0)
            p = document.add_heading("", level=max(1, min(level, 9)))
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.first_line_indent = Pt(0)
            p.paragraph_format.left_indent = Pt(0)
            p.paragraph_format.line_spacing = 1.5
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            docx_util.fonted_txt(p, title, font_size=size, bold=True)

        def render_body_section(node, level, number=""):
            name = self.__strip_num(node.get("title"))
            heading = f"{number} {name}".strip() if number else name
            add_body_heading(heading, level=max(1, min(level, 9)))
            if (node.get("body") or "").strip():
                add_text(node.get("body"))
            for table in (node.get("tables") or []):
                add_grid(table)
            idx = 0
            for child in (node.get("children") or []):
                idx += 1
                child_num = f"{number}.{idx}" if number else f"{idx}"
                render_body_section(child, level + 1, child_num)

        cover = next((s for s in sections if s.get("ref_type") == "cover"), None)
        revision = next((s for s in sections if s.get("ref_type") == "revision"), None)
        body = [s for s in sections if s.get("ref_type") not in ("cover", "revision")]
        title = (self.__strip_num(cover.get("title")) if cover else "") or doc_title(obj.doc_type)

        add_blank_lines(6)
        write_center_title(title, size=22.0, bold=True)
        add_blank_lines(4)
        if cover:
            for table in (cover.get("tables") or []):
                add_cover_grid(table)

        document.add_page_break()
        write_center_title("文件修订记录", size=14.0, bold=True)
        add_blank_lines(2)
        if revision:
            for table in (revision.get("tables") or []):
                add_grid(table)

        document.add_page_break()
        write_center_title("目录", size=16.0, bold=True)
        docx_util.insert_toc_field(document)

        document.add_page_break()
        for i, node in enumerate(body):
            render_body_section(node, 1, str(i + 1))

        docx_util.fill_toc_cache(document)
        document.save(output)
        output.seek(0)
        return title, "docx"
