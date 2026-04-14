import logging
import base64
import os
import re
from typing import List, Tuple
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..model.srs_doc import SrsDoc, SrsNode
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

    def __node_context_text(self, node: SrsNode, node_map: dict):
        texts = []
        cur = node
        safety = 0
        while cur and safety < 100:
            title = self.__normalize_text(getattr(cur, "title", "") or "")
            if title:
                texts.append(title)
            p_id = getattr(cur, "p_id", 0) or 0
            if p_id == 0:
                break
            cur = node_map.get(p_id)
            safety += 1
        texts.reverse()
        return " ".join(texts)

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

        blob, ext = self.__extract_data_url_blob(matched_data_url)
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
            # 兜底：已有SRS文档但尚未生成图表文件记录时，按需自动回填一次
            self.__backfill_doc_file_from_srs(product_id, category)
    
        sql = select(DocFile, Product).outerjoin(Product, DocFile.product_id == Product.id)
        if category:
            sql = sql.where(DocFile.category == category)
        if product_id > 0:
            sql = sql.where(Product.id == product_id)
        if file_name:
            sql = sql.where(DocFile.file_name.like(f"%{file_name}%"))
        if not product_id and op_user and op_user.id != 1:
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
