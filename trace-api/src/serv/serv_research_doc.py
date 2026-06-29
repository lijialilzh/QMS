#!/usr/bin/env python
# encoding: utf-8

# 自研软件研究报告服务层。
# 默认内容来自 src-res/research_default_content.json（章节树+表格+内置流程图）。
# 自动获取章节通过节点 ref_type / img_category 标记，在 get/export/预览时注入产品数据；
# 数据源：Product/CompanyInfo（软件标识）、Product.overall_desc（总体描述）、PtrDoc 2.1功能、
#         SrsDoc 2.3章节、ProdRuntimeEnv（运行环境）、ProjectTimeline（发布日期）、DocFile（产品图）。

import base64
import copy
import io
import json
import logging
import os
import re
from typing import List

from sqlalchemy import func, select, delete
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT

from ..model.product import Product
from ..model.company_info import CompanyInfo
from ..model.research_doc import ResearchDoc
from ..model.ptr_doc import PtrDoc
from ..model.srs_doc import SrsDoc, SrsNode
from ..model.prod_runtime_env import ProdRuntimeEnv
from ..model.doc_file import DocFile
from ..model.project_timeline import ProjectTimelineRow, ProjectTimelineCell
from ..obj import Page, Resp
from ..obj.tobj_role import Roles
from ..obj.vobj_user import UserObj
from ..obj.tobj_research_doc import ResearchDocForm
from ..obj.vobj_research_doc import ResearchDocObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from .serv_utils import new_version, docx_util
from .serv_prod_runtime_env import DEFAULT_RUNTIME_ENV

logger = logging.getLogger(__name__)

# 取发布日期时的时间线关键字（命中项取最新日期）
DATE_KEYWORDS = ["自研软件研究报告", "软件研究报告", "软件发布", "发布"]

DEFAULT_RESEARCH_CONTENT = {"productName": "", "sections": []}

_DEFAULT_CONTENT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "src-res", "research_default_content.json"
)
try:
    with open(_DEFAULT_CONTENT_FILE, encoding="utf-8") as _f:
        _loaded = json.load(_f)
    if isinstance(_loaded, dict) and isinstance(_loaded.get("sections"), list) and _loaded["sections"]:
        DEFAULT_RESEARCH_CONTENT = _loaded
except Exception:
    logger.exception("加载自研软件研究报告默认内容资源失败")


