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


def srs_image_revision(version: str):
    """需求文档版本 A0/A1/A2。无法识别时返回 None。"""
    text = re.sub(r"[\s/]+", "", str(version or "")).upper()
    matched = re.fullmatch(r"A(\d+)", text)
    if not matched:
        return None
    return int(matched.group(1))


def is_srs_a0_image_version(version: str) -> bool:
    return srs_image_revision(version) == 0


def is_srs_topo_struct_locked(version: str) -> bool:
    revision = srs_image_revision(version)
    return revision is not None and revision >= 1


SRS_TOPO_STRUCT_LOCK_MSG = "需求已更新到 A1 及以后，物理拓扑图和系统结构图不能修改"
SRS_FLOW_LOCK_MSG = "已更新到 A1 及以后，网络安全流程图不能修改"
LOCKED_CHART_CATEGORIES = {"img_topo", "img_struct", "img_flow"}

# 产品图示文档版本统一固定 A0，同产品同图表类型只允许一条
DOC_IMAGE_DEFAULT_VERSION = "A0"
DOC_IMAGE_DUPLICATE_MSG = "该产品此图表类型已有图示（文档版本固定 A0），请编辑或删除后再添加"
DOC_IMAGE_VERSION_ONLY_MSG = "产品图示的文档版本固定为 A0，不允许填写其它版本"


def doc_image_duplicate_message() -> str:
    return DOC_IMAGE_DUPLICATE_MSG


def chart_image_lock_message(category: str) -> str:
    if category == "img_flow":
        return SRS_FLOW_LOCK_MSG
    return SRS_TOPO_STRUCT_LOCK_MSG


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
    # 产品图示每类只保留一条（文档版本固定 A0）。指定版本（A0/A1/A2…）找不到时，
    # 回退到本产品该类型的当前图，保证 A1/A2/A3 等版本文档也能拿到产品图示。
    return db.session.execute(base_sql.order_by(desc(DocFile.id)).limit(1)).scalars().first()


