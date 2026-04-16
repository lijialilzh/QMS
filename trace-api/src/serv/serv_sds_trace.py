import logging
import re
import sys
from typing import List, Tuple, Union
from sqlalchemy import select, func, or_, and_
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..obj.node import Node
from ..obj.tobj_sds_doc import SdsNodeForm
from ..model.srs_type import SrsType
from ..model.sds_doc import SdsDoc, SdsNode
from ..model.product import Product, UserProd
from ..model.srs_doc import SrsDoc
from ..model.srs_req import SrsReq
from ..model.sds_trace import SdsTrace
from ..obj.tobj_sds_trace import SdsTraceForm
from ..obj.vobj_sds_trace import SdsTraceObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from .serv_utils.tree_util import find_parent, fix_chapter
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)

default_types ={
    "1": "标准需求",
    "2": "其他需求"
}

NAME_DICT = {
    "图像接收": "DataProcessing",
    "图像存储": "RePACS",
    "图像处理": "DLServer",
    "图像显示": "NeoViewer",
    "图像预测": "DLServer",
}

class Server(object):
    @staticmethod
    def __normalize_name(value: str):
        txt = (value or "").strip()
        txt = re.sub(r"^[\d一二三四五六七八九十零]+([.\-、）)\s]+[\d一二三四五六七八九十零]*)*", "", txt)
        txt = re.sub(r"[\s:：\-_，。；;、,.()（）]+", "", txt)
        return txt.lower()
    
    async def update_sds_trace(self, form: SdsTraceForm):
        try:
            if not form.id:
                row = SdsTrace(**form.dict())
                db.session.add(row)
            else:
                row = db.session.execute(select(SdsTrace).where(SdsTrace.id == form.id)).scalars().first()
                if not row:
                    return Resp.resp_err(msg=ts("msg_obj_null"))
                logger.info("location: %s", form.location)
                for key, value in form.dict().items():
                    logger.info("update: %s: %s", key, value)
                    if key == "id" or value is None:
                        continue
                    setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    def __query_srs_types(self, req_ids):
        results = dict()
        if req_ids:
            sql = select(SrsReq, SrsType).where(SrsReq.type_code == SrsType.type_code).where(SrsReq.id.in_(req_ids))
            rows = db.session.execute(sql).all()
            for row_req, row_type in rows:
                results[row_req.id] = row_type.type_name
        return results
    
    def __resort_rows(self, rows: List[Tuple[SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product]]):
        sorted_rows = []
        for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            type_id = row_type.id if row_type else sys.maxsize
            type_id = -1 if row_req.type_code == "1" else type_id
            type_id = 0 if row_req.type_code == "2" else type_id
            key = (-row_sdsdoc.id, type_id, row_req.code)
            sorted_rows.append((key, (row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product)))
        sorted_rows.sort(key=lambda x: x[0])
        return [x[1] for x in sorted_rows]
    

    def __find_path(self, level: int, sdscode: str, nodes: List[SdsNodeForm], paths: List[str] = None):
        for node in nodes or []:
            npaths = [node.title] if level == 0 else paths + [node.title]
            if node.sds_code == sdscode:
                return npaths, node
            cpaths, cnode = self.__find_path(level + 1, sdscode, node.children, npaths)
            if cnode:
                return cpaths, cnode
        return paths, None
    
    def __find_chapter(self, paths: List[str] = None):
        paths.reverse()
        for path in paths:
            chapter = re.search(r'(?<!\d)(\d+(?:\.\d+)*)(?!\d)', path or "")
            chapter = chapter.group() if chapter else None
            if chapter:
                return chapter

    @staticmethod
    def __extract_chapter_code(value: str):
        txt = (value or "").strip()
        if not txt:
            return None
        matched = re.search(r'(?<!\d)(\d+(?:\.\d+)*)(?!\d)', txt)
        return matched.group(1) if matched else None

    def __find_path_by_names(self, level: int, names: List[str], nodes: List[SdsNodeForm], paths: List[str] = None):
        for node in nodes or []:
            title = getattr(node, "title", "") or ""
            label = getattr(node, "label", "") or ""
            merged = self.__normalize_name(f"{title}{label}")
            npaths = [node.title] if level == 0 else paths + [node.title]
            if merged and any(name and (merged == name or name in merged) for name in names or []):
                return npaths, node
            cpaths, cnode = self.__find_path_by_names(level + 1, names, node.children, npaths)
            if cnode:
                return cpaths, cnode
        return paths, None

    def __fix_location(self, objs:List[SdsTraceObj]):
        doc_dict = dict()
        n_dict = dict()
        p_dict = dict()
        for obj in objs:
            doc_dict.setdefault(obj.doc_id, []).append(obj)

        doc_ids = list(doc_dict.keys())
        sql = select(SdsNode).where(SdsNode.ref_type == "sds_reqds").where(SdsNode.doc_id.in_(doc_ids))
        key_nodes = db.session.execute(sql).scalars().all()
        key_nodes_dict = dict()
        for node in key_nodes:
            key_nodes_dict[node.doc_id] = node.title
        
        for doc_id, objs in doc_dict.items():
            p_title = key_nodes_dict.get(doc_id) or ""
            parents = dict()
            for obj in objs:
                with_chapter = 1 if obj.sub_function else 0
                title = obj.name if obj.sub_function else None
                node = Node(ref_id=obj.id, with_chapter=with_chapter, title=title, children=[])
                p_node = find_parent(SdsNodeForm, [obj.module, obj.function, obj.sub_function], parents)
                p_node.children.append(node)
                p_dict[node.ref_id] = p_node
                n_dict[node.ref_id] = node
            p_nodes = [node for key, node in parents.items() if node.level == 0]
            fix_chapter(p_title, p_nodes)
            for obj in objs:
                if obj.location or obj.type_code == "2":
                    continue
                n_node = n_dict.get(obj.id)
                p_node = p_dict.get(obj.id)
                paths = [n_node.title]
                while p_node:
                    paths.append(p_node.title)
                    p_node = p_dict.get(p_node.ref_id)
                obj.location = self.__find_chapter(paths)
                logger.info("location: %s %s", obj.sds_code, obj.location)

    def __query_doc_tree(self, doc_ids):
        doc_trees = dict()
        if not doc_ids:
            return doc_trees
        
        sql = select(SdsNode).where(SdsNode.doc_id.in_(doc_ids)).order_by(SdsNode.priority)
        nodes: List[SdsNode] = db.session.execute(sql).scalars().all()
        doc_nodes = dict()
        for node in nodes:
            doc_nodes.setdefault(node.doc_id, []).append(node)

        for doc_id, nodes in doc_nodes.items():
            tree = []
            objs_dict = dict()
            objs = []
            for node in nodes:
                obj = SdsNodeForm(children=[], doc_id=node.doc_id, n_id=node.n_id, p_id=node.p_id,
                                title=node.title, label=node.label, img_url=node.img_url, text=node.text, ref_type=node.ref_type, sds_code=node.sds_code)
                objs_dict[obj.n_id] = obj
                objs.append(obj)
            for obj in objs:
                if obj.p_id == 0:
                    tree.append(obj)
                else:
                    p_obj = objs_dict.get(obj.p_id)
                    if not p_obj:
                        logger.warning("ignoreNode:: %s %s %s", obj.doc_id, obj.p_id, obj.n_id)
                        continue
                    p_obj.children.append(obj)
            doc_trees[doc_id] = tree
        return doc_trees

    async def list_sds_trace(self, op_user: UserObj, prod_id: int = None, doc_id: int = None, type_code: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 

        sql = select(SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product)
        sql = sql.outerjoin(SrsType, SrsReq.type_code == SrsType.type_code)
        sql = sql.outerjoin(SrsDoc, SrsReq.doc_id == SrsDoc.id)
        sql = sql.outerjoin(Product, SrsDoc.product_id == Product.id)
        
        sql = sql.where(SdsTrace.doc_id == SdsDoc.id).where(SdsTrace.req_id == SrsReq.id).where(SdsDoc.srsdoc_id == SrsDoc.id)
        sql = sql.where(or_(SrsType.doc_id == SrsReq.doc_id, SrsReq.type_code.in_(["1", "2"])))
        if prod_id:
            sql = sql.where(Product.id == prod_id)
        if doc_id:
            sql = sql.where(SdsDoc.id == doc_id)
        if type_code:
            sql = sql.where(SrsReq.type_code == type_code)
        if not prod_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))

        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(Product.id), desc(SdsDoc.id), SrsReq.code)
        rows: List[Tuple[SdsTrace, SrsReq, SrsType, SdsDoc, SrsDoc, Product]] = db.session.execute(sql).all()
        rows = self.__resort_rows(rows)
        req_ids = [row_req.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows]
        type_names = self.__query_srs_types(req_ids)
        doc_ids = list(set([row_sdsdoc.id for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows]))
        doc_trees = self.__query_doc_tree(doc_ids)
        objs = []
        for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            obj = SdsTraceObj(**row_reqd.dict())
            obj.srs_code = row_req.code
            obj.name = row_req.sub_function or row_req.function or row_req.module
            obj.module = row_req.module
            obj.function = row_req.function
            obj.sub_function = row_req.sub_function
            if row_srsdoc:
                obj.srsdoc_version = row_srsdoc.version
            if row_sdsdoc:
                obj.sdsdoc_version = row_sdsdoc.version
            if row_product:
                obj.product_name = row_product.name
                obj.product_version = row_product.full_version
            obj.type_code = row_req.type_code
            obj.type_name = type_names.get(row_req.id) or default_types.get(row_req.type_code) or row_req.type_code
            obj.chapter = NAME_DICT.get(obj.chapter) or obj.chapter
            # 章节号自动回填：优先从SDS树里按 sds_code 反推（如 2.1 / 5.6.3）
            doc_tree = doc_trees.get(row_sdsdoc.id)
            paths, _ = self.__find_path(0, row_reqd.sds_code, doc_tree, [])
            if not paths:
                names = []
                for txt in [obj.name, obj.sub_function, obj.function, obj.module]:
                    n = self.__normalize_name(txt)
                    if n and n not in names:
                        names.append(n)
                if names:
                    paths, _ = self.__find_path_by_names(0, names, doc_tree, [])
            chapter_from_tree = self.__find_chapter((paths or []).copy()) if paths else None
            if chapter_from_tree:
                obj.chapter = chapter_from_tree
            if not obj.location:
                obj.location = self.__find_chapter(paths)
                logger.info("location: %s %s", row_reqd.sds_code, obj.location)
            obj.chapter = self.__extract_chapter_code(obj.chapter) or None
            obj.location = self.__extract_chapter_code(obj.location) or None
            objs.append(obj)
        self.__fix_location(objs)
        for obj in objs:
            obj.location = self.__extract_chapter_code(obj.location) or None
            chapter_code = self.__extract_chapter_code(obj.chapter)
            if chapter_code:
                obj.chapter = chapter_code
            elif obj.location:
                obj.chapter = obj.location
            else:
                obj.chapter = None
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        
    async def get_sds_trace(self, id: int):
        sql = select(SdsTrace, SrsReq).join(SrsReq, SrsReq.id == SdsTrace.req_id).where(SdsTrace.id == id)
        row: Tuple[SdsTrace, SrsReq] = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        row_reqd, row_req = row
        name = row_req.sub_function or row_req.function or row_req.module
        obj = SdsTraceObj(**row_reqd.dict(), srs_code=row_req.code, name=name)
        obj.chapter = NAME_DICT.get(obj.chapter) or obj.chapter
        return Resp.resp_ok(data=obj)
    