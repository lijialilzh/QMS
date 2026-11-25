#!/usr/bin/env python
# encoding: utf-8

# 质量文件服务。详见 docs/function_docs/105_质量文件管理.md。

import logging
import copy
from typing import List

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from sqlalchemy import delete, func, select

from ..model.product import Product
from ..model.qa_doc import QaDoc
from ..obj import Page, Resp
from ..obj.tobj_qa_doc import QaDocForm
from ..obj.vobj_qa_doc import QaDocObj
from ..obj.vobj_user import UserObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from .qa_doc_templates import (
    KINDS, apply_inspect_autofill, build_content, ensure_output_review, ensure_word_form, output_review_content,
)
from .serv_product import product_scope_filter
from .serv_utils import docx_util

logger = logging.getLogger(__name__)

_HEADER_MARKS = ("测试目的", "修改日期", "配置", "内容", "型号", "是否检验", "评审内容", "序号")


def _write_text(paragraph, text, size=10.5, bold=False):
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(0)
    docx_util.fonted_txt(paragraph, text, font_size=size, bold=bold)


def _fill_cell(cell, text, bold=False):
    lines = str(text or "").split("\n")
    cell.text = ""
    paragraph = cell.paragraphs[0]
    _write_text(paragraph, lines[0], bold=bold)
    for line in lines[1:]:
        extra = cell.add_paragraph()
        _write_text(extra, line, bold=bold)
    tc_pr = cell._tc.get_or_add_tcPr()
    for old in tc_pr.findall(qn("w:vAlign")):
        tc_pr.remove(old)
    align = OxmlElement("w:vAlign")
    align.set(qn("w:val"), "center")
    tc_pr.append(align)


def _set_table_width(grid):
    tbl_pr = grid._tbl.tblPr
    width = tbl_pr.find(qn("w:tblW"))
    if width is None:
        width = OxmlElement("w:tblW")
        tbl_pr.append(width)
    width.set(qn("w:w"), "5000")
    width.set(qn("w:type"), "pct")
    jc = tbl_pr.find(qn("w:jc"))
    if jc is None:
        jc = OxmlElement("w:jc")
        tbl_pr.append(jc)
    jc.set(qn("w:val"), "center")


def _set_col_widths(grid, weights):
    total = sum(weights) or 1
    cols = grid._tbl.find(qn("w:tblGrid"))
    if cols is None:
        return
    for col, weight in zip(cols.findall(qn("w:gridCol")), weights):
        col.set(qn("w:w"), str(int(9600 * weight / total)))


def _width_weights(header):
    first = header[0] if header else ""
    if "测试目的" in first and len(header) == 4:
        return [56, 7, 18, 19]
    if first == "修改日期" and len(header) == 5:
        return [16, 13, 39, 15, 16]
    if first == "使用部门" and len(header) == 4:
        return [21, 30, 20, 29]
    if len(header) == 2:
        return [20, 80]
    return [1] * len(header)


def _cell_text(value):
    text = str(value or "")
    return "" if text in ("<", "^") else text


def _write_merged_table(document, table):
    """按 < 向左合并、^ 向上合并，写出和 Word 模版一致的表格。"""
    rows = [[str(cell if cell is not None else "") for cell in row] for row in table if isinstance(row, list)]
    if not rows:
        return
    cols = max(len(row) for row in rows)
    for row in rows:
        while len(row) < cols:
            row.append("")
    grid = document.add_table(rows=len(rows), cols=cols)
    grid.style = "Table Grid"
    _set_table_width(grid)
    for r_idx, cells in enumerate(rows):
        for c_idx in range(cols):
            _fill_cell(grid.cell(r_idx, c_idx), _cell_text(cells[c_idx]), bold=(r_idx == 0 and "<" not in cells and "^" not in cells))
    for r_idx, cells in enumerate(rows):
        c_idx = 0
        while c_idx < cols:
            if cells[c_idx] in ("<", "^"):
                c_idx += 1
                continue
            end = c_idx
            while end + 1 < cols and cells[end + 1] == "<":
                end += 1
            if end > c_idx:
                grid.cell(r_idx, c_idx).merge(grid.cell(r_idx, end))
            c_idx = end + 1
    for c_idx in range(cols):
        r_idx = 0
        while r_idx < len(rows):
            if rows[r_idx][c_idx] in ("<", "^"):
                r_idx += 1
                continue
            end = r_idx
            while end + 1 < len(rows) and rows[end + 1][c_idx] == "^":
                end += 1
            if end > r_idx:
                grid.cell(r_idx, c_idx).merge(grid.cell(end, c_idx))
            r_idx = end + 1


