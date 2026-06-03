import logging
import base64
import os
import re
from datetime import datetime
from typing import Any
from typing import List, Tuple
from sqlalchemy import select, delete, func, or_
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..model.srs_doc import SrsDoc, SrsNode
from ..model.sds_doc import SdsDoc, SdsNode
from ..model.product import Product, UserProd
from ..obj.tobj_role import Roles
from ..obj.vobj_doc_file import DocFileObj
from ..model.doc_file import DocFile
from ..obj.tobj_doc_file import DocFileForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db, save_file

logger = logging.getLogger(__name__)


def sanitize_doc_image_token(value: str) -> str:
    token = re.sub(r"[^\w.\-]+", "_", str(value or "").strip())
    return token.strip("_") or ""


def build_doc_image_file_prefix(product_version: str = "", doc_version: str = "") -> str:
    product_token = sanitize_doc_image_token(product_version)
    doc_token = sanitize_doc_image_token(doc_version)
    if product_token and doc_token:
        return f"{product_token}_{doc_token}"
    return doc_token or product_token or "doc"


def build_doc_image_file_name(product_version: str, doc_version: str, category: str, ext: str) -> str:
    normalized_ext = ext if str(ext or "").startswith(".") else f".{ext or 'png'}"
    return f"{build_doc_image_file_prefix(product_version, doc_version)}_{category}{normalized_ext}"


def pick_doc_image_file_row(
    product_id: int,
    category: str,
    doc_version: str = "",
    product_version: str = "",
):
    if not product_id or not category:
        return None
    base_sql = select(DocFile).where(DocFile.product_id == product_id, DocFile.category == category)
    doc_token = sanitize_doc_image_token(doc_version)
    product_token = sanitize_doc_image_token(product_version)
    candidates = []
    if product_token and doc_token:
        candidates.append(f"{product_token}_{doc_token}_{category}%")
    if doc_token:
        candidates.append(f"{doc_token}_{category}%")
        candidates.append(f"%_{doc_token}_{category}%")
    for pattern in candidates:
        row = db.session.execute(
            base_sql.where(DocFile.file_name.like(pattern)).order_by(desc(DocFile.id)).limit(1)
        ).scalars().first()
        if row:
            return row
    return db.session.execute(base_sql.order_by(desc(DocFile.id)).limit(1)).scalars().first()


