import logging
import re
import sys
from typing import List, Tuple, Union
from sqlalchemy import select, func, or_, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
    "图像存储": "DLServer",
    "图像处理": "RePACS",
    "图像显示": "NeoViewer",
    "图像预测": "DLServer",
}

class Server(object):
    def __ensure_sds_traces(self, prod_id: int = None, doc_id: int = None):
        if not prod_id and not doc_id:
            return
        try:
            sql_docs = select(SdsDoc.id, SdsDoc.srsdoc_id).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            if doc_id:
                sql_docs = sql_docs.where(SdsDoc.id == doc_id)
            if prod_id:
                sql_docs = sql_docs.where(SrsDoc.product_id == prod_id)
            docs = db.session.execute(sql_docs).all()
            for sds_doc_id, srs_doc_id in docs:
                reqs = db.session.execute(
                    select(SrsReq.id, SrsReq.code, SrsReq.module, SrsReq.function)
                    .where(SrsReq.doc_id == srs_doc_id)
                    .where(SrsReq.type_code != "reqd")
                ).all()
                if not reqs:
                    continue
                values = []
                for req_id, code, module, function in reqs:
                    values.append(
                        dict(
                            doc_id=sds_doc_id,
                            req_id=req_id,
                            sds_code=(code or "").replace("SRS", "SDS"),
                            chapter=function or module or "/",
                        )
                    )
                if values:
                    db.session.execute(pg_insert(SdsTrace).values(values).on_conflict_do_nothing())
            db.session.commit()
        except Exception:
            logger.exception("ensure_sds_traces_failed")
            db.session.rollback()

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
        target_codes = set(self.__extract_code_tokens(sdscode))
        for node in nodes or []:
            npaths = [node.title] if level == 0 else paths + [node.title]
            node_codes = set(self.__extract_code_tokens(getattr(node, "sds_code", None)))
            is_exact_match = (node.sds_code or "").strip() == (sdscode or "").strip()
            has_code_overlap = bool(target_codes and node_codes and (target_codes & node_codes))
            if is_exact_match or has_code_overlap:
                return npaths, node
            cpaths, cnode = self.__find_path(level + 1, sdscode, node.children, npaths)
            if cnode:
                return cpaths, cnode
        return paths, None
    
    def __find_chapter(self, paths: List[str] = None):
        for path in reversed(paths or []):
            chapter = self.__extract_chapter_code(path)
            if chapter:
                return chapter

    @staticmethod
    def __extract_chapter_code(value: str):
        txt = (value or "").strip()
        if not txt:
            return None
        # 仅提取“标题前缀章节号”，避免把正文中的普通数字误识别为章节号（如“数据上传1111”）
        # 兼容前置符号/换行（如 "-7. 法规符合性需求"）
        candidates = [line.strip() for line in re.split(r'[\r\n]+', txt) if line and line.strip()]
        if not candidates:
            candidates = [txt]
        for line in candidates:
            normalized = re.sub(r'^[\s\u3000•·▪■◆●○□◇\-–—_~()（）\[\]【】]+', "", line)
            matched = re.match(r'^(\d+(?:\.\d+)*)(?:[\s、.．:：\-–—]+|(?=[\u4e00-\u9fffA-Za-z])|$)', normalized)
            if not matched:
                continue
            chapter = matched.group(1)
            # 单级章节号限制为 1~2 位，降低把年份/流水号误判为章节号的概率
            if "." not in chapter and len(chapter) > 2:
                continue
            return chapter
        return None

    @staticmethod
    def __extract_code_tokens(value: str):
        txt = (value or "").strip().upper()
        if not txt:
            return []
        parts = re.split(r'[\s,，;；、|/\\\n\r\t]+', txt)
        return [part for part in parts if part]

    @staticmethod
    def __build_match_names(*raw_values: str):
        names = []
        for raw in raw_values:
            txt = (raw or "").strip()
            if not txt:
                continue
            variants = [txt]
            mapped = NAME_DICT.get(txt)
            if mapped:
                variants.append(mapped)
            for item in variants:
                for norm in Server.__name_match_variants(item):
                    if norm and norm not in names:
                        names.append(norm)
        return names

    @staticmethod
    def __shift_chapter_major(chapter: str, offset: int):
        txt = (chapter or "").strip()
        if not txt or not offset:
            return txt
        parts = txt.split(".")
        if not parts:
            return txt
        try:
            major = int(parts[0])
        except Exception:
            return txt
        shifted_major = major - offset
        if shifted_major <= 0:
            return txt
        parts[0] = str(shifted_major)
        return ".".join(parts)

    def __get_doc_chapter_offset(self, tree: List[SdsNodeForm] = None):
        for node in tree or []:
            title = (getattr(node, "title", "") or "").strip()
            if "软件详细设计" in title:
                chapter = self.__extract_chapter_code(title)
                if not chapter:
                    return 0
                try:
                    return int(str(chapter).split(".")[0])
                except Exception:
                    return 0
        return 0

    @staticmethod
    def __name_match_variants(value: str):
        txt = (value or "").strip()
        if not txt:
            return []
        variants = [txt]
        # 去掉标题中的括号补充说明，如 “法规符合性需求(网络安全)” -> “法规符合性需求”
        no_bracket = re.sub(r"[（(][^）)]*[）)]", "", txt).strip()
        if no_bracket and no_bracket not in variants:
            variants.append(no_bracket)
        # 业务常见同义写法归一（SRS 与 SDS 文案不完全一致）
        if "法规符合需求" in txt:
            variants.append(txt.replace("法规符合需求", "法规符合性需求"))
        if "法规符合性需求" in txt:
            variants.append(txt.replace("法规符合性需求", "法规符合需求"))
        normalized = []
        for item in variants:
            n = Server.__normalize_name(item)
            if n and n not in normalized:
                normalized.append(n)
        return normalized

    def __find_path_by_names(self, level: int, names: List[str], nodes: List[SdsNodeForm], paths: List[str] = None, exact_only: bool = True):
        for node in nodes or []:
            title = getattr(node, "title", "") or ""
            label = getattr(node, "label", "") or ""
            clean_title = self.__clean_path_title(title)
            title_norms = self.__name_match_variants(clean_title)
            label_norms = self.__name_match_variants(label)
            merged_norm = self.__normalize_name(f"{clean_title}{label}")
            npaths = [node.title] if level == 0 else paths + [node.title]
            if exact_only:
                hit = any(name and ((name in title_norms) or (name in label_norms)) for name in names or [])
            else:
                hit = any(
                    name and (
                        (name in title_norms)
                        or (name in label_norms)
                        or (merged_norm == name)
                        or (name in merged_norm)
                        or (merged_norm in name)
                    )
                    for name in names or []
                )
            if hit:
                return npaths, node
            cpaths, cnode = self.__find_path_by_names(level + 1, names, node.children, npaths, exact_only)
            if cnode:
                return cpaths, cnode
        return paths, None

    def __extract_chapter_levels(self, paths: List[str] = None):
        levels = []
        for path in paths or []:
            chapter = self.__extract_chapter_code(path)
            if chapter and chapter not in levels:
                levels.append(chapter)
        return levels

    @staticmethod
    def __is_placeholder_name(value: str):
        txt = (value or "").strip()
        return txt in ["", "/", "\\", "-", "--", "—", "N/A", "n/a", "无", "暂无"]

    @staticmethod
    def __clean_path_title(value: str):
        txt = (value or "").strip()
        if not txt:
            return ""
        # 去掉前置章节号，如 "6.7.12 新增科室"
        txt = re.sub(r"^\s*\d+(?:\.\d+)*\s*", "", txt).strip()
        return txt

    def __pick_req_display_name(self, row_req: SrsReq, paths: List[str] = None):
        for txt in [row_req.sub_function, row_req.function, row_req.module]:
            if not self.__is_placeholder_name(txt):
                return (txt or "").strip()

        # SRS字段全是占位值时，回退到SDS树路径中的标题文本
        candidates = []
        for path in reversed(paths or []):
            name = self.__clean_path_title(path)
            if self.__is_placeholder_name(name):
                continue
            if self.__extract_chapter_code(name) == name:
                continue
            candidates.append(name)
        return candidates[0] if candidates else "/"

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
        self.__ensure_sds_traces(prod_id=prod_id, doc_id=doc_id)

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
        doc_chapter_offsets = {d_id: self.__get_doc_chapter_offset(tree) for d_id, tree in doc_trees.items()}
        objs = []
        for row_reqd, row_req, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            obj = SdsTraceObj(**row_reqd.dict())
            obj.srs_code = row_req.code
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
            # 严格按详细设计树节点读取章节号：优先 sds_code 命中；无编码时仅做标题精确匹配
            doc_tree = doc_trees.get(row_sdsdoc.id)
            paths, _ = self.__find_path(0, row_reqd.sds_code, doc_tree, [])
            if not paths:
                exact_names = self.__build_match_names(row_req.sub_function, row_req.function, row_req.module)
                for name in exact_names:
                    paths, _ = self.__find_path_by_names(0, [name], doc_tree, [], exact_only=True)
                    if paths:
                        break
            # 严格匹配失败时，回退到模糊匹配，兼容“安装包” vs “制作安装包”等命名差异
            if not paths:
                fuzzy_names = self.__build_match_names(row_req.sub_function, row_req.function, row_req.module)
                for name in fuzzy_names:
                    paths, _ = self.__find_path_by_names(0, [name], doc_tree, [], exact_only=False)
                    if paths:
                        break
            # 详细设计树中未命中路径则不展示
            if not paths:
                continue
            # 需求/代码固定取 SRS需求名称（子功能 > 功能 > 模块），占位值时用树标题兜底
            obj.name = self.__pick_req_display_name(row_req, paths)
            # 业务强约束：图像相关条目优先按给定映射命中对应模块章节，避免误配到相邻章节
            module_alias = NAME_DICT.get(obj.name or "")
            if module_alias:
                alias_names = self.__build_match_names(module_alias)
                for name in alias_names:
                    mapped_paths, _ = self.__find_path_by_names(0, [name], doc_tree, [], exact_only=True)
                    if mapped_paths:
                        paths = mapped_paths
                        break
            obj.chapter = obj.name
            levels = self.__extract_chapter_levels(paths)
            # 章节号优先取命中路径中的最细级编码（如 6.7.12）
            if levels:
                obj.location = levels[-1]
            elif not obj.location:
                obj.location = self.__find_chapter(paths)
                logger.info("location: %s %s", row_reqd.sds_code, obj.location)
            obj.location = self.__extract_chapter_code(obj.location) or None
            # 命中路径但仍无法解析章节号时，不展示
            if not obj.location:
                continue
            if obj.location:
                chapter_offset = doc_chapter_offsets.get(row_sdsdoc.id, 0)
                obj.location = self.__shift_chapter_major(obj.location, chapter_offset) or obj.location
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        
    async def get_sds_trace(self, id: int):
        sql = select(SdsTrace, SrsReq).join(SrsReq, SrsReq.id == SdsTrace.req_id).where(SdsTrace.id == id)
        row: Tuple[SdsTrace, SrsReq] = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        row_reqd, row_req = row
        name = row_req.sub_function or row_req.function or row_req.module
        obj = SdsTraceObj(**row_reqd.dict(), srs_code=row_req.code, name=name)
        obj.chapter = name
        return Resp.resp_ok(data=obj)
    