def _write_table(document, table):
    rows = [row for row in table if isinstance(row, list)]
    if not rows:
        return
    if any(cell in ("<", "^") for row in rows for cell in row):
        _write_merged_table(document, rows)
        return
    cols = max(len(row) for row in rows)
    grid = document.add_table(rows=len(rows), cols=cols)
    grid.style = "Table Grid"
    _set_table_width(grid)
    header = [str(cell or "") for cell in rows[0]]
    _set_col_widths(grid, _width_weights(header))
    head_row = any(mark in "".join(header) for mark in _HEADER_MARKS)
    for r_idx, cells in enumerate(rows):
        for c_idx in range(cols):
            text = cells[c_idx] if c_idx < len(cells) else ""
            _fill_cell(grid.cell(r_idx, c_idx), text, bold=head_row and r_idx == 0)
    if rows[0] and str(rows[0][0] or "").strip() != "生效日期":
        for r_idx, cells in enumerate(rows):
            if str(cells[0] if cells else "").strip() == "生效日期" and cols > 2:
                grid.cell(r_idx, 1).merge(grid.cell(r_idx, cols - 1))
                _fill_cell(grid.cell(r_idx, 1), cells[1] if len(cells) > 1 else "")
    for c_idx, name in enumerate(header):
        if "判定标准" not in name and "检验方法" not in name:
            continue
        values = [str(cells[c_idx] if c_idx < len(cells) else "") or "" for cells in rows[1:]]
        if len(values) < 2 or not values[0] or any(item != values[0] for item in values):
            continue
        top = grid.cell(1, c_idx)
        top.merge(grid.cell(len(rows) - 1, c_idx))
        _fill_cell(top, values[0])


# 文档名称和 DHF 清单名称不一致时，按清单里的名称取编号。
_DHF_NAMES = {
    "output_review": ["设计开发输出评审", "评审记录（设计开发输出）", "评审记录(设计开发输出)"],
}


def resolved_file_no(doc) -> str:
    """文件编号优先用单据上填写的；没填时按文档名称从产品 DHF 取。"""
    current = str(getattr(doc, "file_no", None) or "").strip()
    if current:
        return current
    kind = str(getattr(doc, "kind", None) or "")
    title = KINDS.get(kind, "")
    prod_id = getattr(doc, "product_id", None)
    names = _DHF_NAMES.get(kind) or ([title] if title else [])
    if not names or not prod_id:
        return ""
    from .serv_review_util import dhf_file_no
    return dhf_file_no(prod_id, names) or ""


