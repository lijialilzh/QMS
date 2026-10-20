#!/usr/bin/env python
# encoding: utf-8

# 现场测试规程服务层（测试文件 VV-006），结构与软件测试计划(stp)一致。
# 默认内容取自 src-res/ftr_default_content.json。

import copy
import json
import logging
import os
import re
from typing import List

from sqlalchemy import delete, func, select
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT

from ..model.product import Product
from ..model.ftr_doc import FtrDoc
from ..model.prod_dhf import ProdDhf
from ..model.project_member import ProjectMember
from ..obj import Page, Resp
from ..obj.tobj_role import Roles
from ..obj.vobj_user import UserObj
from ..obj.tobj_ftr_doc import FtrDocForm
from ..obj.vobj_ftr_doc import FtrDocObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from .serv_utils import new_version, sync_file_no_version
from .serv_utils import docx_util
from .serv_utils.doc_blocks import emit_free_body, has_free_body_markers, write_body_image
from . import serv_review_util
from .serv_prod_runtime_env import apply_runtime_to_pdp_content

logger = logging.getLogger(__name__)

DOC_NAME = "现场测试规程"
DOC_KEY = "ftr"
BASE_NAME = "InferOperate Suite"

_DEFAULT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "src-res", "ftr_default_content.json"
)
try:
    with open(_DEFAULT_FILE, encoding="utf-8") as _f:
        DEFAULT_FTR_CONTENT = json.load(_f)
except Exception:
    DEFAULT_FTR_CONTENT = {"sections": []}