class Server(object):
    DOC_IMG_KEYWORDS = {
        "img_topo": ["物理拓扑图", "拓扑图"],
        "img_struct": ["系统结构图", "结构图"],
        "img_flow": ["网络安全流程图", "安全流程图", "流程图"],
    }
    CHART_FILE_CATEGORIES = {"img_topo", "img_struct", "img_flow", "img_ui", "img_home"}

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
    def __extract_doc_version_from_file_name(file_name: str, category: str, product_version: str = ""):
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
        product_token = sanitize_doc_image_token(product_version)
        parts = prefix.split("_")
        if len(parts) >= 2:
            candidate = parts[-1]
            if product_token and candidate == product_token:
                return ""
            return candidate
        if product_token and prefix == product_token:
            return ""
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
        # 兼容已落盘图片路径（例如 SDS 导入后节点图片）；去掉前端缓存参数
        path = img_url[1:] if img_url.startswith("/") else img_url
        path = path.split("?", 1)[0].split("#", 1)[0]
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
        # 物理拓扑图、系统结构图只从需求 A0 回填，A1/A2 不新建图示。
        if category in {"img_topo", "img_struct"}:
            if normalized_doc_version and not is_srs_a0_image_version(normalized_doc_version):
                return
        normalized_product_version = sanitize_doc_image_token(product_version or "")
        if not normalized_product_version:
            product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            normalized_product_version = sanitize_doc_image_token(getattr(product, "full_version", "") or getattr(product, "name", "") or "")

        sql_doc = select(SrsDoc).where(SrsDoc.product_id == product_id)
        if normalized_doc_version:
            sql_doc = sql_doc.where(SrsDoc.version == normalized_doc_version)
        docs = db.session.execute(sql_doc.order_by(desc(SrsDoc.id))).scalars().all()
        heading_category_map = {
            "2.2": "img_topo",
            "2.3": "img_struct",
        }
        for latest_doc in docs:
            latest_doc_version = self.__normalize_doc_version(getattr(latest_doc, "version", "") or "")
            if not latest_doc_version or latest_doc_version.startswith("__deleted"):
                continue
            if category in {"img_topo", "img_struct"} and not is_srs_a0_image_version(latest_doc_version):
                continue
            row = pick_doc_image_file_row(
                product_id,
                category,
                latest_doc_version,
                normalized_product_version,
            )
            # 已有同版本图表文件时不再用 SRS 节点图覆盖：手工编辑和需求文档改图都走 update_doc_file
            if row and str(getattr(row, "file_url", "") or "").strip():
                continue

            nodes = db.session.execute(
                select(SrsNode).where(SrsNode.doc_id == latest_doc.id).order_by(SrsNode.priority, SrsNode.n_id)
            ).scalars().all()
            if not nodes:
                continue
            heading_match = None
            for node in nodes:
                img_url = getattr(node, "img_url", None)
                if not img_url:
                    continue
                img_str = str(img_url).strip()
                img_path = img_str[1:] if img_str.startswith("/") else img_str
                img_path = img_path.split("?", 1)[0].split("#", 1)[0]
                if not img_str.startswith("data:") and not os.path.exists(img_path):
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
                continue

            blob, ext = self.__extract_image_blob_and_ext(heading_match)
            if not blob:
                continue

            if not row:
                row = DocFile(product_id=product_id, category=category)
                db.session.add(row)
                db.session.flush()
            path = os.path.join("data.trace", category, f"{row.id}{ext}")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fs:
                fs.write(blob)
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
        # 网络安全流程图只从详细设计 A0 回填，A1/A2 不新建图示。
        if category == "img_flow":
            if normalized_doc_version and not is_srs_a0_image_version(normalized_doc_version):
                return

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
            if category == "img_flow" and not is_srs_a0_image_version(getattr(doc, "version", "")):
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
        """图表文件页更新后，反向同步到该产品所有版本 SDS 的图片节点。

        产品图示每类只有一张（版本固定 A0），换图后 A0/A1/A2/A3 等所有版本文档都要一起换，
        否则 A1 及以后的文档仍显示旧图。doc_version 保留参数位以兼容调用方。
        """
        if not row or row.category not in self.DOC_IMG_KEYWORDS or not row.product_id or not row.file_url:
            return
        sql_docs = (
            select(SdsDoc)
            .join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            .where(SrsDoc.product_id == row.product_id)
        )
        doc_ids = [doc.id for doc in db.session.execute(sql_docs).scalars().all()]
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
        """图表文件页更新后，反向同步到该产品所有版本 SRS 的 2.2/2.3 图片节点。

        产品图示每类只有一张（版本固定 A0），换图后 A0/A1/A2/A3 等所有版本文档都要一起换。
        doc_version 保留参数位以兼容调用方。
        """
        if not row or row.category not in {"img_topo", "img_struct"} or not row.product_id or not row.file_url:
            return
        sql_docs = select(SrsDoc).where(SrsDoc.product_id == row.product_id)
        doc_ids = [doc.id for doc in db.session.execute(sql_docs).scalars().all()]
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

    @staticmethod
    def __has_upload_file(file) -> bool:
        return bool(file and getattr(file, "filename", None))

    @staticmethod
    def __row_kwargs_from_form(form: DocFileForm):
        data = form.dict() if hasattr(form, "dict") else {}
        keys = ("product_id", "category", "file_name", "file_size", "file_url")
        return {key: data[key] for key in keys if key in data and data[key] is not None}

    def __product_version_of(self, product_id: int) -> str:
        if not product_id:
            return ""
        product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
        return getattr(product, "full_version", "") or getattr(product, "name", "") or ""

    def __build_preserved_doc_file_name(self, row: DocFile, category: str, ext: str, doc_version: str = None, uploaded_name: str = None):
        product_version = self.__product_version_of(getattr(row, "product_id", None) or 0)
        normalized_doc_version = self.__normalize_doc_version(doc_version or "")
        if not normalized_doc_version:
            normalized_doc_version = self.__extract_doc_version_from_file_name(
                getattr(row, "file_name", "") or "", category, product_version
            )
        if normalized_doc_version:
            return build_doc_image_file_name(product_version, normalized_doc_version, category, ext)
        uploaded_name = os.path.basename(str(uploaded_name or "").strip())
        if uploaded_name and category and f"_{category}" in uploaded_name:
            return uploaded_name
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

    @staticmethod
    def __normalize_version_token(value: str) -> str:
        return re.sub(r"[\s/]+", "", str(value or "")).upper()

    def __find_same_version_doc_file(self, product_id: int, category: str, exclude_id=None):
        """文档版本固定 A0，因此同产品 + 同图表类型只允许一条图示。

        历史行的文件名里可能没有 A0（或解析不出文档版本），同样视为已占用，
        避免在旧数据之上再叠加出截图里那种同版本重复。
        """
        if not product_id or not category:
            return None
        sql = select(DocFile).where(DocFile.product_id == product_id, DocFile.category == category)
        if exclude_id:
            sql = sql.where(DocFile.id != exclude_id)
        return db.session.execute(sql.order_by(desc(DocFile.id)).limit(1)).scalars().first()

    async def add_doc_file(self, form: DocFileForm, file):
        try:
            if not self.__has_upload_file(file):
                return Resp.resp_err(msg="请选择文件")
            submitted_doc_version = self.__normalize_doc_version(getattr(form, "doc_version", None) or "")
            if submitted_doc_version and self.__normalize_version_token(submitted_doc_version) != DOC_IMAGE_DEFAULT_VERSION:
                return Resp.resp_err(msg=DOC_IMAGE_VERSION_ONLY_MSG)
            explicit_doc_version = DOC_IMAGE_DEFAULT_VERSION
            if form.category in LOCKED_CHART_CATEGORIES and is_srs_topo_struct_locked(explicit_doc_version):
                return Resp.resp_err(msg=chart_image_lock_message(form.category))
            if self.__find_same_version_doc_file(form.product_id, form.category):
                return Resp.resp_err(msg=doc_image_duplicate_message())
            row = DocFile(**self.__row_kwargs_from_form(form))
            row.id = None
            db.session.add(row)
            db.session.flush()
            file_size, file_url = await save_file(row.category, row.id, file, with_uid=False)
            if file_url:
                row.file_size = file_size
                ext = os.path.splitext(str(getattr(file, "filename", "") or ""))[1] or os.path.splitext(file_url)[1] or ".png"
                row.file_name = self.__build_preserved_doc_file_name(
                    row, row.category, ext,
                    doc_version=explicit_doc_version or None,
                    uploaded_name=str(getattr(file, "filename", "") or ""),
                )
                row.file_url = file_url
                row.update_time = datetime.now()
            self.__sync_doc_nodes_from_doc_file(row, explicit_doc_version or None)
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
            category = form.category or row.category
            product_version = self.__product_version_of(row.product_id or 0)
            old_doc_version = self.__extract_doc_version_from_file_name(row.file_name, category, product_version)
            submitted_doc_version = self.__normalize_doc_version(getattr(form, "doc_version", None) or "")
            if submitted_doc_version and self.__normalize_version_token(submitted_doc_version) != DOC_IMAGE_DEFAULT_VERSION:
                return Resp.resp_err(msg=DOC_IMAGE_VERSION_ONLY_MSG)
            # 产品图示文档版本统一固定 A0，编辑仅允许换图，不允许改版本
            next_doc_version = DOC_IMAGE_DEFAULT_VERSION
            # 编辑时若把图示挪到另一个产品，目标产品下同类型已有图示则拒绝，避免换产品后出现重复
            next_product_id = form.product_id or row.product_id
            if next_product_id != row.product_id and self.__find_same_version_doc_file(
                next_product_id, category, exclude_id=row.id
            ):
                return Resp.resp_err(msg=doc_image_duplicate_message())
            if category in LOCKED_CHART_CATEGORIES and (
                is_srs_topo_struct_locked(next_doc_version) or is_srs_topo_struct_locked(old_doc_version)
            ):
                return Resp.resp_err(msg=chart_image_lock_message(category))
            skip_keys = {"id", "doc_version", "srsdoc_version", "product_name", "product_version", "product_type_code", "create_time"}
            for key, value in form.dict().items():
                if key in skip_keys or value is None:
                    continue
                if not hasattr(row, key):
                    continue
                setattr(row, key, value)
            if self.__has_upload_file(file):
                file_size, file_url = await save_file(category, row.id, file, with_uid=False)
                if file_url:
                    row.file_size = file_size
                    ext = os.path.splitext(str(getattr(file, "filename", "") or ""))[1] or os.path.splitext(file_url)[1] or ".png"
                    row.file_url = file_url
                    row.update_time = datetime.now()
            ext = os.path.splitext(str(row.file_name or row.file_url or "") or "")[1] or ".png"
            row.file_name = self.__build_preserved_doc_file_name(
                row, category, ext,
                doc_version=next_doc_version or None,
                uploaded_name=str(getattr(file, "filename", "") or "") if self.__has_upload_file(file) else "",
            )
            self.__sync_doc_nodes_from_doc_file(row, next_doc_version or None)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def get_doc_file(self, id):
        sql = select(DocFile, Product).outerjoin(Product, DocFile.product_id == Product.id).where(DocFile.id == id)
        result = db.session.execute(sql).first()
        if not result:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        row, row_prd = result
        obj = DocFileObj(**row.dict())
        if row_prd:
            obj.product_id = row_prd.id
            obj.product_name = row_prd.name
            obj.product_type_code = row_prd.type_code
            obj.product_version = row_prd.full_version
        obj.doc_version = self.__extract_doc_version_from_file_name(
            obj.file_name, obj.category, getattr(row_prd, "full_version", "") if row_prd else ""
        )
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
        # 与产品列表同一范围：QA/RA/开发/测试/模型/数据/产品经理只看勾选或本人创建的产品图
        from .serv_product import product_scope_ids
        scope_ids = product_scope_ids(op_user) if op_user else None
        if scope_ids is not None:
            sql = sql.where(Product.id.in_(scope_ids or [-1]))
        elif category not in self.CHART_FILE_CATEGORIES and not product_id and op_user and op_user.id != 1:
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
            obj.doc_version = self.__extract_doc_version_from_file_name(
                obj.file_name, obj.category, getattr(row_prd, "full_version", "") if row_prd else ""
            )
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