class Server(object):
    # ---------------- 内容归一 ----------------
    def __normalize_content(self, content):
        result = copy.deepcopy(DEFAULT_RESEARCH_CONTENT)
        if isinstance(content, dict):
            result.update(content)
        result.setdefault("sections", copy.deepcopy(DEFAULT_RESEARCH_CONTENT.get("sections", [])))
        result.setdefault("productName", "")
        return result

    # ---------------- 自动获取数据源 ----------------
    def __latest_doc(self, model, product_id):
        # 排除软删除（版本号以 __deleted 前缀标记）的文档，取最新一版
        return db.session.execute(
            select(model)
            .where(model.product_id == product_id, ~model.version.like("__deleted%"))
            .order_by(model.id.desc())
        ).scalars().first()

    def __strip_name(self, title):
        return re.sub(r"^[0-9．.、\s]+", "", str(title or "")).strip()

    def __node_outline(self, node, depth, lines):
        # 将一个节点（含其全部子孙）按「标题 + 正文」逐行展开；depth==0 的根节点只取正文不重复标题
        title = self.__strip_name(node.get("title"))
        body = str(node.get("body") or "").strip()
        if depth >= 1 and title:
            lines.append(title)
        if body:
            lines.append(body)
        for child in node.get("children") or []:
            self.__node_outline(child, depth + 1, lines)

    def __ptr_func_2_1(self, product_id):
        # 技术要求 2.1 功能：正文第 2 章（性能指标）下「功能」子节的完整内容（含各模块及功能点）
        doc = self.__latest_doc(PtrDoc, product_id)
        if not doc or not isinstance(doc.content, dict):
            return ""
        sections = doc.content.get("sections") or []
        body = [s for s in sections if (s.get("ref_type") not in ("cover", "appendix"))]
        target_sec = next((s for s in body if self.__strip_name(s.get("title")) == "性能指标"), None)
        if target_sec is None and len(body) >= 2:
            target_sec = body[1]
        if not target_sec:
            return ""
        children = target_sec.get("children") or []
        child = next((c for c in children if self.__strip_name(c.get("title")) == "功能"), None) or (children[0] if children else None)
        if not child:
            return ""
        lines = []
        self.__node_outline(child, 0, lines)
        return "\n".join(lines)

    def __srs_2_3(self, product_id):
        # 需求规格说明 2.3 章节完整内容：2.3 本体 + 其全部子节（2.3.1/2.3.2…体系结构各模块功能与用途）
        doc = self.__latest_doc(SrsDoc, product_id)
        if not doc:
            return ""
        nodes = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == doc.id).order_by(SrsNode.priority, SrsNode.n_id)
        ).scalars().all()

        def num_of(n):
            matched = re.match(r"^(\d+(?:\.\d+)*)", str(n.title or "").strip())
            return matched.group(1) if matched else ""

        picked = []
        for n in nodes:
            num = num_of(n)
            if num == "2.3" or num.startswith("2.3."):
                picked.append((num, n))
        picked.sort(key=lambda it: [int(p) for p in it[0].split(".")])

        lines = []
        for num, n in picked:
            title = self.__strip_name(n.title)
            text = str(n.text or "").strip()
            if num == "2.3":
                if text:
                    lines.append(text)
            else:
                if title:
                    lines.append(title)
                if text:
                    lines.append(text)
        return "\n".join(lines)

    def __runtime_env(self, product_id):
        row = db.session.execute(select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == product_id)).scalars().first()
        env = dict(DEFAULT_RUNTIME_ENV)
        if row:
            for key in DEFAULT_RUNTIME_ENV.keys():
                val = getattr(row, key, None)
                if val is not None and str(val).strip():
                    env[key] = val
        return env

    def __release_date(self, product_id):
        rows = db.session.execute(
            select(ProjectTimelineRow).where(ProjectTimelineRow.prod_id == product_id)
        ).scalars().all()
        if not rows:
            return ""
        cells = db.session.execute(
            select(ProjectTimelineCell).where(ProjectTimelineCell.row_id.in_([r.id for r in rows]))
        ).scalars().all()
        cell_map = {}
        for c in cells:
            cell_map.setdefault(c.row_id, []).append(str(c.output_result or ""))

        def to_int(v):
            try:
                return int(str(v).strip())
            except Exception:
                return None

        hits = []
        for r in rows:
            if str(getattr(r, "row_type", "")) != "date":
                continue
            y, m, d = to_int(r.year), to_int(r.month), to_int(r.day)
            if y is None or m is None:
                continue
            texts = cell_map.get(r.id, [])
            if any(k in t for k in DATE_KEYWORDS for t in texts):
                hits.append((y, m, d or 1, r))
        if not hits:
            return ""
        y, m, d, _ = max(hits, key=lambda x: x[0] * 10000 + x[1] * 100 + x[2])
        return f"{y}年{m}月{d}日"

    def __doc_file_url(self, product_id, category):
        row = db.session.execute(
            select(DocFile).where(DocFile.product_id == product_id, DocFile.category == category).order_by(DocFile.id)
        ).scalars().first()
        return (row.file_url or "") if row else ""

    def __collect_autofill(self, product_id):
        product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
        if not product:
            return None
        company = None
        if product.registrant:
            company = db.session.execute(
                select(CompanyInfo).where(CompanyInfo.registrant == product.registrant)
            ).scalars().first()
        company_name = (product.registrant or (company.registrant if company else "") or "").strip()
        address = (company.address if company else "") or ""
        env = self.__runtime_env(product_id)
        release_date = self.__release_date(product_id)

        sw_ident_text = (
            f"产品名称：{product.name or ''}\n"
            f"软件发布版本: {product.release_version or ''}\n"
            f"注册申请人：{company_name}\n"
            f"设计开发地址：{address}\n"
            f"现成软件的标识信息详见1.3.2.1章节组件信息。"
        )
        update_text = (
            f"本软件当前发布版本{product.release_version or ''}，完整版本为{product.full_version or ''}，"
            f"发布日期是{release_date or ''}，版本命名规则和更新历史详见提交文件《版本更新历史》。"
        )
        return {
            "sw_ident_text": sw_ident_text,
            "overall_desc": (product.overall_desc or "").strip(),
            "ptr_2_1": self.__ptr_func_2_1(product_id),
            "srs_2_3": self.__srs_2_3(product_id),
            "update_text": update_text,
            "runtime": env,
            "images": {
                "img_ui": self.__doc_file_url(product_id, "img_ui"),
                "img_struct": self.__doc_file_url(product_id, "img_struct"),
                "img_home": self.__doc_file_url(product_id, "img_home"),
                "img_topo": self.__doc_file_url(product_id, "img_topo"),
            },
        }

    def __runtime_tables(self, kind, env):
        if kind == "rt_hw":
            return [
                [["配置", "要求"], ["CPU", env.get("srv_cpu", "")], ["内存", env.get("srv_memory", "")],
                 ["GPU", env.get("srv_gpu", "")], ["硬盘", env.get("srv_disk", "")], ["网卡", env.get("srv_nic", "")]],
                [["配置", "要求"], ["CPU", env.get("cli_cpu", "")], ["内存", env.get("cli_memory", "")],
                 ["显示器分辨率", env.get("cli_resolution", "")]],
            ]
        if kind == "rt_sw":
            return [
                [["类别", "操作系统", "其他"],
                 ["服务器", env.get("srv_os", ""), f"CUDA {env.get('srv_cuda', '')}"],
                 ["用户端", env.get("cli_os", ""), f"浏览器 {env.get('cli_browser', '')}"]],
            ]
        if kind == "rt_net":
            return [
                [["网络", "要求"], ["架构", env.get("arch", "")],
                 ["局域网", env.get("net_lan", "")], ["广域网", env.get("net_wan", "")]],
            ]
        return []

    def __apply_autofill(self, content, auto):
        if not auto:
            return content
        images = auto.get("images", {})

        def img_url(cat):
            url = images.get(cat, "")
            return f"/{url}" if url else ""

        def walk(nodes):
            for node in nodes or []:
                rt = node.get("ref_type")
                cat = node.get("img_category")
                if rt == "sw_ident":
                    node["text"] = auto["sw_ident_text"]
                elif rt == "func_module":
                    node["text"] = ""
                    node["images"] = []
                    overall = auto.get("overall_desc", "") or "（产品总体描述未填写，请在产品信息中维护）"
                    blocks = [{"text": overall + "\n详见图1 用户关系图。"}]
                    blocks.append({"type": "image", "url": img_url("img_ui"), "img_category": "img_ui"})
                    ptr = auto.get("ptr_2_1", "")
                    blocks.append({"text": "各功能模块的主要功能见下：\n" + ptr if ptr else "各功能模块的主要功能见下：\n（未获取到技术要求2.1功能，请先维护产品技术要求）"})
                    node["blocks"] = blocks
                elif rt == "arch_func":
                    srs = auto.get("srs_2_3", "")
                    node["text"] = ""
                    node["images"] = []
                    blocks = [{"type": "image", "url": img_url("img_struct"), "img_category": "img_struct"}]
                    blocks.append({"text": srs or "（未获取到需求规格说明2.3章节，请先维护需求规格说明）"})
                    for tbl in node.get("tables") or []:
                        blocks.append({"type": "table", "table": tbl})
                    node["blocks"] = blocks
                elif rt in ("rt_hw", "rt_sw", "rt_net"):
                    node["tables"] = self.__runtime_tables(rt, auto.get("runtime", {}))
                elif rt == "update_history":
                    node["text"] = auto["update_text"]
                elif cat:
                    url = img_url(cat)
                    node["images"] = [url] if url else []
                walk(node.get("children"))

        walk(content.get("sections"))
        return content

    # ---------------- 转换 ----------------
    def __to_obj(self, row: ResearchDoc, product: Product = None, with_autofill=True):
        obj = ResearchDocObj(**row.dict())
        content = self.__normalize_content(obj.content)
        if with_autofill:
            auto = self.__collect_autofill(row.product_id)
            content = self.__apply_autofill(content, auto)
        if product:
            content["productName"] = product.name or ""
        obj.content = content
        if product:
            obj.product_name = product.name
            obj.product_version = product.full_version
            obj.product_full_version = product.full_version
            obj.product_type_code = product.type_code
        return obj

    # ---------------- CRUD ----------------
    async def add_research_doc(self, form: ResearchDocForm):
        try:
            sql = select(func.count(ResearchDoc.id)).where(
                ResearchDoc.product_id == form.product_id, ResearchDoc.version == form.version
            )
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = ResearchDoc(**form.dict(exclude_none=True))
            row.id = None
            row.content = self.__normalize_content(row.content)
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=ResearchDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def duplicate_research_doc(self, id: int, product_id: int = None):
        try:
            fromdoc: ResearchDoc = db.session.execute(select(ResearchDoc).where(ResearchDoc.id == id)).scalars().first()
            if not fromdoc:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            target_pid = product_id or fromdoc.product_id
            all_versions = db.session.execute(select(ResearchDoc.version).where(ResearchDoc.product_id == target_pid)).scalars().all()
            existing = {v for v in all_versions if v}
            if target_pid == fromdoc.product_id:
                version = new_version(fromdoc.version)
            else:
                def _seq(v):
                    m = re.search(r"(\d+)(?!.*\d)", v or "")
                    return int(m.group(1)) if m else -1
                valid = [v for v in all_versions if v]
                version = new_version(max(valid, key=_seq)) if valid else fromdoc.version
            while version in existing:
                version = new_version(version)
            newdoc = ResearchDoc(
                product_id=target_pid, version=version, file_no=fromdoc.file_no,
                change_log=fromdoc.change_log, content=copy.deepcopy(self.__normalize_content(fromdoc.content)),
            )
            db.session.add(newdoc)
            db.session.commit()
            return Resp.resp_ok(data=ResearchDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_research_doc(self, form: ResearchDocForm):
        try:
            row: ResearchDoc = db.session.execute(select(ResearchDoc).where(ResearchDoc.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict(exclude_none=True).items():
                if key == "id":
                    continue
                if key == "content":
                    value = self.__normalize_content(value)
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_research_doc(self, id: int):
        db.session.execute(delete(ResearchDoc).where(ResearchDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def get_research_doc(self, id: int):
        sql = select(ResearchDoc, Product).join(Product, ResearchDoc.product_id == Product.id).where(ResearchDoc.id == id)
        row = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        return Resp.resp_ok(data=self.__to_obj(doc, product))

    async def list_research_doc(self, op_user: UserObj = None, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if product_id:
            wheres.append(ResearchDoc.product_id == product_id)
        if version:
            wheres.append(ResearchDoc.version.like(f"%{version}%"))
        if op_user and op_user.id != 1 and op_user.role_code == Roles.product_manager.value.code:
            wheres.append(Product.create_user_id == op_user.id)
        total = db.session.execute(
            select(func.count(ResearchDoc.id)).join(Product, ResearchDoc.product_id == Product.id).where(*wheres)
        ).scalar() or 0
        sql = (
            select(ResearchDoc, Product).join(Product, ResearchDoc.product_id == Product.id)
            .where(*wheres).order_by(ResearchDoc.id.desc()).offset(page_index * page_size).limit(page_size)
        )
        rows: List[ResearchDocObj] = [self.__to_obj(doc, product, with_autofill=False) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    async def research_autofill(self, product_id: int):
        # 新增页预览：返回应用了自动获取的默认内容
        content = self.__normalize_content(None)
        auto = self.__collect_autofill(product_id)
        content = self.__apply_autofill(content, auto)
        product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
        if product:
            content["productName"] = product.name or ""
        return Resp.resp_ok(data=content)

    # ---------------- 导出 ----------------
    async def export_research_doc(self, output, id: int):
        resp = await self.get_research_doc(id)
        obj: ResearchDocObj = resp.data
        if obj is None:
            Document().save(output)
            output.seek(0)
            return
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

        def normalized(value):
            return re.sub(r"\s+", "", str(value or ""))

        def is_cover(sec):
            return sec.get("ref_type") == "cover" or normalized(sec.get("title")) == "自研软件研究报告"

        def is_revision(sec):
            return sec.get("ref_type") == "revision" or normalized(sec.get("title")) == "文件修订记录"

        def set_cell_text(cell, text, bold=False):
            cell.text = ""
            paragraph = cell.paragraphs[0]
            paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
            paragraph.paragraph_format.line_spacing = 1.5
            docx_util.fonted_txt(paragraph, str(text or ""), font_size=10.5, bold=bold)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP

        def add_table_title(title):
            title = str(title or "").strip()
            if not title:
                return
            para = document.add_paragraph()
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            docx_util.fonted_txt(para, title, font_size=10.5, bold=True)

        def add_plain_table(rows, title=""):
            rows = rows or []
            col_count = max([len(row or []) for row in rows] or [0])
            if col_count <= 0:
                return
            add_table_title(title)
            table = document.add_table(rows=0, cols=col_count)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            for row in rows:
                cells = table.add_row().cells
                for idx in range(col_count):
                    set_cell_text(cells[idx], row[idx] if idx < len(row or []) else "", bold=(len(table.rows) == 1))
            document.add_paragraph()

        def add_image(url):
            raw = str(url or "").strip()
            if not raw:
                return
            try:
                docx_util.save_img2docx(raw, document)
            except Exception:
                logger.exception("导出研究报告图片失败")

        def add_section(sec, level=1):
            title = sec.get("title", "")
            if title and not is_cover(sec):
                docx_util.save_title2docx(title, document, level=max(1, min(level, 9)))
            blocks = sec.get("blocks")
            if isinstance(blocks, list) and blocks:
                for block in blocks:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "image":
                        add_image(block.get("url"))
                    elif block.get("type") == "table":
                        add_plain_table(block.get("table") or [], block.get("title") or "")
                    elif block.get("text"):
                        docx_util.save_txt2docx(str(block.get("text") or ""), document)
            else:
                if sec.get("text"):
                    docx_util.save_txt2docx(str(sec.get("text") or ""), document)
                for url in sec.get("images", []) or []:
                    add_image(url)
                titles = sec.get("table_titles") or []
                for idx, rows in enumerate(sec.get("tables", []) or []):
                    add_plain_table(rows, titles[idx] if idx < len(titles) else "")
            for child in sec.get("children", []) or []:
                add_section(child, level + 1)

        content = self.__normalize_content(obj.content)
        sections = content.get("sections", [])
        cover = next((s for s in sections if is_cover(s)), None)
        revision = next((s for s in sections if is_revision(s)), None)
        body = [s for s in sections if not is_cover(s) and not is_revision(s)]

        # 封面
        title_para = document.add_paragraph()
        title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        title_para.paragraph_format.line_spacing = 1.5
        docx_util.fonted_txt(title_para, "自研软件研究报告", font_size=22.0, bold=False)
        for _ in range(6):
            document.add_paragraph("")
        for rows in (cover or {}).get("tables", []) or []:
            add_plain_table(rows)
        document.add_page_break()
        # 文件修订记录
        if revision:
            docx_util.save_title2docx("文件修订记录", document, level=1)
            for rows in revision.get("tables", []) or []:
                add_plain_table(rows)
            document.add_page_break()
        # 目录
        docx_util.insert_toc_field(document, "1-4")
        document.add_page_break()
        # 正文
        for sec in body:
            add_section(sec, 1)

        document.save(output)
        output.seek(0)