class Server(object):
    def __to_obj(self, doc: QaDoc, product: Product) -> QaDocObj:
        data = doc.dict()
        content = copy.deepcopy(doc.content or {})
        if doc.kind == "output_review":
            content = ensure_output_review(content, product, doc.version)
        elif doc.kind in ("inspect_record", "change_close"):
            content = ensure_word_form(content, product, doc.version, doc.kind)
        else:
            content = apply_inspect_autofill(content, product, doc.version, doc.kind)
        data["content"] = content
        data["kind_name"] = KINDS.get(doc.kind, doc.kind)
        data["product_name"] = product.name
        data["product_version"] = product.release_version
        data["product_full_version"] = product.full_version
        data["product_type_code"] = product.type_code
        data["file_no"] = resolved_file_no(doc) or data.get("file_no")
        return QaDocObj(**data)

    def __load(self, id: int):
        sql = select(QaDoc, Product).join(Product, QaDoc.product_id == Product.id).where(QaDoc.id == id)
        return db.session.execute(sql).first()

    async def add_qa_doc(self, form: QaDocForm):
        try:
            if form.kind not in KINDS:
                return Resp.resp_err(msg="未知文档类型")
            sql = select(func.count(QaDoc.id)).where(
                QaDoc.product_id == form.product_id,
                QaDoc.kind == form.kind,
                QaDoc.version == form.version,
            )
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            product = db.session.execute(select(Product).where(Product.id == form.product_id)).scalars().first()
            if not product:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            row = QaDoc(
                product_id=form.product_id,
                kind=form.kind,
                version=form.version,
                file_no=(form.file_no or "").strip() or None,
                change_log=form.change_log,
                content=build_content(form.kind, product, form.version),
            )
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=QaDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_qa_doc(self, form: QaDocForm):
        try:
            row: QaDoc = db.session.execute(select(QaDoc).where(QaDoc.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict(exclude_none=True).items():
                if key in ("id", "kind", "product_id"):
                    continue
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def rebind_product(self, id: int, product_id: int):
        try:
            row: QaDoc = db.session.execute(select(QaDoc).where(QaDoc.id == id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            if not product:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            clash = db.session.execute(select(func.count(QaDoc.id)).where(
                QaDoc.product_id == product_id,
                QaDoc.kind == row.kind,
                QaDoc.version == row.version,
                QaDoc.id != row.id,
            )).scalar()
            if clash:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row.product_id = product_id
            if row.kind == "output_review":
                content = output_review_content(product, row.version)
            elif row.kind in ("inspect_record", "change_close"):
                content = ensure_word_form({}, product, row.version, row.kind)
            else:
                content = copy.deepcopy(row.content or {"sections": []})
                if row.kind in ("inspect_spec", "inspect_record"):
                    content = apply_inspect_autofill(content, product, row.version, row.kind)
                else:
                    from .qa_doc_templates import _apply_product
                    content = _apply_product(content, product)
            row.content = content
            db.session.commit()
            return Resp.resp_ok(data=self.__to_obj(row, product))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_qa_doc(self, id: int):
        db.session.execute(delete(QaDoc).where(QaDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def get_qa_doc(self, id: int):
        row = self.__load(id)
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        return Resp.resp_ok(data=self.__to_obj(doc, product))

    async def list_qa_doc(self, op_user: UserObj = None, kind: str = None, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if kind:
            wheres.append(QaDoc.kind == kind)
        if product_id:
            wheres.append(QaDoc.product_id == product_id)
        if version:
            wheres.append(QaDoc.version.like(f"%{version}%"))
        scope = product_scope_filter(op_user)
        if scope is not None:
            wheres.append(scope)
        sql_total = select(func.count(QaDoc.id)).join(Product, QaDoc.product_id == Product.id).where(*wheres)
        total = db.session.execute(sql_total).scalar() or 0
        sql = (
            select(QaDoc, Product)
            .join(Product, QaDoc.product_id == Product.id)
            .where(*wheres)
            .order_by(QaDoc.id.desc())
            .offset(page_index * page_size)
            .limit(page_size)
        )
        rows: List[QaDocObj] = [self.__to_obj(doc, product) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    async def export_qa_doc(self, output, id: int):
        row = self.__load(id)
        document = Document()
        section = document.sections[0]
        section.page_width = Cm(21.0)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2.0)
        section.bottom_margin = Cm(2.0)
        section.left_margin = Cm(2.0)
        section.right_margin = Cm(2.0)
        section.header_distance = Cm(1.5)
        if not row:
            document.save(output)
            output.seek(0)
            return
        doc, product = row
        file_no = resolved_file_no(doc)
        raw = copy.deepcopy(doc.content or {})
        if doc.kind == "output_review":
            filled = ensure_output_review(raw, product, doc.version)
        elif doc.kind in ("inspect_record", "change_close"):
            filled = ensure_word_form(raw, product, doc.version, doc.kind)
        else:
            filled = apply_inspect_autofill(raw, product, doc.version, doc.kind)
        docx_util.enable_update_fields_on_open(document)
        header = section.header.paragraphs[0]
        header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        _write_text(header, file_no, bold=True)
        docx_util.add_page_number_footer(section, file_no)
        doc_title = KINDS.get(doc.kind, "")
        sections = (filled or {}).get("sections") or []
        cover = next((item for item in sections if str(item.get("title") or "").strip() == doc_title), None)
        revision = next((item for item in sections if str(item.get("title") or "").strip() == "文件修订记录"), None)
        body = [item for item in sections if item is not cover and item is not revision]

        def blank_lines(count):
            for _ in range(count):
                document.add_paragraph("")

        def center_title(text, size):
            para = document.add_paragraph()
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            para.paragraph_format.line_spacing = 1.5
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.space_after = Pt(0)
            docx_util.fonted_txt(para, text, font_size=size, bold=True)

        def write_tables(node):
            for table in node.get("tables") or []:
                _write_table(document, table)

        def write_body(node, number, level=1):
            name = str(node.get("title") or "").strip()
            if name:
                heading = f"{number} {name}".strip() if number else name
                para = document.add_heading("", level=max(1, min(level, 9)))
                para.alignment = WD_ALIGN_PARAGRAPH.LEFT
                para.paragraph_format.first_line_indent = Pt(0)
                para.paragraph_format.line_spacing = 1.5
                para.paragraph_format.space_before = Pt(0)
                para.paragraph_format.space_after = Pt(0)
                docx_util.fonted_txt(para, heading, font_size=16 if level == 1 else 14, bold=True)
            if str(node.get("body") or "").strip():
                docx_util.save_txt2docx(str(node.get("body") or ""), document)
            write_tables(node)
            for index, child in enumerate(node.get("children") or [], 1):
                child_num = f"{number}.{index}" if number else str(index)
                write_body(child, child_num, level + 1)

        if doc.kind == "output_review":
            from .serv_review_util import render_review_grid

            def review_cell(cell, text, bold=False, align=None):
                _fill_cell(cell, text, bold=bold)
                if align is not None:
                    for para in cell.paragraphs:
                        para.alignment = align

            center_title(doc_title, 18)
            for node in sections:
                for table in node.get("tables") or []:
                    render_review_grid(document, table, review_cell)
            document.save(output)
            output.seek(0)
            return

        if doc.kind in ("inspect_record", "change_close"):
            center_title(doc_title, 18)
            for node in sections:
                for table in node.get("tables") or []:
                    _write_table(document, table)
            document.save(output)
            output.seek(0)
            return

        blank_lines(6)
        center_title(doc_title, 22)
        blank_lines(4)
        if cover:
            if str(cover.get("body") or "").strip():
                docx_util.save_txt2docx(str(cover.get("body") or ""), document)
            write_tables(cover)
        if revision:
            document.add_page_break()
            center_title("文件修订记录", 14)
            blank_lines(2)
            write_tables(revision)
        document.add_page_break()
        center_title("目录", 16)
        docx_util.insert_toc_field(document)
        document.add_page_break()
        for index, node in enumerate(body, 1):
            write_body(node, str(index))
        docx_util.fill_toc_cache(document)
        document.save(output)
        output.seek(0)
        docx_util.refresh_docx_toc_with_libreoffice(output)