class Server(object):

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
                grid = [[str(c) if c is not None else "" for c in (row or [])] for row in table if isinstance(row, list)]
                norm_tables.append(self.__normalize_case_table(grid))
        result["tables"] = norm_tables
        # 兼容旧数据：如果有 blocks（之前改造残留），把 blocks 中的 table/text 提取回 tables/body
        blocks = result.get("blocks")
        if isinstance(blocks, list) and blocks and not result["body"] and not norm_tables:
            parts = []
            tbls = []
            for blk in blocks:
                if not isinstance(blk, dict):
                    continue
                btype = blk.get("type")
                if btype == "text" and blk.get("text"):
                    parts.append(str(blk["text"]))
                elif btype == "table" and blk.get("table"):
                    tbl = blk["table"]
                    tbls.append([[str(c) if c is not None else "" for c in (row or [])] for row in tbl if isinstance(row, list)])
                    parts.append("见下表")
            if parts:
                result["body"] = "\n".join(parts)
            if tbls:
                result["tables"] = tbls
            result.pop("blocks", None)
        elif "blocks" in result:
            result.pop("blocks", None)
        children = result.get("children")
        result["children"] = [self.__normalize_node(c) for c in children] if isinstance(children, list) else []
        return result

    def __normalize_content(self, content):
        if not isinstance(content, dict) or not isinstance(content.get("sections"), list):
            return copy.deepcopy(DEFAULT_FTR_CONTENT)
        return {"sections": [self.__normalize_node(s) for s in content["sections"]]}

    @staticmethod
    def __normalize_case_table(grid):
        """功能测试用例表统一为图3格式（两列）：
        序号/用例标题/功能描述/系统设置 为「标签|值」；
        下一行「执行步骤|预期结果」；再下一行步骤内容|预期内容。
        旧三列表（中间列重复）打开时归一。"""
        if not isinstance(grid, list) or not grid:
            return grid
        head0 = str((grid[0] or [""])[0] or "").strip()
        if head0 != "序号":
            return grid
        width = max((len(r) for r in grid if isinstance(r, list)), default=0)
        if width <= 2:
            return grid
        out = []
        for row in grid:
            if not isinstance(row, list) or not row:
                continue
            lab = str(row[0] or "").strip()
            if lab in ("序号", "用例标题", "功能描述", "系统设置"):
                out.append([lab, str(row[1] if len(row) > 1 else "")])
            elif lab == "执行步骤":
                # 旧表头可能是 [执行步骤, 执行步骤, 预期结果]
                right = "预期结果"
                if len(row) >= 3 and str(row[2] or "").strip():
                    right = str(row[2]).strip()
                elif len(row) >= 2 and str(row[1] or "").strip() in ("预期结果", "预期"):
                    right = str(row[1]).strip()
                out.append(["执行步骤", right if right else "预期结果"])
            else:
                # 内容行：取第2列步骤、第3列预期（若第2=第3则第2作步骤、第3作预期）
                steps = str(row[1] if len(row) > 1 else "")
                expected = str(row[2] if len(row) > 2 else "")
                if expected == "" and steps and len(row) == 2:
                    expected = ""
                out.append([steps, expected])
        return out

    def __replace_name(self, node, base, name, skip_titles=None):
        if not name or base == name:
            return
        if skip_titles and str(node.get("title") or "").strip() in skip_titles:
            return
        if node.get("body"):
            node["body"] = node["body"].replace(base, name)
        for tbl in (node.get("tables") or []):
            for row in tbl:
                for i in range(len(row)):
                    if isinstance(row[i], str) and base in row[i]:
                        row[i] = row[i].replace(base, name)
        for c in (node.get("children") or []):
            self.__replace_name(c, base, name, skip_titles=skip_titles)

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

    def __fill_revision(self, content, prod_id, version, force=False):
        """文件修订记录首行：修订人=测试人员（2025.09 前宋月/之后孙家旭）、批准人=研发负责人。打开即覆盖。"""
        rev_date = serv_review_util.cover_date(prod_id, DOC_KEY) if prod_id else ""
        reviser = "宋月" if serv_review_util._before_202509(rev_date) else "孙家旭"
        approver = ""
        if prod_id:
            members = db.session.execute(select(ProjectMember).where(ProjectMember.prod_id == prod_id)).scalars().all()
            approver = next((m.name for m in members if "研发负责人" in str(m.role or "")), "")
        for s in (content.get("sections") or []):
            if s.get("ref_type") != "revision":
                continue
            tables = s.get("tables") or []
            if tables and isinstance(tables[0], list) and tables[0]:
                t = tables[0]
                cols = len(t[0]) if isinstance(t[0], list) and t[0] else 5
                while len(t) < 6:
                    t.append([""] * cols)
                if len(t) >= 2 and isinstance(t[1], list) and len(t[1]) >= 3:
                    row = t[1]
                    if force or rev_date:
                        row[0] = rev_date or ""
                    elif not str(row[0] or "").strip():
                        row[0] = rev_date
                    if force:
                        if len(row) >= 2: row[1] = str(version or "")
                        if len(row) >= 3: row[2] = "首次发布"
                    else:
                        if version and len(row) >= 2 and not str(row[1] or "").strip(): row[1] = str(version)
                        if len(row) >= 3 and not str(row[2] or "").strip(): row[2] = "首次发布"
                    if len(row) >= 4:
                        row[3] = reviser
                    if len(row) >= 5:
                        row[4] = approver
            break
        return content

    def __fill_runtime_env(self, content, prod_id, force=False):
        """运行环境表从产品 prod_runtime_env 整表覆盖（含增删行列后的结构）。"""
        return apply_runtime_to_pdp_content(content, prod_id)

    @staticmethod
    def __strip_title(title):
        return re.sub(r"^\s*\d+(?:\.\d+)*[、.\s]*", "", str(title or "")).strip()

    def __fill_scope(self, content, product):
        """1.2 范围：产品名称/完整版本自动获取；有产品型号(type_code)则写入，无则隐藏该行。"""
        if not product:
            return
        name = (product.name or "").strip()
        type_code = (getattr(product, "type_code", None) or "").strip()
        full_version = (product.full_version or "").strip()
        if not (name or type_code or full_version):
            return

        def walk(node):
            if self.__strip_title(node.get("title")) == "范围":
                lines = []
                if name:
                    lines.append(f"产品名称：{name}")
                if type_code:
                    lines.append(f"产品型号：{type_code}")
                if full_version:
                    lines.append(f"完整版本：{full_version}")
                if name:
                    lines.append(f"该测试覆盖了{name}全部功能测试。")
                if lines:
                    node["body"] = "\n".join(lines)
            for c in (node.get("children") or []):
                walk(c)

        for s in (content.get("sections") or []):
            walk(s)

    def __autofill(self, content, prod_id, product=None, version="", force=False):
        if not isinstance(content, dict):
            return content
        if product and product.name:
            for s in (content.get("sections") or []):
                self.__replace_name(s, BASE_NAME, product.name)
            # 更新完整版本号（非「范围」章仍用正则；范围整章由 __fill_scope 重建）
            new_full_version = (product.full_version or "").strip()
            if new_full_version:
                def _update_version(node):
                    if self.__strip_title(node.get("title")) == "范围":
                        pass
                    elif node.get("body") and "完整版本" in str(node.get("body")):
                        node["body"] = re.sub(r"完整版本：[^\n]*", f"完整版本：{new_full_version}", str(node["body"]))
                    for c in (node.get("children") or []):
                        _update_version(c)
                for s in (content.get("sections") or []):
                    _update_version(s)
        self.__fill_scope(content, product)
        self.__fill_revision(content, prod_id, version, force=force)
        self.__fill_runtime_env(content, prod_id, force=force)
        serv_review_util.ensure_review(
            content, DOC_KEY,
            serv_review_util.review_date(prod_id, serv_review_util.REVIEW_DEFS.get(DOC_KEY, {}).get("name_keywords", [DOC_NAME])) if prod_id else "",
            prod_id,
        )
        serv_review_util.fill_cover_dates(content, serv_review_util.cover_date(prod_id, DOC_KEY) if prod_id else "", force=force)
        serv_review_util.fill_cover_signers(content, serv_review_util.cover_signers(prod_id, DOC_KEY) if prod_id else {}, force=force)
        return content

    def __to_obj(self, row: FtrDoc, product: Product = None):
        obj = FtrDocObj(**row.dict())
        obj.content = self.__autofill(self.__normalize_content(obj.content), row.product_id, product, row.version)
        if not (obj.file_no or "").strip():
            obj.file_no = self.__dhf_file_no(row.product_id)
        if product:
            obj.product_name = product.name
            obj.product_version = product.full_version
            obj.product_full_version = product.full_version
            obj.product_type_code = product.type_code
        obj.file_no = sync_file_no_version(obj.file_no or "", getattr(row, "version", None) or "") or obj.file_no
        return obj

    async def add_ftr_doc(self, form: FtrDocForm):
        try:
            sql = select(func.count(FtrDoc.id)).where(FtrDoc.product_id == form.product_id, FtrDoc.version == form.version)
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = FtrDoc(**form.dict(exclude_none=True))
            row.id = None
            row.content = self.__normalize_content(row.content)
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=FtrDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def duplicate_ftr_doc(self, id: int, product_id: int = None):
        try:
            fromdoc: FtrDoc = db.session.execute(select(FtrDoc).where(FtrDoc.id == id)).scalars().first()
            if not fromdoc:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            target_pid = product_id or fromdoc.product_id
            all_versions = db.session.execute(select(FtrDoc.version).where(FtrDoc.product_id == target_pid)).scalars().all()
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
            newdoc = FtrDoc(
                product_id=target_pid, version=version,
                file_no=sync_file_no_version((fromdoc.file_no or "").strip() or self.__dhf_file_no(target_pid), version) or None,
                change_log=fromdoc.change_log,
                content=copy.deepcopy(self.__normalize_content(fromdoc.content)),
            )
            db.session.add(newdoc)
            db.session.commit()
            if target_pid != fromdoc.product_id:
                await self.rebind_product(newdoc.id, target_pid)
            return Resp.resp_ok(data=FtrDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_ftr_doc(self, form: FtrDocForm):
        try:
            row: FtrDoc = db.session.execute(select(FtrDoc).where(FtrDoc.id == form.id)).scalars().first()
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
            row: FtrDoc = db.session.execute(select(FtrDoc).where(FtrDoc.id == id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            product: Product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            if not product:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            db.session.execute(delete(FtrDoc).where(FtrDoc.product_id == product_id, FtrDoc.version == row.version, FtrDoc.id != id))
            content = copy.deepcopy(DEFAULT_FTR_CONTENT) if isinstance(DEFAULT_FTR_CONTENT, dict) else {"sections": []}
            new_full_version = (product.full_version or "").strip()
            def update_version(node):
                if node.get("body") and "完整版本" in str(node.get("body")):
                    node["body"] = re.sub(r"完整版本：[^\n]*", f"完整版本：{new_full_version}", str(node["body"]))
                if node.get("body") and re.search(r"\d+\.\d+\.\d+\.\d+", str(node.get("body"))):
                    node["body"] = re.sub(r"\d+\.\d+\.\d+\.\d+", new_full_version, str(node["body"]))
                for c in (node.get("children") or []):
                    update_version(c)
            for s in (content.get("sections") or []):
                update_version(s)
            row.product_id = product_id
            content = self.__autofill(content, product_id, product, row.version, force=True)
            row.content = content
            db.session.commit()
            return Resp.resp_ok(data=self.__to_obj(row, product))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_ftr_doc(self, id: int):
        db.session.execute(delete(FtrDoc).where(FtrDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def get_ftr_doc(self, id: int):
        sql = select(FtrDoc, Product).join(Product, FtrDoc.product_id == Product.id).where(FtrDoc.id == id)
        row = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        return Resp.resp_ok(data=self.__to_obj(doc, product))

    async def list_ftr_doc(self, op_user: UserObj = None, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if product_id:
            wheres.append(FtrDoc.product_id == product_id)
        if version:
            wheres.append(FtrDoc.version.like(f"%{version}%"))
        if op_user and op_user.id != 1 and op_user.role_code == Roles.product_manager.value.code:
            wheres.append(Product.create_user_id == op_user.id)
        sql_total = select(func.count(FtrDoc.id)).join(Product, FtrDoc.product_id == Product.id).where(*wheres)
        total = db.session.execute(sql_total).scalar() or 0
        sql = (select(FtrDoc, Product).join(Product, FtrDoc.product_id == Product.id).where(*wheres)
               .order_by(FtrDoc.id.desc()).offset(page_index * page_size).limit(page_size))
        rows: List[FtrDocObj] = [self.__to_obj(doc, product) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    async def export_ftr_doc(self, output, id: int):
        resp = await self.get_ftr_doc(id)
        obj: FtrDocObj = resp.data
        if obj is None:
            Document().save(output)
            output.seek(0)
            return
        content = obj.content if isinstance(obj.content, dict) else self.__normalize_content(obj.content)
        sections = content.get("sections") or []

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

        def strip_num(title):
            return re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(title or "")).strip()

        cover = next((s for s in sections if s.get("ref_type") == "cover"), None)
        revision = next((s for s in sections if s.get("ref_type") == "revision"), None)
        body = [s for s in sections if s.get("ref_type") not in ("cover", "revision")]

        def add_blank_lines(n):
            for _ in range(max(0, int(n or 0))):
                document.add_paragraph("")

        def write_center_title(text, size=22.0, bold=False):
            p = document.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            docx_util.fonted_txt(p, str(text or ""), font_size=size, bold=bold)

        def add_text(text):
            docx_util.save_txt2docx(str(text or ""), document)

        def clear_cell_shading(cell):
            tcpr = cell._tc.get_or_add_tcPr()
            for shd in list(tcpr.findall(qn("w:shd"))):
                tcpr.remove(shd)

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT, valign=WD_CELL_VERTICAL_ALIGNMENT.CENTER):
            s = str(text or "")
            cell.text = ""
            for i, line in enumerate(s.split("\n")):
                para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
                para.alignment = align
                para.paragraph_format.line_spacing = 1.3
                docx_util.fonted_txt(para, line, font_size=10.5, bold=bold)
            cell.vertical_alignment = valign
            clear_cell_shading(cell)

        def is_case_table(grid):
            """功能测试用例表：首格为「序号」，无 Word 表头行/背景色，标签列加粗（与编辑页一致）。"""
            if not grid:
                return False
            return str((grid[0] or [""])[0] or "").strip() == "序号"

        def case_cell_bold(row, c_idx):
            lab = str((row[0] if row else "") or "").strip()
            if lab == "执行步骤":
                return True
            if lab in ("序号", "用例标题", "功能描述", "系统设置") and c_idx == 0:
                return True
            return False

        def add_grid(grid):
            grid = [row for row in (grid or []) if isinstance(row, list)]
            cols = max((len(row) for row in grid), default=0)
            if cols <= 0:
                return
            table = document.add_table(rows=0, cols=cols)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            case = is_case_table(grid)
            valign = WD_CELL_VERTICAL_ALIGNMENT.TOP if case else WD_CELL_VERTICAL_ALIGNMENT.CENTER
            for r_idx, row in enumerate(grid):
                cells = table.add_row().cells
                for c_idx in range(cols):
                    text = row[c_idx] if c_idx < len(row) else ""
                    if case:
                        bold = case_cell_bold(row, c_idx)
                    else:
                        bold = (r_idx == 0)
                    set_cell(cells[c_idx], text, bold=bold, valign=valign)
            document.add_paragraph()

        def add_cover_grid(grid):
            grid = [row for row in (grid or []) if isinstance(row, list)]
            cols = max((len(row) for row in grid), default=0)
            if cols <= 0:
                return
            table = document.add_table(rows=0, cols=cols)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            for row in grid:
                cells = table.add_row().cells
                for c_idx in range(cols):
                    text = row[c_idx] if c_idx < len(row) else ""
                    set_cell(cells[c_idx], text, bold=(c_idx % 2 == 0), align=WD_ALIGN_PARAGRAPH.CENTER)
            document.add_paragraph()

        def add_body_heading(title, level):
            size = {1: 16.0, 2: 14.0, 3: 12.0}.get(level, 11.0)
            p = document.add_heading("", level=max(1, min(level, 9)))
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.first_line_indent = Pt(0)
            p.paragraph_format.left_indent = Pt(0)
            p.paragraph_format.line_spacing = 1.5
            docx_util.fonted_txt(p, title, font_size=size, bold=True)

        def clean_export_text(text):
            """去掉编辑页静默占位，避免 Word 露出 {{TBL}}/{{TXT}} 等。"""
            lines = []
            for ln in str(text or "").split("\n"):
                s = ln.strip()
                if s in ("{{TBL}}", "{{IMG}}", "{{EMPTY}}", "{{TXT}}"):
                    continue
                lines.append(ln)
            return "\n".join(lines).strip()

        def render_body_section(node, level, number="", numbered=True):
            name = strip_num(node.get("title"))
            heading = f"{number} {name}".strip() if number else name
            if heading:
                add_body_heading(heading, level=max(1, min(level, 9)))
            body_text = str(node.get("body") or "")
            tables = node.get("tables") or []
            images = [x for x in (node.get("images") or []) if isinstance(x, str) and str(x).strip()]
            caps = node.get("table_captions") or []

            def _emit_table(t_idx):
                if t_idx < 0 or t_idx >= len(tables):
                    return
                cap = caps[t_idx] if t_idx < len(caps) else ""
                if str(cap or "").strip():
                    add_text(cap)
                add_grid(tables[t_idx])

            # 与编辑页交错一致：{{TBL}}/见下表/表N 切分；静默占位不写入正文
            has_tbl_ph = "{{TBL}}" in body_text
            if has_free_body_markers(body_text) or images:
                state = {"i": 0}

                def add_marked_table(_grid):
                    i = state["i"]
                    state["i"] += 1
                    _emit_table(i)

                emit_free_body(
                    body_text, tables, images, add_text, add_marked_table,
                    lambda url, caption="": write_body_image(document, url, caption, add_text),
                )
            elif (has_tbl_ph or ("见下表" in body_text) or re.search(r"(?m)^表\s*\d", body_text)) and tables:
                lines = body_text.split("\n")
                buf = []
                tbl_idx = 0

                def flush_text():
                    t = clean_export_text("\n".join(buf))
                    if t:
                        add_text(t)
                    buf.clear()

                for ln in lines:
                    s = ln.strip()
                    if (s == "{{TBL}}" or s in ("见下表", "如下表", "下表") or re.match(r"^表\s*\d", s)) and tbl_idx < len(tables):
                        flush_text()
                        _emit_table(tbl_idx)
                        tbl_idx += 1
                    elif s in ("{{TBL}}", "{{IMG}}", "{{EMPTY}}", "{{TXT}}"):
                        continue
                    else:
                        buf.append(ln)
                flush_text()
                for i in range(tbl_idx, len(tables)):
                    _emit_table(i)
            else:
                cleaned = clean_export_text(body_text)
                if cleaned:
                    add_text(cleaned)
                for t_idx, _table in enumerate(tables):
                    _emit_table(t_idx)
            if str(node.get("body_tail") or "").strip():
                add_text(clean_export_text(node.get("body_tail")))
            idx = 0
            for child in (node.get("children") or []):
                idx += 1
                if numbered and number:
                    child_num = f"{number}.{idx}"
                elif numbered:
                    child_num = str(idx)
                else:
                    child_num = ""
                render_body_section(child, level + 1, child_num, numbered=numbered)

        add_blank_lines(6)
        write_center_title((strip_num(cover.get("title")) if cover else "") or DOC_NAME, size=22.0, bold=True)
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
        seq = 0
        for node in body:
            seq += 1
            render_body_section(node, 1, str(seq), numbered=True)

        docx_util.fill_toc_cache(document)
        document.save(output)
        output.seek(0)