class Server(object):
    DOC_IMG_KEYWORDS = {
        "img_topo": ["物理拓扑图", "拓扑图"],
        "img_struct": ["系统结构图", "结构图"],
        "img_flow": ["网络安全流程图", "安全流程图", "流程图"],
    }

    @staticmethod
    def __normalize_text(value):
        return (value or "").replace("\xa0", " ").strip()

    @staticmethod
    def __normalize_for_match(value):
        txt = (value or "").replace("\xa0", " ").strip().lower()
        return re.sub(r"\s+", "", txt)

    @staticmethod
    def __normalize_file_no(value):
        return str(value or "").strip()

    @staticmethod
    def __normalize_doc_version(value):
        return str(value or "").strip()

    @staticmethod
    def __extract_doc_version_from_file_name(file_name: str, category: str):
        name = str(file_name or "").strip()
        cat = str(category or "").strip()
        if not name or not cat:
            return ""
        cat_re = re.escape(cat)
        matched = re.match(rf"^(.+?)_{cat_re}(?:\.[A-Za-z0-9]+)?$", name)
        if not matched:
            return ""
        prefix = str(matched.group(1) or "").strip()
        if not prefix:
            return ""
        parts = prefix.split("_")
        if len(parts) >= 2:
            return parts[-1]
        return prefix

    @staticmethod
    def __extract_data_url_blob(data_url: str):
        if not data_url or not str(data_url).startswith("data:"):
            return None, None
        matched = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url, re.S)
        if not matched:
            return None, None
        mime = matched.group(1).lower()
        b64 = matched.group(2)
        ext_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/gif": ".gif",
            "image/bmp": ".bmp",
            "image/webp": ".webp",
        }
        ext = ext_map.get(mime, ".png")
        try:
            blob = base64.b64decode(b64)
        except Exception:
            return None, None
        return blob, ext

    def __node_context_text(self, node: Any, node_map: dict):
        texts = []
        cur = node
        safety = 0
        while cur and safety < 100:
            title = self.__normalize_text(getattr(cur, "title", "") or "")
            label = self.__normalize_text(getattr(cur, "label", "") or "")
            text = self.__normalize_text(getattr(cur, "text", "") or "")
            if title:
                texts.append(title)
            if label:
                texts.append(label)
            # 只取正文首行用于语义匹配，避免上下文过长
            if text:
                texts.append(text.splitlines()[0][:120])
            p_id = getattr(cur, "p_id", 0) or 0
            if p_id == 0:
                break
            cur = node_map.get(p_id)
            safety += 1
        texts.reverse()
        return " ".join(texts)

    def __contains_keywords(self, text: str, keywords: List[str]):
        norm_text = self.__normalize_for_match(text)
        for word in keywords or []:
            if self.__normalize_for_match(word) in norm_text:
                return True
        return False

    def __match_score(self, category: str, text: str):
        norm = self.__normalize_for_match(text)
        if not norm:
            return 0
        if category == "img_flow":
            # 按“名称优先”匹配：网络安全流程图 > 安全流程图 > 泛流程图
            if "网络安全流程图" in norm:
                return 1000
            if "安全流程图" in norm:
                return 800
            if ("网络安全" in norm) and ("流程图" in norm):
                return 700
            if "流程图" in norm:
                return 100
            return 0
        if category == "img_topo":
            if "物理拓扑图" in norm:
                return 1000
            if "拓扑图" in norm:
                return 500
            return 0
        if category == "img_struct":
            if "系统结构图" in norm or "体系结构图" in norm:
                return 1000
            if "结构图" in norm:
                return 500
            return 0
        return 0

    def __extract_image_blob_and_ext(self, img_url: str):
        if not img_url:
            return None, None
        img_url = str(img_url).strip()
        if img_url.startswith("data:"):
            return self.__extract_data_url_blob(img_url)
        # 兼容已落盘图片路径（例如 SDS 导入后节点图片）
        path = img_url
        if not os.path.exists(path):
            return None, None
        ext = os.path.splitext(path)[1] or ".png"
        try:
            with open(path, "rb") as fs:
                blob = fs.read()
            return blob, ext
        except Exception:
            return None, None

    def __pick_sds_flow_img_by_name(self, nodes: List[SdsNode]):
        if not nodes:
            return None
        keywords = self.DOC_IMG_KEYWORDS.get("img_flow") or []
        node_map = {row.n_id: row for row in nodes}
        children_map = {}
        for row in nodes:
            p_id = getattr(row, "p_id", 0) or 0
            children_map.setdefault(p_id, []).append(row)

        # 1) 直接命中：节点自身带图，且标题/标签/正文包含“网络安全流程图”等关键词
        best_img = None
        best_score = 0
        for row in nodes:
            img_url = getattr(row, "img_url", None)
            if not img_url:
                continue
            own_text = " ".join([
                self.__normalize_text(getattr(row, "title", "") or ""),
                self.__normalize_text(getattr(row, "label", "") or ""),
                self.__normalize_text(getattr(row, "text", "") or ""),
            ])
            own_score = self.__match_score("img_flow", own_text)
            if own_score > best_score:
                best_score = own_score
                best_img = img_url
        if best_img:
            return best_img

        # 2) 同级命中：一个子节点是“网络安全流程图”标题，另一个子节点（常为“导入图片xx”）携带图片
        for p_id, siblings in children_map.items():
            has_flow_marker = False
            for sib in siblings:
                marker_text = " ".join([
                    self.__normalize_text(getattr(sib, "title", "") or ""),
                    self.__normalize_text(getattr(sib, "label", "") or ""),
                    self.__normalize_text(getattr(sib, "text", "") or ""),
                ])
                if self.__contains_keywords(marker_text, keywords):
                    has_flow_marker = True
                    break
            if not has_flow_marker:
                continue

            for sib in siblings:
                img_url = getattr(sib, "img_url", None)
                if img_url:
                    return img_url

            parent = node_map.get(p_id)
            if parent and getattr(parent, "img_url", None):
                return getattr(parent, "img_url")

        # 3) 上下文兜底：按祖先上下文关键词评分
        for row in nodes:
            img_url = getattr(row, "img_url", None)
            if not img_url:
                continue
            ctx_text = self.__node_context_text(row, node_map)
            score = self.__match_score("img_flow", ctx_text)
            if score > best_score:
                best_score = score
                best_img = img_url
        return best_img

    def __backfill_doc_file_from_srs(self, product_id: int, category: str, doc_version: str = None, product_version: str = None):
        if not product_id or category not in self.DOC_IMG_KEYWORDS:
            return
        normalized_doc_version = self.__normalize_doc_version(doc_version)
        normalized_product_version = sanitize_doc_image_token(product_version or "")
        if not normalized_product_version:
            product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            normalized_product_version = sanitize_doc_image_token(getattr(product, "full_version", "") or getattr(product, "name", "") or "")
        row = pick_doc_image_file_row(
            product_id,
            category,
            normalized_doc_version,
            normalized_product_version,
        )

        sql_doc = select(SrsDoc).where(SrsDoc.product_id == product_id)
        if normalized_doc_version:
            sql_doc = sql_doc.where(SrsDoc.version == normalized_doc_version)
        latest_doc = db.session.execute(sql_doc.order_by(desc(SrsDoc.id)).limit(1)).scalars().first()
        if not latest_doc:
            return

        nodes = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == latest_doc.id).order_by(SrsNode.priority, SrsNode.n_id)
        ).scalars().all()
        if not nodes:
            return
        node_map = {row.n_id: row for row in nodes}
        keywords = self.DOC_IMG_KEYWORDS.get(category) or []
        heading_category_map = {
            "2.2": "img_topo",
            "2.3": "img_struct",
        }
        heading_match = None
        for node in nodes:
            img_url = getattr(node, "img_url", None)
            if not img_url:
                continue
            img_str = str(img_url).strip()
            if not img_str.startswith("data:") and not os.path.exists(img_str):
                continue
            title = self.__normalize_text(getattr(node, "title", "") or "")
            if re.match(r"^导入图片\d*$", title):
                continue
            heading_no = re.match(r"^(\d+(?:\.\d+)*)", title)
            heading_no = heading_no.group(1) if heading_no else ""
            if heading_category_map.get(heading_no) == category or getattr(node, "ref_type", None) == category:
                heading_match = img_url
        # 章节节点无图时不覆盖 doc_file，避免手工上传后被空节点或导入图片子节点冲掉
        if not heading_match:
            return
        matched_data_url = heading_match

        blob, ext = self.__extract_image_blob_and_ext(matched_data_url)
        if not blob:
            return

        if not row:
            row = DocFile(product_id=product_id, category=category)
            db.session.add(row)
            db.session.flush()
        path = os.path.join("data.trace", category, f"{row.id}{ext}")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fs:
            fs.write(blob)
        latest_doc_version = self.__normalize_doc_version(getattr(latest_doc, "version", "") or "")
        row.file_name = build_doc_image_file_name(
            normalized_product_version,
            latest_doc_version,
            category,
            ext,
        )
        row.file_size = len(blob)
        row.file_url = path
        db.session.commit()

    def __backfill_doc_file_from_sds(self, product_id: int, category: str, doc_version: str = None):
        if not product_id or category not in self.DOC_IMG_KEYWORDS:
            return
        normalized_doc_version = self.__normalize_doc_version(doc_version)

        sql_docs = select(SdsDoc).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id).where(SrsDoc.product_id == product_id)
        if normalized_doc_version:
            sql_docs = sql_docs.where(SdsDoc.version == normalized_doc_version)
        docs = db.session.execute(sql_docs.order_by(desc(SdsDoc.id))).scalars().all()
        if not docs:
            return

        matched_img = None
        matched_doc = None
        keywords = self.DOC_IMG_KEYWORDS.get(category) or []
        # 按 SDS 文档版本倒序扫描：流程图优先按“图名称/同级节点”精确匹配
        for doc in docs:
            nodes = db.session.execute(
                select(SdsNode).where(SdsNode.doc_id == doc.id).order_by(SdsNode.priority, SdsNode.n_id)
            ).scalars().all()
            if not nodes:
                continue
            if category == "img_flow":
                flow_img = self.__pick_sds_flow_img_by_name(nodes)
                if flow_img:
                    matched_img = flow_img
                    matched_doc = doc
                    break
            node_map = {row.n_id: row for row in nodes}
            best_img = None
            best_score = 0
            for row in nodes:
                img_url = getattr(row, "img_url", None)
                if not img_url:
                    continue
                ctx_text = self.__node_context_text(row, node_map)
                if self.__contains_keywords(ctx_text, keywords):
                    score = self.__match_score(category, ctx_text)
                    if score > best_score:
                        best_score = score
                        best_img = img_url
            if best_img:
                matched_img = best_img
                matched_doc = doc
                break
        if not matched_img:
            return

        matched_doc_version = self.__normalize_doc_version(getattr(matched_doc, "version", "") or "")
        matched_path = str(matched_img or "").strip()
        if matched_path.startswith("/"):
            matched_path = matched_path[1:]
        ext = os.path.splitext(matched_path)[1] or ".png"
        file_size = os.path.getsize(matched_path) if matched_path and os.path.exists(matched_path) else 0
        if not matched_path or not file_size:
            blob, blob_ext = self.__extract_image_blob_and_ext(matched_img)
            if not blob:
                return
            ext = blob_ext

        row = pick_doc_image_file_row(product_id, category, matched_doc_version)
        if row is None:
            row = DocFile(product_id=product_id, category=category)
            db.session.add(row)
            db.session.flush()

        if not matched_path or not file_size:
            matched_path = os.path.join("data.trace", category, f"{row.id}{ext}")
            os.makedirs(os.path.dirname(matched_path), exist_ok=True)
            with open(matched_path, "wb") as fs:
                fs.write(blob)
            file_size = len(blob)

        file_name_prefix = matched_doc_version or category
        row.file_name = f"{file_name_prefix}_{category}{ext}"
        row.file_size = file_size
        row.file_url = matched_path
        row.update_time = datetime.now()
        db.session.commit()

    def __sync_sds_nodes_from_doc_file(self, row: DocFile, doc_version: str = None):
        """图表文件页更新后，反向同步到同产品/同版本 SDS 图片节点。"""
        if not row or row.category not in self.DOC_IMG_KEYWORDS or not row.product_id or not row.file_url:
            return
        normalized_doc_version = self.__normalize_doc_version(
            doc_version or self.__extract_doc_version_from_file_name(row.file_name, row.category)
        )
        sql_docs = (
            select(SdsDoc.id)
            .join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            .where(SrsDoc.product_id == row.product_id)
        )
        if normalized_doc_version:
            sql_docs = sql_docs.where(SdsDoc.version == normalized_doc_version)
        doc_ids = [doc_id for doc_id in db.session.execute(sql_docs).scalars().all()]
        if not doc_ids:
            return
        img_url = str(row.file_url or "").strip()
        if img_url and not img_url.startswith("/"):
            img_url = f"/{img_url}"
        nodes = db.session.execute(
            select(SdsNode)
            .where(SdsNode.doc_id.in_(doc_ids))
            .where(SdsNode.ref_type == row.category)
        ).scalars().all()
        for node in nodes:
            node.img_url = img_url

    def __sync_srs_nodes_from_doc_file(self, row: DocFile, doc_version: str = None):
        """图表文件页更新后，反向同步到同产品/同版本 SRS 图片节点。"""
        if not row or row.category not in {"img_topo", "img_struct"} or not row.product_id or not row.file_url:
            return
        normalized_doc_version = self.__normalize_doc_version(
            doc_version or self.__extract_doc_version_from_file_name(row.file_name, row.category)
        )
        sql_docs = select(SrsDoc.id).where(SrsDoc.product_id == row.product_id)
        if normalized_doc_version:
            sql_docs = sql_docs.where(SrsDoc.version == normalized_doc_version)
        doc_ids = [doc_id for doc_id in db.session.execute(sql_docs).scalars().all()]
        if not doc_ids:
            return
        img_url = str(row.file_url or "").strip()
        if img_url and not img_url.startswith("/"):
            img_url = f"/{img_url}"
        heading_by_category = {
            "img_topo": "2.2",
            "img_struct": "2.3",
        }
        heading = heading_by_category.get(row.category, "")
        nodes = db.session.execute(
            select(SrsNode)
            .where(SrsNode.doc_id.in_(doc_ids))
            .where(or_(
                SrsNode.ref_type == row.category,
                SrsNode.title.like(f"{heading}%") if heading else False,
            ))
        ).scalars().all()
        for node in nodes:
            title = str(getattr(node, "title", "") or "").strip()
            heading_match = bool(heading and re.match(rf"^\s*{re.escape(heading)}(?:\s+|[、．]+|(?=[\u4e00-\u9fffA-Za-z])|$)", title))
            if getattr(node, "ref_type", None) != row.category and not heading_match:
                continue
            node.ref_type = row.category
            node.img_url = img_url

    def __sync_doc_nodes_from_doc_file(self, row: DocFile, doc_version: str = None):
        self.__sync_sds_nodes_from_doc_file(row, doc_version)
        self.__sync_srs_nodes_from_doc_file(row, doc_version)

    def __build_preserved_doc_file_name(self, row: DocFile, category: str, ext: str, doc_version: str = None):
        normalized_doc_version = self.__normalize_doc_version(
            doc_version or self.__extract_doc_version_from_file_name(getattr(row, "file_name", "") or "", category)
        )
        product_version = ""
        if getattr(row, "product_id", None):
            product = db.session.execute(select(Product).where(Product.id == row.product_id)).scalars().first()
            product_version = getattr(product, "full_version", "") or getattr(product, "name", "") or ""
        if normalized_doc_version:
            return build_doc_image_file_name(product_version, normalized_doc_version, category, ext)
        return getattr(row, "file_name", None) or build_doc_image_file_name(product_version, "", category, ext)

    def __fallback_doc_version_for_file(self, row: DocFile):
        if not row or row.category not in self.DOC_IMG_KEYWORDS or not row.product_id:
            return ""
        if row.category == "img_flow":
            return db.session.execute(
                select(SdsDoc.version)
                .join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
                .where(SrsDoc.product_id == row.product_id)
                .order_by(desc(SdsDoc.id))
                .limit(1)
            ).scalar() or ""
        return db.session.execute(
            select(SrsDoc.version)
            .where(SrsDoc.product_id == row.product_id)
            .order_by(desc(SrsDoc.id))
            .limit(1)
        ).scalar() or ""

    async def add_doc_file(self, form: DocFileForm, file):
        try:           
            row = DocFile(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.flush()
            file_size, file_url = await save_file(row.category, row.id, file, with_uid=False)
            if file_url:
                row.file_size = file_size
                ext = os.path.splitext(str(getattr(file, "filename", "") or ""))[1] or os.path.splitext(file_url)[1] or ".png"
                row.file_name = self.__build_preserved_doc_file_name(row, row.category, ext)
                row.file_url = file_url
                row.update_time = datetime.now()
            self.__sync_doc_nodes_from_doc_file(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_doc_file(self, id):
        db.session.execute(delete(DocFile).where(DocFile.id == id))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_doc_file(self, form: DocFileForm, file):
        try:
            sql = select(DocFile).where(DocFile.id == form.id)
            row:DocFile = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict().items():
                if key == "id" or value is None:
                    continue
                setattr(row, key, value)
            category = form.category or row.category 
            old_doc_version = (
                self.__extract_doc_version_from_file_name(row.file_name, category)
                or self.__fallback_doc_version_for_file(row)
            )
            file_size, file_url = await save_file(category, row.id, file, with_uid=False)  
            if file_url:
                row.file_size = file_size
                ext = os.path.splitext(str(getattr(file, "filename", "") or ""))[1] or os.path.splitext(file_url)[1] or ".png"
                row.file_name = self.__build_preserved_doc_file_name(row, category, ext, old_doc_version)
                row.file_url = file_url
                row.update_time = datetime.now()
            self.__sync_doc_nodes_from_doc_file(row, old_doc_version)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def get_doc_file(self, id):
        sql = select(DocFile).where(DocFile.id == id)
        row = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        obj = DocFileObj(**row.dict())
        return Resp.resp_ok(data=obj)

    async def list_doc_file(self, op_user: UserObj, category: str=None, product_id: int = 0, file_name: str = None, file_no: str = None, doc_version: str = None, product_name: str = None, product_version: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
        normalized_doc_version = self.__normalize_doc_version(doc_version)
        if product_id > 0 and not product_version:
            row_prd = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            if row_prd:
                product_version = getattr(row_prd, "full_version", "") or ""
        if category in self.DOC_IMG_KEYWORDS and product_id > 0:
            # 图源规则：
            # - 网络安全流程图：从详细设计（SDS）节点取图
            # - 其他图：保持原有 SRS 兜底逻辑
            if category == "img_flow":
                self.__backfill_doc_file_from_sds(product_id, category, normalized_doc_version)
            else:
                self.__backfill_doc_file_from_srs(
                    product_id,
                    category,
                    normalized_doc_version,
                    product_version,
                )
    
        sql = select(DocFile, Product).outerjoin(Product, DocFile.product_id == Product.id)
        if category:
            sql = sql.where(DocFile.category == category)
        if product_id > 0:
            sql = sql.where(Product.id == product_id)
        if product_name:
            sql = sql.where(Product.name == product_name)
        if product_version:
            sql = sql.where(Product.full_version == product_version)
        if file_name:
            sql = sql.where(DocFile.file_name.like(f"%{file_name}%"))
        if normalized_doc_version:
            doc_token = sanitize_doc_image_token(normalized_doc_version)
            product_token = sanitize_doc_image_token(product_version or "")
            patterns = []
            if product_token and doc_token and category:
                patterns.append(f"{product_token}_{doc_token}_{category}%")
            if doc_token and category:
                patterns.append(f"{doc_token}_{category}%")
                patterns.append(f"%_{doc_token}_{category}%")
            if patterns:
                sql = sql.where(or_(*[DocFile.file_name.like(pattern) for pattern in patterns]))
        # 数据可见范围（与产品列表口径一致）：
        # - 产品经理：仅自己创建的产品对应的图（含物理拓扑/体系结构/网络安全流程三类图表页面）
        # - 其它非超管：三类图表页面仍显示全部；其余按用户产品关系限制
        if op_user and op_user.id != 1 and op_user.role_code == Roles.product_manager.value.code:
            sql = sql.where(Product.create_user_id == op_user.id)
        elif category not in self.DOC_IMG_KEYWORDS and not product_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))
        
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(DocFile.id))
        rows: List[Tuple[DocFile, Product]] = db.session.execute(sql).all()
        objs = []
        for row, row_prd in rows:
            obj = DocFileObj(**row.dict())
            if row_prd:
                obj.product_id = row_prd.id
                obj.product_name = row_prd.name
                obj.product_type_code = row_prd.type_code
                obj.product_version = row_prd.full_version
            obj.doc_version = self.__extract_doc_version_from_file_name(obj.file_name, obj.category)
            if not obj.doc_version:
                obj.doc_version = normalized_doc_version or self.__fallback_doc_version_for_file(row)
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
