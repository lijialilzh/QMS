#!/usr/bin/env python
# encoding: utf-8

import base64
import io
import json
import logging
import os
import re
from collections import defaultdict
from datetime import datetime
from typing import List, Optional

from sqlalchemy import delete, desc, func, select
try:
    from docx import Document
    from docx.text.paragraph import Paragraph
except Exception:
    Document = None
    Paragraph = None

from ..model.doc_file import DocFile
from ..model.hld_doc import HldDoc, HldNode
from ..model.product import Product, UserProd
from ..model.sds_doc import SdsDoc
from ..obj import Page, Resp, c_ok
from ..obj.tobj_hld_doc import HldDocForm, HldNodeForm
from ..obj.tobj_srs_doc import TabHeader, Table
from ..obj.vobj_hld_doc import HldDocObj
from ..obj.vobj_user import UserObj
from ..obj.tobj_role import Roles
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from . import serv_review_util
from .serv_srs_doc import Server as ServSrsDoc
from .serv_utils import new_version, sync_file_no_version

logger = logging.getLogger(__name__)
srsdoc_serv = ServSrsDoc()


def _normalize_hld_img_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return url
    s = str(url).strip()
    if "?" not in s:
        return s
    path, _ = s.split("?", 1)
    if path.startswith("/data.trace/"):
        return path
    return s


_HLD_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
}


def _guess_hld_image_mime(path_or_name: str, fallback: str = "image/png") -> str:
    ext = os.path.splitext(str(path_or_name or ""))[1].lower()
    return _HLD_MIME_BY_EXT.get(ext, fallback)


