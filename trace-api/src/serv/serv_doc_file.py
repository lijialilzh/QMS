import logging
import base64
import os
import re
from typing import Any
from typing import List, Tuple
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..model.srs_doc import SrsDoc, SrsNode
from ..model.sds_doc import SdsDoc, SdsNode
from ..model.product import Product, UserProd
from ..obj.vobj_doc_file import DocFileObj
from ..model.doc_file import DocFile
from ..obj.tobj_doc_file import DocFileForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db, save_file

logger = logging.getLogger(__name__)


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

    def __backfill_doc_file_from_srs(self, product_id: int, category: str):
        if not product_id or category not in self.DOC_IMG_KEYWORDS:
            return
        exists = db.session.execute(
            select(DocFile.id).where(DocFile.product_id == product_id, DocFile.category == category).limit(1)
        ).scalar()
        if exists:
            return

        latest_doc = db.session.execute(
            select(SrsDoc).where(SrsDoc.product_id == product_id).order_by(desc(SrsDoc.id)).limit(1)
        ).scalars().first()
        if not latest_doc:
            return

        nodes = db.session.execute(
            select(SrsNode).where(SrsNode.doc_id == latest_doc.id).order_by(SrsNode.priority, SrsNode.n_id)
        ).scalars().all()
        if not nodes:
            return
        node_map = {row.n_id: row for row in nodes}
        keywords = self.DOC_IMG_KEYWORDS.get(category) or []
        matched_data_url = None
        for row in nodes:
            img_url = getattr(row, "img_url", None)
            if not img_url or not str(img_url).startswith("data:"):
                continue
            ctx_text = self.__node_context_text(row, node_map)
            if any(word in ctx_text for word in keywords):
                matched_data_url = img_url

        if not matched_data_url:
            return

        blob, ext = self.__extract_image_blob_and_ext(matched_data_url)
        if not blob:
            return

        new_row = DocFile(product_id=product_id, category=category)
        db.session.add(new_row)
        db.session.flush()
        path = os.path.join("data.trace", category, f"{new_row.id}{ext}")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fs:
            fs.write(blob)
        new_row.file_name = f"{category}{ext}"
        new_row.file_size = len(blob)
        new_row.file_url = path
        db.session.commit()

    def __backfill_doc_file_from_sds(self, product_id: int, category: str):
        if not product_id or category not in self.DOC_IMG_KEYWORDS:
            return
        # 已存在记录时不自动覆盖，避免用户手工上传/替换被“回填逻辑”改回旧图
        exists = db.session.execute(
            select(DocFile.id).where(DocFile.product_id == product_id, DocFile.category == category).limit(1)
        ).scalar()
        if exists:
            return

        docs = db.session.execute(
            select(SdsDoc)
            .join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            .where(SrsDoc.product_id == product_id)
            .order_by(desc(SdsDoc.id))
        ).scalars().all()
        if not docs:
            return

        matched_img = None
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
                break
        if not matched_img:
            return

        blob, ext = self.__extract_image_blob_and_ext(matched_img)
        if not blob:
            return

        row = DocFile(product_id=product_id, category=category)
        db.session.add(row)
        db.session.flush()

        path = os.path.join("data.trace", category, f"{row.id}{ext}")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fs:
            fs.write(blob)
        row.file_name = f"{category}{ext}"
        row.file_size = len(blob)
        row.file_url = path
        db.session.commit()

    async def add_doc_file(self, form: DocFileForm, file):
        try:           
            row = DocFile(**form.dict())
            row.id = None
            db.session.add(row)
            db.session.flush()
            file_size, file_url = await save_file(row.category, row.id, file, with_uid=False)
            if file_url:
                row.file_size = file_size
                row.file_name = file.filename
                row.file_url = file_url
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
            file_size, file_url = await save_file(category, row.id, file, with_uid=False)  
            if file_url:
                row.file_size = file_size
                row.file_name = file.filename
                row.file_url = file_url
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

    async def list_doc_file(self, op_user: UserObj, category: str=None, product_id: int = 0, file_name: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
        if category in self.DOC_IMG_KEYWORDS and product_id > 0:
            # 图源规则：
            # - 网络安全流程图：从详细设计（SDS）节点取图
            # - 其他图：保持原有 SRS 兜底逻辑
            if category == "img_flow":
                self.__backfill_doc_file_from_sds(product_id, category)
            else:
                self.__backfill_doc_file_from_srs(product_id, category)
    
        sql = select(DocFile, Product).outerjoin(Product, DocFile.product_id == Product.id)
        if category:
            sql = sql.where(DocFile.category == category)
        if product_id > 0:
            sql = sql.where(Product.id == product_id)
        if file_name:
            sql = sql.where(DocFile.file_name.like(f"%{file_name}%"))
        # 三类图表页面默认显示所有产品（未选择产品时不按用户产品关系限制）
        if category not in self.DOC_IMG_KEYWORDS and not product_id and op_user and op_user.id != 1:
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
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