def _bytes_to_hld_data_url(bys: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64,{base64.b64encode(bys).decode('ascii')}"


def _resolve_hld_local_img_path(url: str) -> Optional[str]:
    raw = str(url or "").strip()
    if not raw or raw.startswith("data:"):
        return None
    clean = raw.split("?", 1)[0].strip()
    if clean.startswith("/"):
        clean = clean.lstrip("/")
    candidates = [clean]
    if clean.startswith("data.trace/"):
        candidates.append(clean)
    else:
        candidates.append(os.path.join("data.trace", clean))
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def _coerce_hld_img_url_to_data(url: Optional[str]) -> Optional[str]:
    """HLD 图片统一存库：img_url 使用 data URL，兼容历史本地路径。"""
    if not url:
        return url
    s = str(url).strip()
    if s.startswith("data:image/"):
        return _normalize_hld_img_url(s)
    local_path = _resolve_hld_local_img_path(s)
    if not local_path:
        return _normalize_hld_img_url(s)
    try:
        with open(local_path, "rb") as fs:
            bys = fs.read()
        if not bys:
            return _normalize_hld_img_url(s)
        return _bytes_to_hld_data_url(bys, _guess_hld_image_mime(local_path))
    except Exception:
        logger.exception("coerce hld img url failed: %s", s)
        return _normalize_hld_img_url(s)


def _hld_table_text(table) -> str:
    data = table if isinstance(table, dict) else (table.dict() if hasattr(table, "dict") else {})
    if not data:
        return ""
    headers = data.get("headers") or []
    header_txt = " ".join(str(h.get("name") or h.get("code") or "") for h in headers if isinstance(h, dict))
    row_txt = " ".join(
        " ".join(str(v or "") for v in (row or {}).values())
        for row in (data.get("rows") or [])
        if isinstance(row, dict)
    )
    return f"{header_txt} {row_txt}"


def _is_hld_change_log_table(table) -> bool:
    txt = re.sub(r"\s+", "", _hld_table_text(table))
    keys = ["修改日期", "版本号", "修订说明", "修订人", "批准人"]
    return sum(1 for key in keys if key in txt) >= 3


def _extract_hld_revision_change_desc(nodes, doc_version: str) -> str:
    version = str(doc_version or "").strip()
    fallback = ""
    for node in nodes or []:
        table = getattr(node, "table", None)
        if not table or not _is_hld_change_log_table(table):
            continue
        data = table if isinstance(table, dict) else (table.dict() if hasattr(table, "dict") else {})
        for row in data.get("rows") or []:
            if not isinstance(row, dict):
                continue
            desc = str(row.get("change_desc") or "").strip()
            if not desc:
                continue
            row_version = str(row.get("version_no") or "").strip()
            if version and row_version == version:
                return desc
            if not fallback:
                fallback = desc
    return fallback


class Server(object):

    @staticmethod
    def _serialize_table(table):
        if not table:
            return None
        if isinstance(table, Table):
            return table.dict()
        if isinstance(table, dict):
            return table
        if isinstance(table, str):
            try:
                return json.loads(table)
            except Exception:
                return None
        if hasattr(table, "dict"):
            return table.dict()
        return table

    @staticmethod
    def _parse_table(table):
        if not table:
            return None
        if isinstance(table, Table):
            return table
        if isinstance(table, str):
            return Table.parse_raw(table)
        if isinstance(table, dict):
            return Table.parse_obj(table)
        return None

    @staticmethod
    def _reset_tree_node_ids(nodes: List[HldNodeForm]):
        for node in nodes or []:
            node.n_id = 0
            Server._reset_tree_node_ids(getattr(node, "children", None) or [])

    def _update_nodes(self, doc: HldDoc, p_id, nodes: List[HldNodeForm]):
        for idx, node in enumerate(nodes or []):
            sql = select(HldNode).where(HldNode.doc_id == doc.id, HldNode.n_id == node.n_id) if node.n_id else None
            row = db.session.execute(sql).scalars().first() if sql is not None else None
            if not row:
                doc.n_id += 1
                table = self._serialize_table(node.table)
                row = HldNode(
                    doc_id=doc.id,
                    n_id=doc.n_id,
                    p_id=p_id,
                    priority=idx,
                    title=node.title,
                    label=node.label,
                    img_url=_normalize_hld_img_url(node.img_url),
                    text=node.text,
                    ref_type=node.ref_type,
                    table=table,
                )
                db.session.add(row)
                node.n_id = doc.n_id
            else:
                row.p_id = p_id
                for key, value in node.dict().items():
                    if key in ("doc_id", "n_id", "p_id", "children") or value is None:
                        continue
                    if key == "table":
                        value = self._serialize_table(value)
                    if key == "img_url":
                        value = _coerce_hld_img_url_to_data(value)
                    setattr(row, key, value)
                row.priority = idx
                node.n_id = row.n_id
            if node.children:
                self._update_nodes(doc, row.n_id, node.children)

    def _load_tree(self, doc_id: int) -> List[HldNodeForm]:
        nodes: List[HldNode] = db.session.execute(
            select(HldNode).where(HldNode.doc_id == doc_id).order_by(HldNode.priority)
        ).scalars().all()
        objs_dict = {}
        roots: List[HldNodeForm] = []
        for node in nodes:
            table = self._parse_table(node.table)
            obj = HldNodeForm(
                children=[],
                doc_id=node.doc_id,
                n_id=node.n_id,
                p_id=node.p_id,
                title=node.title,
                label=node.label,
                img_url=node.img_url,
                text=node.text,
                ref_type=node.ref_type,
                table=table,
            )
            objs_dict[obj.n_id] = obj
        for obj in objs_dict.values():
            if obj.p_id == 0:
                roots.append(obj)
            else:
                parent = objs_dict.get(obj.p_id)
                if parent:
                    parent.children.append(obj)
        return roots

    def __coerce_tree_img_urls_to_data(self, nodes: List[HldNodeForm]):
        for node in nodes or []:
            if getattr(node, "img_url", None):
                node.img_url = _coerce_hld_img_url_to_data(node.img_url)
            self.__coerce_tree_img_urls_to_data(getattr(node, "children", None) or [])

    def __query_imgs(self, product_id: int):
        subquery = select(DocFile.category, func.max(DocFile.id).label("max_id"))
        subquery = subquery.where(DocFile.product_id == product_id).group_by(DocFile.category).subquery()
        sql = select(DocFile).join(subquery, DocFile.id == subquery.c.max_id)
        rows: List[DocFile] = db.session.execute(sql).scalars().all()
        return {row.category: row.file_url for row in rows}

    def __hydrate_tree_product_images(self, nodes: List[HldNodeForm], prod_imgs: dict):
        if not nodes or not prod_imgs:
            return
        for node in nodes or []:
            ref_type = getattr(node, "ref_type", None)
            existing = _normalize_hld_img_url(getattr(node, "img_url", "") or "")
            # 章节或图题上已经有图时保留原图。没有图才用产品图示补。
            # 只补给物理拓扑/图1、系统结构/图2；子图题已经有图时不再往父章节补，避免导出重复。
            if ref_type in prod_imgs and prod_imgs.get(ref_type) and not existing:
                if self.__title_accepts_product_image(node, ref_type) and not self.__child_owns_figure(node):
                    node.img_url = prod_imgs[ref_type]
            self.__hydrate_tree_product_images(getattr(node, "children", None) or [], prod_imgs)

    def __upsert_product_doc_image(self, doc_id: int, ref_type: str, file_name: str, file_size: int, file_url: str):
        if ref_type not in {"img_flow", "img_topo", "img_struct"} or not file_url:
            return
        hld_doc = db.session.execute(select(HldDoc).where(HldDoc.id == doc_id)).scalars().first()
        if not hld_doc or not hld_doc.product_id:
            return
        row = db.session.execute(
            select(DocFile)
            .where(DocFile.product_id == hld_doc.product_id)
            .where(DocFile.category == ref_type)
            .order_by(desc(DocFile.id))
        ).scalars().first()
        if row is None:
            row = DocFile(product_id=hld_doc.product_id, category=ref_type)
            db.session.add(row)
        ext = os.path.splitext(str(file_name or ""))[1] or os.path.splitext(str(file_url or ""))[1] or ".png"
        row.file_name = f"{hld_doc.version or ref_type}_{ref_type}{ext}"
        row.file_size = file_size
        row.file_url = file_url
        row.update_time = datetime.now()
        db.session.flush()

    async def add_hld_doc(self, form: HldDocForm):
        try:
            count = db.session.execute(
                select(func.count(HldDoc.id)).where(HldDoc.product_id == form.product_id, HldDoc.version == form.version)
            ).scalar()
            if count > 0:
                version = (form.version or "").strip()
                return Resp.resp_err(msg=f"该产品下已经有{version}版本文档存在" if version else ts("msg_obj_exist"))
            row = HldDoc(
                product_id=form.product_id,
                sdsdoc_id=form.sdsdoc_id or 0,
                version=form.version,
                change_log=form.change_log,
                n_id=0,
                file_no=serv_review_util.resolve_doc_file_no(form.product_id, form.file_no, form.version, "hld"),
            )
            db.session.add(row)
            db.session.flush()
            if form.content:
                self._reset_tree_node_ids(form.content)
                self._update_nodes(row, 0, form.content)
            db.session.commit()
            return Resp.resp_ok(data=HldDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def duplicate_hld_doc(self, id: int, product_id: int = None):
        fromdoc: HldDocObj = (await self.get_hld_doc(id, with_tree=True)).data
        if not fromdoc:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        target_pid = product_id or fromdoc.product_id
        all_versions = db.session.execute(select(HldDoc.version).where(HldDoc.product_id == target_pid)).scalars().all()
        existing_set = {v for v in all_versions if v}
        if target_pid == fromdoc.product_id:
            version = new_version(fromdoc.version)
        else:
            def _version_seq(v):
                m = re.search(r"(\d+)(?!.*\d)", v or "")
                return int(m.group(1)) if m else -1
            valid = [v for v in all_versions if v]
            version = new_version(max(valid, key=_version_seq)) if valid else fromdoc.version
        while version in existing_set:
            version = new_version(version)
        newdoc = HldDoc(
            product_id=target_pid,
            sdsdoc_id=fromdoc.sdsdoc_id or 0,
            version=version,
            file_no=serv_review_util.resolve_doc_file_no(target_pid, fromdoc.file_no, version, "hld"),
            change_log=fromdoc.change_log,
            n_id=0,
        )
        count = db.session.execute(
            select(func.count(HldDoc.id)).where(HldDoc.product_id == newdoc.product_id, HldDoc.version == newdoc.version)
        ).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_obj_exist"))
        try:
            db.session.add(newdoc)
            db.session.flush()
            self._update_nodes(newdoc, 0, fromdoc.content or [])
            db.session.commit()
            return Resp.resp_ok(data=HldDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_hld_doc(self, id: int):
        try:
            db.session.execute(delete(HldNode).where(HldNode.doc_id == id))
            db.session.execute(delete(HldDoc).where(HldDoc.id == id))
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def add_hld_node(self, node: HldNodeForm):
        result = db.session.execute(
            select(HldNode, HldDoc)
            .join(HldDoc, HldNode.doc_id == HldDoc.id)
            .where(HldNode.doc_id == node.doc_id, HldNode.n_id == node.p_id)
        ).first()
        if not result:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        _, doc = result
        doc.n_id += 1
        table = self._serialize_table(node.table)
        row = HldNode(
            doc_id=doc.id,
            n_id=doc.n_id,
            p_id=node.p_id,
            priority=doc.n_id,
            title=node.title,
            label=node.label,
            img_url=_normalize_hld_img_url(node.img_url),
            text=node.text,
            ref_type=node.ref_type,
            table=table,
        )
        db.session.add(row)
        db.session.commit()
        return Resp.resp_ok(data=HldNodeForm(
            doc_id=row.doc_id,
            n_id=row.n_id,
            p_id=row.p_id,
            priority=row.priority,
            title=row.title,
            label=row.label,
            img_url=row.img_url,
            text=row.text,
            ref_type=row.ref_type,
            table=node.table,
        ))

    async def delete_hld_node(self, doc_id: int, n_id: int):
        db.session.execute(delete(HldNode).where(HldNode.doc_id == doc_id, HldNode.n_id == n_id))
        db.session.commit()
        return Resp.resp_ok()

    async def update_hld_doc(self, form: HldDocForm):
        try:
            count = db.session.execute(
                select(func.count(HldDoc.id)).where(
                    HldDoc.product_id == form.product_id,
                    HldDoc.version == form.version,
                    HldDoc.id != form.id,
                )
            ).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row: HldDoc = db.session.execute(select(HldDoc).where(HldDoc.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            if form.content is None:
                return Resp.resp_err(msg="保存失败：未收到文档结构内容，请刷新后重试")
            if isinstance(form.content, list) and len(form.content) == 0:
                return Resp.resp_err(msg="保存失败：文档结构为空，请刷新后重试")
            for key, value in form.dict().items():
                if key in ("id", "n_id", "content") or value is None:
                    continue
                setattr(row, key, value)
            row.file_no = sync_file_no_version(row.file_no, row.version)
            row.n_id = 0
            db.session.execute(delete(HldNode).where(HldNode.doc_id == row.id))
            self._reset_tree_node_ids(form.content or [])
            self._update_nodes(row, 0, form.content or [])
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_hld_doc_file_no(self, id: int, file_no: str):
        try:
            row: HldDoc = db.session.execute(select(HldDoc).where(HldDoc.id == id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            row.file_no = (file_no or "").strip() or None
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def get_hld_doc(self, id: int, with_tree: bool = False):
        row, row_prod = db.session.execute(
            select(HldDoc, Product).outerjoin(Product, HldDoc.product_id == Product.id).where(HldDoc.id == id)
        ).first() or (None, None)
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        tree = []
        if with_tree:
            tree = self._load_tree(row.id)
            try:
                if self._repair_product_function_chapter(row, tree):
                    db.session.commit()
            except Exception:
                logger.exception("概要设计产品功能章节拆分失败")
                db.session.rollback()
            try:
                if self._tidy_hld_field_chapters(row, tree):
                    db.session.commit()
            except Exception:
                logger.exception("概要设计字段表目录整理失败")
                db.session.rollback()
            if row.product_id:
                try:
                    from .serv_prod_runtime_env import apply_runtime_to_hld_tree
                    apply_runtime_to_hld_tree(tree, row.product_id)
                except Exception:
                    logger.exception("概要设计运行环境覆盖失败")
                prod_imgs = self.__query_imgs(row.product_id)
                self.__hydrate_tree_product_images(tree, prod_imgs)
                try:
                    pairs = await self._sds_glossary_pairs(row.sdsdoc_id or 0)
                    if self._apply_sds_glossary_to_hld(row.id, tree, pairs):
                        db.session.commit()
                except Exception:
                    logger.exception("概要设计术语同步失败")
                    db.session.rollback()
        doc_data = row.dict()
        if not (doc_data.get("file_no") or "").strip():
            doc_data["file_no"] = serv_review_util.resolve_doc_file_no(row.product_id, row.file_no, row.version, "hld") or doc_data.get("file_no")
        return Resp.resp_ok(data=HldDocObj(
            **doc_data,
            product_name=row_prod.name if row_prod else "",
            product_version=row_prod.full_version if row_prod else "",
            content=tree,
        ))

    async def list_hld_doc(
        self,
        op_user: UserObj,
        product_id: int = 0,
        version: str = None,
        page_index: int = 0,
        page_size: int = 10,
    ):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10
        sql = select(HldDoc, Product).outerjoin(Product, HldDoc.product_id == Product.id)
        if product_id:
            sql = sql.where(HldDoc.product_id == product_id)
        if version:
            sql = sql.where(HldDoc.version.like(f"%{version}%"))
        if op_user and op_user.id != 1 and getattr(op_user, "role_code", None) == Roles.product_manager.value.code:
            sql = sql.where(Product.create_user_id == op_user.id)
        total = db.session.execute(select(func.count()).select_from(sql)).scalars().first()
        rows = db.session.execute(
            sql.offset(page_size * page_index).limit(page_size).order_by(desc(HldDoc.create_time))
        ).all()
        doc_ids = [row.id for row, _ in rows]
        nodes_by_doc = defaultdict(list)
        if doc_ids:
            node_rows = db.session.execute(select(HldNode).where(HldNode.doc_id.in_(doc_ids))).scalars().all()
            for node in node_rows:
                nodes_by_doc[node.doc_id].append(node)
        objs = []
        for row, row_prd in rows:
            obj = HldDocObj(**row.dict())
            if row_prd:
                obj.product_name = row_prd.name
                obj.product_version = row_prd.full_version
            if not (obj.file_no or "").strip():
                obj.file_no = serv_review_util.resolve_doc_file_no(row.product_id, row.file_no, row.version, "hld")
            rev_desc = _extract_hld_revision_change_desc(nodes_by_doc.get(row.id, []), row.version)
            if rev_desc:
                obj.change_log = rev_desc
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))

    async def add_doc_file(self, doc_id: int, file, ref_type: str = None):
        if not file:
            return Resp.resp_err(msg="未收到图片文件")
        bys = await file.read()
        if not bys:
            return Resp.resp_err(msg="图片文件为空")
        filename = getattr(file, "filename", "") or "image.png"
        mime = getattr(file, "content_type", None) or _guess_hld_image_mime(filename)
        if not str(mime).startswith("image/"):
            mime = _guess_hld_image_mime(filename)
        data_url = _bytes_to_hld_data_url(bys, mime)
        self.__upsert_product_doc_image(
            doc_id,
            str(ref_type or "").strip(),
            filename,
            len(bys),
            data_url,
        )
        db.session.commit()
        return Resp.resp_ok(data=data_url)

    @staticmethod
    def _biz_title(value: str) -> str:
        txt = re.sub(r"^\s*\d+(?:\.\d+)*[\s、.．]*", "", str(value or "").strip())
        return re.sub(r"\s+", "", txt)

    @staticmethod
    def _heading_level(title: str) -> int:
        matched = re.match(r"^(\d+(?:\.\d+)*)", str(title or "").strip())
        if matched:
            return max(1, min(len(matched.group(1).split(".")), 5))
        return 1

    @staticmethod
    def _is_imported_image_title(value: str) -> bool:
        return re.match(r"^导入图片\d*$", str(value or "").strip()) is not None

    @staticmethod
    def _is_imported_table_title(value: str) -> bool:
        return re.match(r"^导入表格\d*$", str(value or "").strip()) is not None

    @staticmethod
    def __title_accepts_product_image(node, ref_type: str) -> bool:
        title = str(getattr(node, "title", "") or "").strip()
        plain = Server._biz_title(title)
        if ref_type == "img_topo":
            return "物理拓扑" in plain or re.match(r"^图\s*1", title) is not None
        if ref_type == "img_struct":
            return ("系统结构" in plain or "体系结构" in plain) or re.match(r"^图\s*2", title) is not None
        return False

    @staticmethod
    def __child_owns_figure(node) -> bool:
        for child in getattr(node, "children", None) or []:
            child_title = str(getattr(child, "title", "") or "").strip()
            if re.match(r"^图\s*\d+", child_title) and _normalize_hld_img_url(getattr(child, "img_url", "") or ""):
                return True
        return False

    @staticmethod
    def _is_image_caption_line(value: str) -> bool:
        return re.match(r"^\s*图\s*\d+\s*", str(value or "").strip()) is not None

    @staticmethod
    def _is_table_caption_line(value: str) -> bool:
        return re.match(r"^\s*表\s*\d+\s*", str(value or "").strip()) is not None

    def _to_hld_node(self, node) -> HldNodeForm:
        table = getattr(node, "table", None)
        if table is not None and not isinstance(table, Table):
            try:
                table = Table.parse_obj(table.dict() if hasattr(table, "dict") else table)
            except Exception:
                table = None
        return HldNodeForm(
            title=getattr(node, "title", None),
            label=getattr(node, "label", None),
            img_url=getattr(node, "img_url", None),
            text=getattr(node, "text", None),
            ref_type=getattr(node, "ref_type", None),
            table=table,
            children=[self._to_hld_node(child) for child in (getattr(node, "children", None) or [])],
        )

    def __bind_imported_image_titles(self, nodes: List[HldNodeForm]):
        def walk(node_list: List[HldNodeForm]):
            for node in node_list or []:
                children = list(getattr(node, "children", None) or [])
                image_children = [child for child in children if str(getattr(child, "img_url", "") or "").strip()]
                if image_children:
                    lines = str(getattr(node, "text", "") or "").replace("\r", "").split("\n")
                    caption_entries = [
                        (idx, (line or "").strip())
                        for idx, line in enumerate(lines)
                        if self._is_image_caption_line(line)
                    ]
                    if caption_entries:
                        used_line_idx = set()
                        for idx, child in enumerate(image_children):
                            if idx >= len(caption_entries):
                                break
                            line_idx, caption = caption_entries[idx]
                            child_title = str(getattr(child, "title", "") or "").strip()
                            if not child_title or self._is_imported_image_title(child_title):
                                child.title = caption
                            used_line_idx.add(line_idx)
                        if used_line_idx:
                            node.text = "\n".join(
                                (line or "").strip()
                                for idx, line in enumerate(lines)
                                if idx not in used_line_idx and str(line or "").strip()
                            )
                walk(children)

        walk(nodes or [])

    def __bind_imported_table_titles(self, nodes: List[HldNodeForm]):
        def walk(node_list: List[HldNodeForm]):
            for node in node_list or []:
                children = list(getattr(node, "children", None) or [])
                table_children = [
                    child for child in children
                    if getattr(child, "table", None) is not None and getattr(getattr(child, "table", None), "headers", None)
                ]
                if table_children:
                    lines = str(getattr(node, "text", "") or "").replace("\r", "").split("\n")
                    caption_entries = [
                        (idx, (line or "").strip())
                        for idx, line in enumerate(lines)
                        if self._is_table_caption_line(line)
                    ]
                    if caption_entries:
                        used_line_idx = set()
                        for idx, child in enumerate(table_children):
                            if idx >= len(caption_entries):
                                break
                            line_idx, caption = caption_entries[idx]
                            child_title = str(getattr(child, "title", "") or "").strip()
                            if not child_title or self._is_imported_table_title(child_title):
                                child.title = caption
                            used_line_idx.add(line_idx)
                        if used_line_idx:
                            node.text = "\n".join(
                                (line or "").strip()
                                for idx, line in enumerate(lines)
                                if idx not in used_line_idx and str(line or "").strip()
                            )
                walk(children)

        walk(nodes or [])

    def __persist_data_url_images(self, nodes: List[HldNodeForm]):
        """图片以 data URL 存入 hld_node.img_url / doc_file.file_url，不再写入本地目录。"""

        def walk(node_list: List[HldNodeForm]):
            for node in node_list or []:
                img_url = (getattr(node, "img_url", None) or "").strip()
                if img_url:
                    node.img_url = _coerce_hld_img_url_to_data(img_url)
                walk(getattr(node, "children", None) or [])

        walk(nodes or [])

    def __apply_hld_ref_types(self, nodes: List[HldNodeForm]):
        def walk(node_list: List[HldNodeForm]):
            for node in node_list or []:
                title = str(getattr(node, "title", "") or "")
                norm_title = self._biz_title(title)
                if "物理拓扑" in norm_title or re.search(r"^图\s*1", title, re.I):
                    node.ref_type = "img_topo"
                elif re.search(r"^图\s*2", title, re.I) or ("系统结构" in norm_title and "图" in title):
                    node.ref_type = "img_struct"
                elif getattr(node, "ref_type", None) in {"img_topo", "img_struct"}:
                    pass
                walk(getattr(node, "children", None) or [])

        walk(nodes or [])

    def __sync_imported_hld_doc_images_to_doc_file(self, doc_id: int, nodes: List[HldNodeForm]):
        if not doc_id or not nodes:
            return

        def file_size_of(url: str) -> int:
            path = str(url or "").strip()
            if path.startswith("data:image/"):
                matched = re.match(r"^data:[^;]+;base64,(.+)$", path, re.S)
                if matched:
                    try:
                        return len(base64.b64decode(matched.group(1) or ""))
                    except Exception:
                        return 0
                return 0
            if path.startswith("/"):
                path = path[1:]
            try:
                return os.path.getsize(path) if path and os.path.exists(path) else 0
            except Exception:
                return 0

        for ref_type in ("img_topo", "img_struct"):
            best_url = ""
            best_score = -1

            def walk(items: List[HldNodeForm]):
                nonlocal best_url, best_score
                for node in items or []:
                    node_ref = str(getattr(node, "ref_type", "") or "").strip()
                    img_url = _normalize_hld_img_url(getattr(node, "img_url", "") or "")
                    if node_ref == ref_type and img_url:
                        title = f"{getattr(node, 'title', '') or ''} {getattr(node, 'text', '') or ''}"
                        score = 10
                        if ref_type == "img_topo" and "物理拓扑" in self._biz_title(title):
                            score = 100
                        if ref_type == "img_struct" and ("系统结构" in self._biz_title(title) or re.search(r"图\s*2", title, re.I)):
                            score = 100
                        if score > best_score:
                            best_url = img_url
                            best_score = score
                    walk(getattr(node, "children", None) or [])

            walk(nodes)
            if best_url:
                if best_url.startswith("/"):
                    best_url = best_url[1:]
                self.__upsert_product_doc_image(doc_id, ref_type, ref_type, file_size_of(best_url), best_url)

    async def import_hld_doc_word(self, product_id: int, version: str, change_log: str, file):
        if Document is None or Paragraph is None:
            return Resp.resp_err(msg="当前环境缺少 python-docx 依赖，暂不可用 Word 导入。")
        try:
            count = db.session.execute(
                select(func.count(HldDoc.id)).where(HldDoc.product_id == product_id, HldDoc.version == version)
            ).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))

            bys = await file.read()
            docx = Document(io.BytesIO(bys))
            content, _heading_rows = srsdoc_serv._Server__parse_docx_content(docx)
            file_name = file.filename or ""
            _, file_no = srsdoc_serv._Server__extract_file_info(file_name)
            hld_content = [self._to_hld_node(node) for node in (content or [])]
            self.__bind_imported_image_titles(hld_content)
            self.__bind_imported_table_titles(hld_content)
            self.__apply_hld_ref_types(hld_content)
            self.__persist_data_url_images(hld_content)
            form = HldDocForm(
                product_id=product_id,
                version=version,
                file_no=file_no or None,
                change_log=change_log,
                content=hld_content,
            )
            resp = await self.add_hld_doc(form)
            if resp.code == c_ok and resp.data and resp.data.id:
                product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
                product_version = getattr(product, "full_version", "") or getattr(product, "name", "") or ""
                srsdoc_serv._Server__auto_sync_product_doc_images(
                    product_id,
                    content or [],
                    version,
                    docx,
                    product_version,
                    bys,
                    resp.data.id,
                )
                self.__sync_imported_hld_doc_images_to_doc_file(resp.data.id, hld_content)
                db.session.commit()
            return resp
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def export_hld_doc(self, output, id: int = 0, snapshot: HldDocForm = None):
        if Document is None:
            return
        from .serv_utils import docx_util

        if snapshot and snapshot.content:
            doc_obj = snapshot
            file_no = (snapshot.file_no or "").strip()
        else:
            resp = await self.get_hld_doc(id, with_tree=True)
            if resp.code != c_ok or not resp.data:
                return
            doc_obj = resp.data
            file_no = (doc_obj.file_no or "").strip()
        if getattr(doc_obj, "product_id", None) and getattr(doc_obj, "content", None):
            try:
                from .serv_prod_runtime_env import apply_runtime_to_hld_tree
                apply_runtime_to_hld_tree(doc_obj.content, doc_obj.product_id)
            except Exception:
                logger.exception("概要设计导出运行环境覆盖失败")

        docx = Document()
        export_rev_date = ""
        if getattr(doc_obj, "product_id", None):
            export_rev_date = serv_review_util.cover_date(doc_obj.product_id, "hld") or ""
        wrote_review = {"ok": False}
        pending_reviews: List[HldNodeForm] = []

        def __is_cover_title(title: str) -> bool:
            return self._biz_title(title) in ["软件概要设计", "软件概要设计说明书"]

        def __is_revision_title(title: str) -> bool:
            return self._biz_title(title) == "文件修订记录"

        def __is_review_title(title: str) -> bool:
            t = re.sub(r"\s+", "", str(title or ""))
            return t == "评审记录" or t == "附件一评审结论" or t.startswith("附件一")

        def __table_header_names(table) -> str:
            return "".join(str(getattr(h, "name", "") or "") for h in (getattr(table, "headers", None) or []))

        def __is_review_content_table(table) -> bool:
            names = __table_header_names(table)
            return "评审内容" in names and ("评审项" in names or "评审结论" in names)

        def __is_review_person_table(table) -> bool:
            names = __table_header_names(table)
            return (("人员角色" in names or "参评人员" in names) and "签字" in names)

        def __is_misplaced_review_table(table) -> bool:
            return bool(table) and (__is_review_content_table(table) or __is_review_person_table(table))

        def __strip_review_tail(text: str) -> str:
            return re.sub(r"\n?附件一\s*评审结论\s*$", "", str(text or ""))

        def __set_review_cell(cell, text, bold=False, align=None):
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
            from docx.shared import Pt
            from .serv_utils import docx_util
            if align is None:
                align = WD_ALIGN_PARAGRAPH.LEFT
            s = str(text or "")
            if s.startswith("data:image"):
                try:
                    b64 = s.split(",", 1)[1] if "," in s else ""
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = align
                    para.add_run().add_picture(io.BytesIO(base64.b64decode(b64)), height=Pt(33))
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
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER if align != WD_ALIGN_PARAGRAPH.LEFT else WD_CELL_VERTICAL_ALIGNMENT.TOP

        def __grid_from_table(table, with_header: bool):
            headers = getattr(table, "headers", None) or []
            codes = [h.code for h in headers]
            grid = []
            if with_header:
                grid.append([str(h.name or "") for h in headers])
            for row in getattr(table, "rows", None) or []:
                if isinstance(row, dict):
                    grid.append([str(row.get(c) or "") for c in codes])
            return grid

        def __start_next_page():
            from docx.shared import Pt
            p = docx.add_paragraph()
            p.paragraph_format.page_break_before = True
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = Pt(1)

        def __write_review_title():
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.shared import Pt
            from .serv_utils import docx_util
            __start_next_page()
            title = docx.add_paragraph()
            title.alignment = WD_ALIGN_PARAGRAPH.CENTER
            title.paragraph_format.first_line_indent = Pt(0)
            docx_util.fonted_txt(title, "附件一 评审结论", font_size=16.0, bold=True)
            try:
                title.style = docx.styles["Heading 1"]
            except Exception:
                pass
            title.alignment = WD_ALIGN_PARAGRAPH.CENTER
            __drop_list_number(title)

        def __align_review_grid(grid):
            """批准日期、评审时间与封面同一天，覆盖模板旧日期。"""
            if not export_rev_date:
                return grid
            for row in grid or []:
                if not isinstance(row, list) or not row:
                    continue
                cell0 = str(row[0] or "")
                if cell0.startswith("评审时间"):
                    row[0] = f"评审时间：{export_rev_date}"
                elif cell0.startswith("批准人员签字") and len(row) >= 3 and not str(row[2] or "").startswith("data:image"):
                    row[2] = export_rev_date
            return grid

        def __write_review_tables(node):
            table = getattr(node, "table", None)
            if table and getattr(table, "headers", None):
                names = __table_header_names(table)
                with_header = "评审内容" in names and ("评审项" in names or "评审结论" in names)
                serv_review_util.render_review_grid(
                    docx, __align_review_grid(__grid_from_table(table, with_header)), __set_review_cell,
                    merge_col0=with_header, merge_full=True,
                )
                for extra in getattr(table, "extra_tables", None) or []:
                    extra_table = getattr(extra, "table", None) if not isinstance(extra, dict) else extra.get("table")
                    if extra_table:
                        serv_review_util.render_review_grid(
                            docx, __align_review_grid(__grid_from_table(extra_table, False)), __set_review_cell,
                            merge_col0=False, merge_full=True,
                        )
            # 子评审表已在遍历正文时单独收集进 pending_reviews，这里不再递归整棵子树
            for child in getattr(node, "children", None) or []:
                child_title = str(getattr(child, "title", "") or "").strip()
                if getattr(child, "ref_type", None) == "review" or __is_review_title(child_title):
                    __write_review_tables(child)
                elif __has_table(child) and __is_misplaced_review_table(child.table):
                    __write_review_tables(child)

        def __flush_pending_reviews():
            if not pending_reviews:
                return
            __write_review_title()
            for node in pending_reviews:
                __write_review_tables(node)
            wrote_review["ok"] = True
            pending_reviews.clear()

        def __save_fitted_image(img_url: str):
            docx_util.save_img2docx(img_url, docx, mw=520, mh=340, page_fit=True)
            if docx.paragraphs:
                __drop_list_number(docx.paragraphs[-1])

        def __save_plain_caption(text: str, center: bool = False):
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.shared import Pt
            p = docx.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if center else WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.first_line_indent = Pt(0)
            docx_util.fonted_txt(p, text, font_size=10.5)

        def __is_data_table_caption(line: str) -> bool:
            txt = str(line or "").strip()
            if not txt or self._is_image_caption_line(txt):
                return False
            if re.match(r"^(表|table)\s*\d+", txt, re.I):
                return True
            if "表" in txt and re.match(r"^.+表\s*[:：]?$", txt):
                return True
            if re.match(r"^[A-Za-z][A-Za-z0-9_]{1,64}[:：]\s*.+$", txt):
                return True
            if re.search(r"[:：]", txt) and len(txt) <= 80 and re.search(r"[。！？]$", txt) is None:
                parts = [seg.strip() for seg in re.split(r"[:：]", txt)]
                left = parts[0] if parts else ""
                right = "".join(parts[1:]).strip() if len(parts) > 1 else ""
                left_is_identifier = re.match(r"^[A-Za-z][A-Za-z0-9_]{1,64}$", left or "") is not None
                if left and right and (left_is_identifier or "表" in left):
                    return True
                if left and not right and "表" in left:
                    return True
            return False

        def __drop_list_number(paragraph):
            """去掉 Heading 自带列表编号，避免正文已有「1 引言」再叠出「.1 引言」。"""
            from docx.oxml.ns import qn
            p_pr = paragraph._p.get_or_add_pPr()
            for child in list(p_pr):
                if child.tag == qn("w:numPr"):
                    p_pr.remove(child)

        def __write_heading(title: str, level: int):
            docx_util.save_title2docx(title, docx, level=level)
            if docx.paragraphs:
                __drop_list_number(docx.paragraphs[-1])

        def __table_caption_name(node) -> str:
            return str(getattr(getattr(node, "table", None), "name", "") or "").strip()

        def __write_imported_table(node, caption: str = ""):
            cap = str(caption or "").strip() or __table_caption_name(node)
            if cap:
                # 原模版：表题（表 N … / ××表）居中
                __save_plain_caption(cap, center=True)
            docx_util.save_tab2docx(node.table, docx)

        def __has_table(node) -> bool:
            table = getattr(node, "table", None)
            return bool(table and getattr(table, "headers", None))

        def __write_nodes(nodes: List[HldNodeForm], default_level: int = 1):
            for node in nodes or []:
                title = str(getattr(node, "title", "") or "").strip()
                if getattr(node, "ref_type", None) == "review" or __is_review_title(title):
                    pending_reviews.append(node)
                    continue
                if self._is_imported_table_title(title) and __has_table(node) and __is_misplaced_review_table(node.table):
                    pending_reviews.append(node)
                    continue
                img_url = _normalize_hld_img_url(getattr(node, "img_url", "") or "")
                is_figure = bool(img_url) and (
                    self._is_image_caption_line(title) or self._is_imported_image_title(title)
                )
                if is_figure and not __has_table(node):
                    __save_fitted_image(img_url)
                    if title:
                        __save_plain_caption(title, center=True)
                    continue
                if not title and not getattr(node, "text", None) and not __has_table(node):
                    if getattr(node, "children", None):
                        __write_nodes(node.children, default_level)
                    continue
                if self._is_imported_table_title(title) and __has_table(node):
                    __write_imported_table(node)
                    __write_nodes(getattr(node, "children", None) or [], default_level + 1)
                    continue
                if self._is_field_table_node(node):
                    __write_imported_table(node, title)
                    __write_nodes(getattr(node, "children", None) or [], default_level + 1)
                    continue
                if title and not self._is_imported_image_title(title):
                    level = self._heading_level(title) if re.match(r"^\d", title) else default_level
                    if __is_cover_title(title) or __is_revision_title(title):
                        level = 1
                    __write_heading(title, level)
                children = list(getattr(node, "children", None) or [])
                review_children = []
                table_children = []
                other_children = []
                for child in children:
                    child_title = str(getattr(child, "title", "") or "").strip()
                    if getattr(child, "ref_type", None) == "review" or __is_review_title(child_title):
                        review_children.append(child)
                        continue
                    if self._is_imported_table_title(child_title) and __has_table(child) and __is_misplaced_review_table(child.table):
                        review_children.append(child)
                        continue
                    if self._is_imported_table_title(child_title) and __has_table(child):
                        if __is_iface_summary(getattr(node, "table", None)) and __is_iface_summary(child.table):
                            continue
                        table_children.append(child)
                    else:
                        other_children.append(child)
                pending_reviews.extend(review_children)
                consumed = 0
                for raw_line in __strip_review_tail(getattr(node, "text", "") or "").replace("\r", "").split("\n"):
                    line = str(raw_line or "").strip()
                    if not line or re.sub(r"\s+", "", line) in ("附件一评审结论", "评审记录"):
                        continue
                    if __is_data_table_caption(line) and consumed < len(table_children):
                        __write_imported_table(table_children[consumed], line)
                        consumed += 1
                        continue
                    docx_util.save_txt2docx(line, docx)
                while consumed < len(table_children):
                    __write_imported_table(table_children[consumed])
                    consumed += 1
                if __has_table(node) and not __is_misplaced_review_table(node.table):
                    __write_imported_table(node)
                elif __has_table(node) and __is_misplaced_review_table(node.table):
                    pending_reviews.append(node)
                if img_url and not self.__child_owns_figure(node):
                    __save_fitted_image(img_url)
                    if docx.paragraphs:
                        __drop_list_number(docx.paragraphs[-1])
                __write_nodes(other_children, default_level + 1)

        def __is_iface_summary(table) -> bool:
            names = [re.sub(r"\s+", "", str(getattr(h, "name", "") or "")) for h in (getattr(table, "headers", None) or [])]
            return "接口设计编号" in names and any(key in names for key in ("功能", "接口名称", "涉及模块"))

        def __write_outline(nodes, depth=0):
            from docx.shared import Pt
            for node in nodes or []:
                title = str(getattr(node, "title", "") or "").strip()
                if not title or __is_cover_title(title) or __is_revision_title(title) or __is_review_title(title):
                    __write_outline(getattr(node, "children", None), depth)
                    continue
                if self._is_imported_table_title(title) or self._is_imported_image_title(title) or self._is_field_table_node(node):
                    continue
                if re.match(r"^\d", title):
                    p = docx.add_paragraph()
                    p.paragraph_format.left_indent = Pt(14 * depth)
                    p.paragraph_format.space_before = Pt(0)
                    p.paragraph_format.space_after = Pt(0)
                    p.paragraph_format.line_spacing = 1.5
                    docx_util.fonted_txt(p, title, font_size=10.5)
                    __write_outline(getattr(node, "children", None), depth + 1)
                else:
                    __write_outline(getattr(node, "children", None), depth)

        def __cover_signers():
            rev_date = ""
            signers = {}
            pid = getattr(doc_obj, "product_id", None)
            if pid:
                rev_date = serv_review_util.cover_date(pid, "hld") or ""
                if serv_review_util.sign_mode_enabled():
                    signers = serv_review_util.cover_signers(pid, "hld", rev_date) or {}
                else:
                    signers = serv_review_util.cover_signer_names(pid, "hld", rev_date) or {}
            return rev_date, signers

        def __blank_cover_table():
            rev_date, signers = __cover_signers()
            version = str(getattr(doc_obj, "version", "") or "")
            return Table(
                show_header=0,
                headers=[
                    TabHeader(code="label1", name=""),
                    TabHeader(code="value1", name=""),
                    TabHeader(code="label2", name=""),
                    TabHeader(code="value2", name=""),
                ],
                rows=[
                    {"label1": "编制部门", "value1": "研发部", "label2": "文件版本", "value2": version},
                    {"label1": "编制人", "value1": signers.get("编制人") or "", "label2": "日期", "value2": rev_date},
                    {"label1": "审核人", "value1": signers.get("审核人") or "", "label2": "日期", "value2": rev_date},
                    {"label1": "批准人", "value1": signers.get("批准人") or "", "label2": "日期", "value2": rev_date},
                    {"label1": "生效日期", "value1": rev_date, "label2": "", "value2": ""},
                ],
            )

        def __fill_cover_signers(table):
            if not table:
                return
            rev_date, signers = __cover_signers()
            for row in getattr(table, "rows", None) or []:
                if not isinstance(row, dict):
                    continue
                label = str(row.get("label1") or "").strip()
                if label in ("编制人", "审核人", "批准人") and not str(row.get("value1") or "").strip():
                    row["value1"] = signers.get(label) or ""
                # 编审批日期、生效日期：有时间线日期则覆盖错误旧值
                if label in ("编制人", "审核人", "批准人") and rev_date:
                    row["value2"] = rev_date
                if label == "生效日期" and rev_date:
                    row["value1"] = rev_date
            __sync_cover_cells(table, rev_date)

        def __cell_text(cell):
            if cell is None:
                return ""
            if isinstance(cell, dict):
                return str(cell.get("value") or "")
            return str(getattr(cell, "value", "") or "")

        def __set_cell_text(cell, value):
            if cell is None:
                return
            if isinstance(cell, dict):
                cell["value"] = value or ""
            else:
                cell.value = value or ""

        def __set_col_span(cell, span):
            if cell is None:
                return
            if isinstance(cell, dict):
                cell["col_span"] = span
            else:
                cell.col_span = span

        def __sync_cover_cells(table, rev_date):
            """cells 优先导出：编审批日期、生效日期写进单元格，生效日期跨满本行。"""
            if not table or not rev_date:
                return
            for line in getattr(table, "cells", None) or []:
                if not line:
                    continue
                for index, cell in enumerate(line):
                    label = re.sub(r"\s+", "", __cell_text(cell))
                    if label in ("编制人", "审核人", "批准人") and index + 3 < len(line):
                        date_label = re.sub(r"\s+", "", __cell_text(line[index + 2]))
                        if date_label == "日期":
                            __set_cell_text(line[index + 3], rev_date)
                    if label == "生效日期" and index + 1 < len(line):
                        __set_cell_text(line[index + 1], rev_date)
                        remain = len(line) - (index + 1)
                        if remain > 1:
                            __set_col_span(line[index + 1], remain)
                            for follow in line[index + 2:]:
                                __set_col_span(follow, 0)

        def __merge_effective_date_row():
            if not docx.tables:
                return
            table = docx.tables[-1]
            for row in table.rows:
                cells = row.cells
                if not cells:
                    continue
                label = re.sub(r"\s+", "", cells[0].text or "")
                if label != "生效日期" or len(cells) <= 2:
                    continue
                merged = cells[1]
                for cell in cells[2:]:
                    merged = merged.merge(cell)
                break

        def __fill_revision_dates(table):
            if not table:
                return
            rev_date = ""
            if getattr(doc_obj, "product_id", None):
                rev_date = serv_review_util.cover_date(doc_obj.product_id, "hld") or ""
            if not rev_date:
                return
            rows = list(getattr(table, "rows", None) or [])
            if not rows:
                return
            first = rows[0] if isinstance(rows[0], dict) else None
            if first is not None:
                first["change_date"] = rev_date
            cells = getattr(table, "cells", None) or []
            if len(cells) > 1:
                header = cells[0] or []
                col_idx = next((
                    idx for idx, cell in enumerate(header)
                    if re.sub(r"\s+", "", __cell_text(cell)) == "修改日期"
                ), -1)
                if col_idx >= 0 and col_idx < len(cells[1] or []):
                    __set_cell_text(cells[1][col_idx], rev_date)

        def __blank_revision_table():
            version = str(getattr(doc_obj, "version", "") or "")
            desc = str(getattr(doc_obj, "change_log", "") or "").strip() or "首次发布"
            rev_date = ""
            if getattr(doc_obj, "product_id", None):
                rev_date = serv_review_util.cover_date(doc_obj.product_id, "hld") or ""
            rows = [{
                "change_date": rev_date,
                "version_no": version,
                "change_desc": desc,
                "changer": "",
                "approver": "",
            }]
            while len(rows) < 5:
                rows.append({"change_date": "", "version_no": "", "change_desc": "", "changer": "", "approver": ""})
            return Table(
                headers=[
                    TabHeader(code="change_date", name="修改日期"),
                    TabHeader(code="version_no", name="版本号"),
                    TabHeader(code="change_desc", name="修订说明"),
                    TabHeader(code="changer", name="修订人"),
                    TabHeader(code="approver", name="批准人"),
                ],
                rows=rows,
            )

        def __add_blank_lines(line_count: int):
            from docx.shared import Pt
            for _ in range(max(0, line_count)):
                blank = docx.add_paragraph()
                blank.paragraph_format.space_before = Pt(0)
                blank.paragraph_format.space_after = Pt(0)
                blank.paragraph_format.line_spacing = 1.0

        def __write_front_title(text: str):
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            p = docx.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            docx_util.fonted_txt(p, text, font_size=16.0, bold=True)

        roots = list(doc_obj.content or [])
        cover_node = next((node for node in roots if __is_cover_title(getattr(node, "title", ""))), None)
        revision_node = next((node for node in roots if __is_revision_title(getattr(node, "title", ""))), None)
        if cover_node is None:
            cover_node = HldNodeForm(title="软件概要设计", table=__blank_cover_table())
        elif not __has_table(cover_node):
            cover_node.table = __blank_cover_table()
        else:
            __fill_cover_signers(cover_node.table)
        if revision_node is None:
            revision_node = HldNodeForm(title="文件修订记录", table=__blank_revision_table())
        elif not __has_table(revision_node):
            revision_node.table = __blank_revision_table()
        else:
            __fill_revision_dates(revision_node.table)
        __add_blank_lines(10)
        __write_front_title("软件概要设计")
        __add_blank_lines(9)
        if __has_table(cover_node):
            docx_util.save_tab2docx(cover_node.table, docx)
            if not (getattr(cover_node.table, "cells", None) or []):
                __merge_effective_date_row()
        __start_next_page()
        __write_front_title("文件修订记录")
        __add_blank_lines(2)
        if __has_table(revision_node):
            docx_util.save_tab2docx(revision_node.table, docx)
        body_roots = [
            node for node in roots
            if node is not cover_node and node is not revision_node
            and not __is_cover_title(getattr(node, "title", ""))
            and not __is_revision_title(getattr(node, "title", ""))
        ]
        __start_next_page()
        __write_front_title("目录")
        __add_blank_lines(1)
        __write_outline(body_roots)
        from docx.shared import Pt as _toc_pt
        tail = docx.add_paragraph()
        tail.paragraph_format.left_indent = _toc_pt(0)
        tail.paragraph_format.space_before = _toc_pt(0)
        tail.paragraph_format.space_after = _toc_pt(0)
        docx_util.fonted_txt(tail, "附件一 评审结论", font_size=10.5)
        __start_next_page()
        __write_nodes(body_roots)
        __flush_pending_reviews()
        if not wrote_review["ok"] and getattr(doc_obj, "product_id", None):
            sec = serv_review_util.build_review_section(
                "hld",
                serv_review_util.review_date(doc_obj.product_id, ["软件概要设计", "概要设计"]),
                doc_obj.product_id,
            )
            if sec:
                __write_review_title()
                for idx, grid in enumerate(sec.get("tables") or []):
                    serv_review_util.render_review_grid(
                        docx, grid, __set_review_cell, merge_col0=(idx == 0), merge_full=True,
                    )
                wrote_review["ok"] = True
        if file_no:
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            section = docx.sections[0] if docx.sections else None
            if section is not None:
                header_para = section.header.paragraphs[0] if section.header.paragraphs else section.header.add_paragraph()
                header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                for run in list(header_para.runs):
                    run.text = ""
                docx_util.fonted_txt(header_para, file_no)
        docx_util.add_page_number_footer(docx.sections[0], file_no=file_no, skip_first=True)
        docx.save(output)

    @staticmethod
    def __table_header_name(table, idx: int = 0) -> str:
        tbl = Server._parse_table(table)
        if not tbl or not tbl.headers or len(tbl.headers) <= idx:
            return ""
        return str(tbl.headers[idx].name or "").strip()

    @staticmethod
    def __detect_field_library(parent_titles: List[str]) -> str:
        chain = " ".join(parent_titles or [])
        if "库2" in chain or "库 2" in chain:
            return "lib2"
        return "lib1"

    _PRODUCT_FN_SECTIONS = (
        ("功能模块定义", "2.2.1 功能模块定义"),
        ("DataProcessing（DP）", "2.2.2 DataProcessing（DP）"),
        ("DLServer", "2.2.3 DLServer"),
        ("RePACS", "2.2.4 RePACS"),
        ("NeoViewer", "2.2.5 NeoViewer"),
        ("系统性能", "2.2.6 系统性能"),
    )

    @staticmethod
    def _norm_section_title(value: str) -> str:
        title = re.sub(r"^\s*\d+(?:\.\d+)*[\s、.．]*", "", str(value or "").strip())
        return re.sub(r"[\s（）()\-–—_]+", "", title).lower()

    def _split_numbered_blob(self, text: str) -> dict:
        src = str(text or "").strip()
        if not src:
            return {}
        parts = re.split(r"\n(?=\s*\d+(?:\.\d+)*\.\s+)", src)
        out = {}
        for part in parts:
            part = part.strip()
            matched = re.match(r"^(\d+(?:\.\d+)*)\.\s*(.+?)(?:\n|$)", part)
            if not matched:
                continue
            title = matched.group(2).strip()
            body = part[matched.end():].strip()
            out[self._norm_section_title(title)] = f"{title}\n{body}".strip() if body else title
        return out

    @staticmethod
    def _field_title_key(title: str) -> str:
        return re.sub(r"[\u200b\s]+", "", str(title or ""))

    @staticmethod
    def _is_field_table_node(node) -> bool:
        table = getattr(node, "table", None)
        headers = getattr(table, "headers", None) or []
        if not headers:
            return False
        name = re.sub(r"\s+", "", str(getattr(headers[0], "name", "") or ""))
        return name in ("FieldID", "字段ID")

    def _drop_repeated_field_block(self, children: List[HldNodeForm]):
        keys = [self._field_title_key(getattr(child, "title", "")) for child in children or []]
        if not keys or not keys[0]:
            return list(children or []), []
        again = next((idx for idx, key in enumerate(keys) if idx > 0 and key == keys[0]), -1)
        if again <= 0:
            return list(children or []), []
        head = keys[:again]
        tail = keys[again:]
        if len(tail) < len(head) or any(head[idx] != tail[idx] for idx in range(len(head))):
            return list(children or []), []
        return list(children[again:]), list(children[:again])

    def _delete_hld_nodes(self, doc: HldDoc, nodes: List[HldNodeForm]):
        for node in nodes or []:
            self._delete_hld_nodes(doc, getattr(node, "children", None) or [])
            n_id = getattr(node, "n_id", None)
            if n_id:
                db.session.execute(delete(HldNode).where(HldNode.doc_id == doc.id, HldNode.n_id == n_id))

    def _tidy_hld_field_chapters(self, doc: HldDoc, roots: List[HldNodeForm]) -> bool:
        """两库都挂在 4.1 下（4.1.1 / 4.1.2）；去掉标记信息；把误挂在 4.2 物理结构下的库 2 迁回。"""
        changed = False
        lib1_title = "4.1.1 Postgresql库1数据库："
        lib2_title = "4.1.2 库2数据库："

        def compact_title(title) -> str:
            return re.sub(r"\s+", "", str(title or ""))

        def biz_title(title) -> str:
            return re.sub(r"^\d+(?:\.\d+)*[\s、.．]*", "", compact_title(title))

        def is_chapter4(title) -> bool:
            biz = biz_title(title)
            if "逻辑结构" in biz or "物理结构" in biz:
                return False
            if "库1数据库" in biz or "库2数据库" in biz or "Postgresql" in biz:
                return False
            return "系统数据结构设计" in biz or biz in ("数据结构设计", "数据结构") or (
                "数据结构" in biz and "逻辑" not in biz and "物理" not in biz
            )

        def is_logic_structure(title) -> bool:
            return "逻辑结构" in biz_title(title)

        def is_physical_structure(title) -> bool:
            return "物理结构" in biz_title(title)

        def is_lib2_title(title) -> bool:
            biz = biz_title(title)
            compact = compact_title(title)
            if "物理结构" in biz:
                return False
            if compact.startswith("4.1.2") or "库2数据库" in biz:
                return True
            return False

        def persist_title_text(node: HldNodeForm, title: str = None, text: str = None):
            n_id = getattr(node, "n_id", None)
            if not n_id:
                return
            row = db.session.execute(
                select(HldNode).where(HldNode.doc_id == doc.id, HldNode.n_id == n_id)
            ).scalars().first()
            if not row:
                return
            if title is not None:
                row.title = title
            if text is not None:
                row.text = text

        def persist_parent(node: HldNodeForm, p_id: int, priority: int):
            n_id = getattr(node, "n_id", None)
            if not n_id:
                return
            row = db.session.execute(
                select(HldNode).where(HldNode.doc_id == doc.id, HldNode.n_id == n_id)
            ).scalars().first()
            if not row:
                return
            row.p_id = p_id
            row.priority = priority

        def walk(nodes: List[HldNodeForm]):
            nonlocal changed
            for node in nodes or []:
                compact = compact_title(getattr(node, "title", ""))
                children = list(getattr(node, "children", None) or [])

                # 章 4：把误挂的「物理结构设计要点」整节迁到 4.1 下的 4.1.2（不依赖 title 是否带 4.2 章号）
                if is_chapter4(getattr(node, "title", "")):
                    section41 = next((c for c in children if is_logic_structure(c.title)), None)
                    misplaced = [c for c in children if is_physical_structure(c.title)]
                    if misplaced and section41 is None:
                        section41 = HldNodeForm(title="4.1 逻辑结构设计要点", children=[])
                        children.insert(0, section41)
                        node.children = children
                        changed = True
                    if misplaced and section41 is not None:
                        sec41_kids = list(getattr(section41, "children", None) or [])
                        lib2 = next((c for c in sec41_kids if is_lib2_title(c.title)), None)
                        moved_tables: List[HldNodeForm] = []
                        for item in misplaced:
                            moved_tables.extend(list(getattr(item, "children", None) or []))
                        if lib2 is None:
                            # 直接把第一个 4.2 节点改名为 4.1.2 挂到 4.1
                            lib2 = misplaced[0]
                            lib2.title = lib2_title
                            body = str(getattr(lib2, "text", "") or "").strip()
                            if re.match(r"^库\s*2数据库[:：]?\s*$", body, re.I):
                                lib2.text = ""
                            lib2.children = moved_tables
                            persist_title_text(lib2, title=lib2_title, text=str(getattr(lib2, "text", "") or ""))
                            if section41.n_id:
                                persist_parent(lib2, int(section41.n_id), len(sec41_kids))
                            if lib2.n_id:
                                for idx, table_node in enumerate(moved_tables):
                                    persist_parent(table_node, int(lib2.n_id), idx)
                            for extra in misplaced[1:]:
                                # 其余 4.2 空壳删掉（表已并入 lib2）；先摘掉 children 避免级联删表
                                extra.children = []
                            sec41_kids.append(lib2)
                            for drop in misplaced[1:]:
                                self._delete_hld_nodes(doc, [drop])
                        else:
                            if str(getattr(lib2, "title", "") or "").strip() != lib2_title:
                                lib2.title = lib2_title
                                persist_title_text(lib2, title=lib2_title)
                            body = str(getattr(lib2, "text", "") or "").strip()
                            if re.match(r"^库\s*2数据库[:：]?\s*$", body, re.I):
                                lib2.text = ""
                                persist_title_text(lib2, text="")
                            merged = list(getattr(lib2, "children", None) or []) + moved_tables
                            fresh, dropped = self._drop_repeated_field_block(merged)
                            lib2.children = fresh
                            if lib2.n_id:
                                for idx, table_node in enumerate(fresh):
                                    persist_parent(table_node, int(lib2.n_id), idx)
                            if dropped:
                                self._delete_hld_nodes(doc, dropped)
                            for item in misplaced:
                                item.children = []
                            self._delete_hld_nodes(doc, misplaced)
                        section41.children = [c for c in sec41_kids if not is_physical_structure(c.title)]
                        if lib2 not in section41.children:
                            section41.children.append(lib2)
                        node.children = [c for c in children if c not in misplaced]
                        changed = True
                        children = list(node.children or [])

                if is_logic_structure(getattr(node, "title", "")):
                    kept = []
                    removed = []
                    for child in children:
                        child_title = compact_title(child.title)
                        child_biz = biz_title(child.title)
                        if "标记信息" in child_title or is_physical_structure(child.title):
                            removed.append(child)
                            continue
                        if child_title.startswith("4.1.1") or "库1数据库" in child_biz or "Postgresql库1" in child_biz:
                            if str(getattr(child, "title", "") or "").strip() != lib1_title:
                                child.title = lib1_title
                                persist_title_text(child, title=lib1_title)
                                changed = True
                            body = str(getattr(child, "text", "") or "").strip()
                            if re.match(r"^Postgresql数据库[:：]?\s*$", body, re.I):
                                child.text = ""
                                persist_title_text(child, text="")
                                changed = True
                            fresh, dropped = self._drop_repeated_field_block(list(getattr(child, "children", None) or []))
                            if dropped:
                                child.children = fresh
                                removed.extend(dropped)
                        elif is_lib2_title(child.title):
                            if str(getattr(child, "title", "") or "").strip() != lib2_title:
                                child.title = lib2_title
                                persist_title_text(child, title=lib2_title)
                                changed = True
                            body = str(getattr(child, "text", "") or "").strip()
                            if re.match(r"^库\s*2数据库[:：]?\s*$", body, re.I):
                                child.text = ""
                                persist_title_text(child, text="")
                                changed = True
                            fresh, dropped = self._drop_repeated_field_block(list(getattr(child, "children", None) or []))
                            if dropped:
                                child.children = fresh
                                removed.extend(dropped)
                        kept.append(child)
                    if removed or kept != children:
                        if removed:
                            self._delete_hld_nodes(doc, removed)
                        node.children = kept
                        changed = True
                walk(getattr(node, "children", None) or [])

        walk(roots or [])
        return changed

    def _repair_product_function_chapter(self, doc: HldDoc, roots: List[HldNodeForm]) -> bool:
        """导入时压在「2.2 产品功能」正文里的 1.1.1 / 2.2.2 / 3.3.3 整段，拆回 2.2.1～2.2.6。"""
        target = None

        def find(nodes: List[HldNodeForm]):
            nonlocal target
            for node in nodes or []:
                title = str(getattr(node, "title", "") or "").strip()
                if re.match(r"^\s*2\.2(?:\s|$|[、.．])", title) and "产品功能" in title:
                    target = node
                    return
                find(getattr(node, "children", None) or [])

        find(roots or [])
        if target is None or not target.n_id:
            return False
        children = list(getattr(target, "children", None) or [])
        if any(re.match(r"^\s*2\.2\.[1-6]", str(getattr(child, "title", "") or "").strip()) for child in children):
            return False
        sections = self._split_numbered_blob(getattr(target, "text", "") or "")
        built = []
        for source_title, chapter_title in self._PRODUCT_FN_SECTIONS:
            body = sections.get(self._norm_section_title(source_title))
            if not body:
                return False
            built.append((chapter_title, body))
        figures = [child for child in children if re.match(r"^图\s*2", str(getattr(child, "title", "") or "").strip())]
        others = [child for child in children if child not in figures]
        ordered: List[HldNodeForm] = []
        priority = 0

        def add_chapter(title: str, body: str):
            nonlocal priority
            doc.n_id = int(doc.n_id or 0) + 1
            db.session.add(HldNode(
                doc_id=doc.id,
                n_id=doc.n_id,
                p_id=target.n_id,
                priority=priority,
                title=title,
                text=body,
                img_url="",
                ref_type=None,
                table=None,
            ))
            ordered.append(HldNodeForm(
                doc_id=doc.id,
                n_id=doc.n_id,
                p_id=target.n_id,
                title=title,
                text=body,
                img_url="",
                children=[],
            ))
            priority += 1

        add_chapter(*built[0])
        for figure in figures:
            if figure.n_id:
                row = db.session.execute(
                    select(HldNode).where(HldNode.doc_id == doc.id, HldNode.n_id == figure.n_id)
                ).scalars().first()
                if row:
                    row.priority = priority
            ordered.append(figure)
            priority += 1
        for title, body in built[1:]:
            add_chapter(title, body)
        for child in others:
            if child.n_id:
                row = db.session.execute(
                    select(HldNode).where(HldNode.doc_id == doc.id, HldNode.n_id == child.n_id)
                ).scalars().first()
                if row:
                    row.priority = priority
            ordered.append(child)
            priority += 1
        parent = db.session.execute(
            select(HldNode).where(HldNode.doc_id == doc.id, HldNode.n_id == target.n_id)
        ).scalars().first()
        if parent:
            parent.text = ""
        target.text = ""
        target.children = ordered
        return True

    @staticmethod
    def _is_hld_glossary_title(title: str) -> bool:
        title = str(title or "").strip()
        return "术语" in title and re.match(r"^\s*1\.4(?:\s|$|[、.．])", title) is not None

    def _glossary_pairs_from_nodes(self, nodes) -> List[tuple]:
        from .serv_sds_doc import Server as SdsServer

        found: List[tuple] = []

        def walk(items):
            if found:
                return
            for node in items or []:
                title = str(getattr(node, "title", "") or "").strip()
                if self._is_hld_glossary_title(title):
                    pairs = SdsServer._glossary_pairs_from_table(getattr(node, "table", None))
                    if not pairs:
                        for child in getattr(node, "children", None) or []:
                            pairs = SdsServer._glossary_pairs_from_table(getattr(child, "table", None))
                            if pairs:
                                break
                    if pairs:
                        found.extend(pairs)
                        return
                walk(getattr(node, "children", None) or [])

        walk(nodes or [])
        return found

    @staticmethod
    def _glossary_table(pairs: List[tuple]) -> Table:
        return Table(
            show_header=1,
            headers=[
                TabHeader(code="term", name="术语/缩写"),
                TabHeader(code="definition", name="定义"),
            ],
            rows=[{"term": term, "definition": definition} for term, definition in pairs],
        )

    async def _sds_glossary_pairs(self, sdsdoc_id: int) -> List[tuple]:
        if not sdsdoc_id:
            return []
        sds_row: SdsDoc = db.session.execute(
            select(SdsDoc).where(SdsDoc.id == sdsdoc_id)
        ).scalars().first()
        if not sds_row:
            return []
        from .serv_sds_doc import Server as SdsServer

        sds_resp = await SdsServer().get_sds_doc(sds_row.id, with_tree=True)
        if sds_resp.code != c_ok or not sds_resp.data:
            return []
        return self._glossary_pairs_from_nodes(sds_resp.data.content or [])

    def _apply_sds_glossary_to_hld(self, doc_id: int, roots: List[HldNodeForm], pairs: List[tuple]) -> bool:
        """概要设计 1.4 术语表跟同版本详细设计 1.4。详细设计没有术语时不改原文。"""
        if not pairs:
            return False
        from .serv_sds_doc import Server as SdsServer

        changed = False

        def walk(nodes: List[HldNodeForm]):
            nonlocal changed
            for node in nodes or []:
                title = str(getattr(node, "title", "") or "").strip()
                if self._is_hld_glossary_title(title):
                    current = SdsServer._glossary_pairs_from_table(getattr(node, "table", None))
                    if current != pairs:
                        node.table = self._glossary_table(pairs)
                        changed = True
                        if doc_id and node.n_id:
                            row = db.session.execute(
                                select(HldNode).where(HldNode.doc_id == doc_id, HldNode.n_id == node.n_id)
                            ).scalars().first()
                            if row:
                                row.table = self._serialize_table(node.table)
                    kept = []
                    for child in list(getattr(node, "children", None) or []):
                        child_title = str(getattr(child, "title", "") or "").strip()
                        if re.match(r"^导入表格\d*$", child_title) and SdsServer._is_glossary_table(getattr(child, "table", None)):
                            changed = True
                            if doc_id and child.n_id:
                                db.session.execute(
                                    delete(HldNode).where(HldNode.doc_id == doc_id, HldNode.n_id == child.n_id)
                                )
                            continue
                        kept.append(child)
                    node.children = kept
                walk(getattr(node, "children", None) or [])

        walk(roots or [])
        return changed

    async def sync_hld_from_sds(self, op_user: UserObj, product_id: int, sdsdoc_id: int):
        if not product_id:
            return Resp.resp_err(msg="请选择产品")
        if not sdsdoc_id:
            return Resp.resp_err(msg="请选择详细设计版本")
        sds_row: SdsDoc = db.session.execute(
            select(SdsDoc).where(SdsDoc.id == sdsdoc_id)
        ).scalars().first()
        if not sds_row:
            return Resp.resp_err(msg="未找到详细设计文档")
        if sds_row.product_id != product_id:
            return Resp.resp_err(msg="详细设计与当前产品不一致")
        from .serv_sds_doc import Server as SdsServer

        sds_resp = await SdsServer().get_sds_doc(sds_row.id, with_tree=True)
        if sds_resp.code != c_ok or not sds_resp.data:
            return Resp.resp_err(msg="读取详细设计失败")
        interface_table = None
        field_tables = []
        interface_details = []

        def walk(nodes, parent_titles: List[str] = None):
            nonlocal interface_table
            parent_titles = parent_titles or []
            for node in nodes or []:
                title = str(getattr(node, "title", "") or "").strip()
                chain = parent_titles + ([title] if title else [])
                tbl = self._parse_table(getattr(node, "table", None))
                if tbl and tbl.headers:
                    h0 = self.__table_header_name(tbl, 0)
                    if h0 == "接口设计编号" and interface_table is None:
                        interface_table = self._serialize_table(tbl)
                    elif re.sub(r"\s+", "", h0) in ("字段ID", "FieldID"):
                        field_tables.append({
                            "title": title,
                            "library": self.__detect_field_library(parent_titles),
                            "table": self._serialize_table(tbl),
                        })
                detail_name = self.__parse_interface_detail_title(title)
                detail_text = str(getattr(node, "text", "") or "").strip()
                child_tables = []
                if detail_name:
                    for child in getattr(node, "children", None) or []:
                        child_table = self._parse_table(getattr(child, "table", None))
                        if not child_table or not getattr(child_table, "headers", None):
                            continue
                        h0 = self.__table_header_name(child_table, 0)
                        if h0 in ("字段ID", "Field ID", "接口设计编号"):
                            continue
                        child_tables.append({
                            "title": str(getattr(child, "title", "") or "").strip() or "导入表格",
                            "table": self._serialize_table(child_table),
                        })
                    if detail_text or child_tables:
                        interface_details.append({
                            "name": detail_name,
                            "source_title": title,
                            "text": detail_text,
                            "tables": child_tables,
                        })
                walk(getattr(node, "children", None) or [], chain)

        sds_nodes = sds_resp.data.content or []
        walk(sds_nodes)
        glossary_pairs = self._glossary_pairs_from_nodes(sds_nodes)
        return Resp.resp_ok(data={
            "sds_doc_id": sds_row.id,
            "interface_table": interface_table,
            "interface_details": interface_details,
            "field_tables": field_tables,
            "glossary_table": self._serialize_table(self._glossary_table(glossary_pairs)) if glossary_pairs else None,
        })

    @staticmethod
    def __parse_interface_detail_title(title: str) -> Optional[str]:
        title = str(title or "").strip()
        if not title:
            return None
        m = re.match(r"^\d+(?:\.\d+)+\s+(.+接口)\s*$", title)
        if not m:
            return None
        return m.group(1).strip()
