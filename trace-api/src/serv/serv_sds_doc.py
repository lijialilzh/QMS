from enum import Enum
import logging
import json
import re
import io
import base64
import os
from typing import Dict, List, Tuple, Union
from sqlalchemy import select, delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import desc
try:
    from docx import Document
    from docx.table import Table as DocxTable
    from docx.text.paragraph import Paragraph
    from docx.shared import Pt
    from docx import enum as dox_enum
    from docx.oxml.ns import qn
    from docx.shared import RGBColor
except Exception:
    Document = None
    DocxTable = None
    Paragraph = None
    Pt = None
    dox_enum = None
    qn = None
    RGBColor = None
from ..obj.vobj_user import UserObj
from ..obj.vobj_sds_trace import SdsTraceObj
from ..model.srs_type import SrsType
from ..model.srs_reqd import SrsReqd
from ..obj.vobj_sds_reqd import SdsReqdObj
from ..model.srs_req import SrsReq
from ..model.sds_reqd import Logic, SdsReqd
from ..model.doc_file import DocFile
from ..model.sds_trace import SdsTrace
from ..model.srs_doc import SrsDoc
from ..obj.tobj_srs_doc import Table, TabHeader
from ..model.product import Product, UserProd
from ..obj.vobj_sds_doc import CompareObj, SdsDocObj
from ..model.sds_doc import SdsDoc, SdsNode
from ..obj.tobj_sds_doc import SdsDocForm, SdsNodeForm
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..utils import get_uuid
from .serv_utils.tree_util import find_parent
from .serv_utils import new_version
from .serv_sds_trace import Server as ServSdsTrace
from .serv_sds_reqd import Server as ServSdsReqd
from .serv_srs_doc import Server as ServSrsDoc

from ..obj import Page, Resp
from . import msg_err_db, save_file

logger = logging.getLogger(__name__)
srsdoc_serv = ServSrsDoc()
sdstrace_serv = ServSdsTrace()
sdstreqd_serv = ServSdsReqd()


class RefTypes(Enum):
    img_struct = "img_struct"
    img_flow = "img_flow"
    img_topo = "img_topo"
    sds_traces = "sds_traces"
    sds_reqds = "sds_reqds"

class Server(object):
    def __persist_data_url_images(self, nodes: List[SdsNodeForm]):
        ext_map = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/gif": "gif",
            "image/bmp": "bmp",
            "image/webp": "webp",
        }

        def walk(node_list: List[SdsNodeForm]):
            for node in node_list or []:
                img_url = (getattr(node, "img_url", None) or "").strip()
                if img_url.startswith("data:"):
                    matched = re.match(r"^data:([^;]+);base64,(.+)$", img_url, re.S)
                    if matched:
                        mime = (matched.group(1) or "").lower()
                        b64 = matched.group(2) or ""
                        ext = ext_map.get(mime, "png")
                        try:
                            bys = base64.b64decode(b64)
                            path = os.path.join("data.trace", "sds_node_img", "import_sds", f"{get_uuid()}.{ext}")
                            os.makedirs(os.path.dirname(path), exist_ok=True)
                            with open(path, "wb") as fs:
                                fs.write(bys)
                            node.img_url = path
                        except Exception:
                            node.img_url = None
                    else:
                        node.img_url = None
                if getattr(node, "children", None):
                    walk(node.children or [])

        walk(nodes or [])

    @staticmethod
    def __normalize_code(code: str):
        txt = (code or "").strip().upper()
        txt = re.sub(r"\s+", "", txt)
        txt = re.sub(r"[，。；;、,.]+$", "", txt)
        return txt

    @staticmethod
    def __to_srs_code(code: str):
        txt = Server.__normalize_code(code)
        if txt.startswith("SDS-"):
            return "SRS-" + txt[4:]
        return txt

    @staticmethod
    def __normalize_section_name(value: str):
        txt = (value or "").strip()
        txt = re.sub(r"^[（(]?[一二三四五六七八九十0-9]+[)）.\s、]*", "", txt)
        txt = re.sub(r"[\s:：\-_，。；;、]+", "", txt)
        return txt

    def __detect_sds_reqd_field(self, node: SdsNodeForm):
        merged = self.__normalize_section_name(f"{getattr(node, 'label', '')}{getattr(node, 'title', '')}")
        if not merged:
            return None
        if any(k in merged for k in ["总体描述", "需求概述", "概述"]):
            return "overview"
        if "程序逻辑" in merged or "逻辑" in merged:
            return "logic_txt"
        if "输入项" in merged or merged == "输入":
            return "intput"
        if "输出项" in merged or merged == "输出":
            return "output"
        if "接口" in merged:
            return "interface"
        # “功能”放在逻辑之后，避免“子功能”误判
        if "功能" in merged:
            return "func_detail"
        return None

    def __extract_sds_reqd_payload(self, nodes: List[SdsNodeForm]):
        payload: Dict[str, Dict[str, str]] = {}

        def save_value(code: str, field: str, text: str):
            if not code or not field or not text:
                return
            data = payload.setdefault(code, {})
            old = data.get(field, "")
            # 保留信息量更大的文本，避免被短标题覆盖
            if not old or len(text) > len(old):
                data[field] = text

        def walk(node_list: List[SdsNodeForm], current_code: str = ""):
            for node in node_list or []:
                node_code = self.__normalize_code(getattr(node, "sds_code", "") or "")
                active_code = node_code or current_code
                field = self.__detect_sds_reqd_field(node)
                text = (getattr(node, "text", "") or "").strip()
                if active_code and field and text:
                    save_value(active_code, field, text)
                if getattr(node, "children", None):
                    walk(node.children or [], active_code)

        walk(nodes or [])
        return payload

    def __sync_imported_sds_reqd_fields(self, sds_doc_id: int, srs_doc_id: int, nodes: List[SdsNodeForm]):
        reqd_payload = self.__extract_sds_reqd_payload(nodes)
        if not reqd_payload:
            return
        srs_codes = [self.__to_srs_code(code) for code in reqd_payload.keys() if code]
        srs_codes = [code for code in srs_codes if code]
        if not srs_codes:
            return

        req_rows = db.session.execute(
            select(SrsReq).where(SrsReq.doc_id == srs_doc_id, SrsReq.code.in_(srs_codes))
        ).scalars().all()
        if not req_rows:
            return

        req_id_map = {row.id: row.code for row in req_rows}
        sds_reqd_rows = db.session.execute(
            select(SdsReqd).where(SdsReqd.doc_id == sds_doc_id, SdsReqd.req_id.in_(list(req_id_map.keys())))
        ).scalars().all()
        if not sds_reqd_rows:
            return

        for row in sds_reqd_rows:
            srs_code = req_id_map.get(row.req_id, "")
            sds_code = self.__normalize_code(srs_code.replace("SRS-", "SDS-")) if srs_code else ""
            values = reqd_payload.get(sds_code) or reqd_payload.get(self.__normalize_code(srs_code))
            if not values:
                continue
            for field in ["overview", "func_detail", "logic_txt", "intput", "output", "interface"]:
                val = (values.get(field) or "").strip()
                if val:
                    setattr(row, field, val)
        db.session.commit()

    async def import_sds_doc_word(self, product_id: int, version: str, change_log: str, file):
        if Document is None or DocxTable is None or Paragraph is None:
            return Resp.resp_err(msg="当前环境缺少 python-docx 依赖，暂不可用 Word 导入。")
        try:
            srs_row = db.session.execute(
                select(SrsDoc).where(SrsDoc.product_id == product_id).order_by(desc(SrsDoc.create_time), desc(SrsDoc.id))
            ).scalars().first()
            if not srs_row:
                return Resp.resp_err(msg="导入失败：当前产品下未找到需求规格说明，请先导入需求规格说明。")

            bys = await file.read()
            docx = Document(io.BytesIO(bys))
            content, _ = srsdoc_serv._Server__parse_docx_content(docx)  # 复用 SRS 导入解析
            file_name = file.filename or ""
            _, file_no = srsdoc_serv._Server__extract_file_info(file_name)

            def to_sds_node(node):
                data = {}
                for key in ["title", "label", "img_url", "text", "ref_type", "table", "sds_code"]:
                    val = getattr(node, key, None)
                    if val is not None:
                        data[key] = val
                if not data.get("sds_code"):
                    srs_code = getattr(node, "srs_code", None)
                    if srs_code:
                        data["sds_code"] = srs_code.replace("SRS-", "SDS-")
                data["children"] = [to_sds_node(child) for child in (getattr(node, "children", None) or [])]
                return SdsNodeForm(**data)

            sds_content = [to_sds_node(node) for node in (content or [])]
            self.__persist_data_url_images(sds_content)
            form = SdsDocForm(
                srsdoc_id=srs_row.id,
                version=version,
                file_no=file_no or None,
                change_log=change_log,
                content=sds_content,
            )
            resp = await self.add_sds_doc(form)
            if resp.code == 200 and resp.data and resp.data.id:
                self.__sync_imported_sds_reqd_fields(resp.data.id, srs_row.id, sds_content)
            return resp
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    def __update_nodes(self, doc: SdsDoc, p_id, nodes: List[SdsNodeForm]):
        for idx, node in enumerate(nodes):
            sql = select(SdsNode).where(SdsNode.doc_id == doc.id, SdsNode.n_id == node.n_id) if node.n_id else None
            row = db.session.execute(sql).scalars().first() if sql is not None else None
            if not row:
                doc.n_id += 1
                table = node.table.json() if node.table else None
                row = SdsNode(doc_id=doc.id, n_id=doc.n_id, p_id=p_id, priority=idx, title=node.title, label=node.label, img_url=node.img_url, text=node.text, ref_type=node.ref_type,
                            table=table, sds_code=node.sds_code)
                db.session.add(row)
                logger.info("add_node: %s, %s, %s", p_id, doc.n_id, node.title)
            else:
                for key, value in node.dict().items():
                    if key == "doc_id" or key == "n_id" or key == "p_id" or value is None:
                        continue
                    if key == "table":
                        value = json.dumps(value) if value else None
                    setattr(row, key, value)
                row.priority = idx
                logger.info("alt_node: %s, %s, %s", p_id, doc.n_id, node.title)
            if node.children:
                self.__update_nodes(doc, row.n_id, node.children)

    async def duplicate_sds_doc(self, id: int):
        fromdoc:SdsDocObj = (await self.get_sds_doc(id, with_tree=True)).data
        if not fromdoc:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        version = new_version(fromdoc.version)
        newdoc = SdsDoc(srsdoc_id=fromdoc.srsdoc_id, version=version, change_log=fromdoc.change_log, n_id=0)
        sql = select(func.count(SdsDoc.id)).where(SdsDoc.srsdoc_id == newdoc.srsdoc_id, SdsDoc.version == newdoc.version)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_obj_exist"))
        try:
            db.session.add(newdoc)
            db.session.flush()
            self.__update_nodes(newdoc, 0, fromdoc.content)

            sdsreqds = db.session.execute(select(SdsReqd).where(SdsReqd.doc_id == fromdoc.id)).scalars().all()
            for sdsreqd in sdsreqds:
                newreqd = SdsReqd(**sdsreqd.dict())
                newreqd.id = None
                newreqd.doc_id = newdoc.id
                db.session.add(newreqd)
            sdstraces = db.session.execute(select(SdsTrace).where(SdsTrace.doc_id == fromdoc.id)).scalars().all()
            for sdstrace in sdstraces:
                newtrace = SdsTrace(**sdstrace.dict())
                newtrace.id = None
                newtrace.doc_id = newdoc.id
                db.session.add(newtrace)
            return Resp.resp_ok(data=SdsDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def add_sds_doc(self, form: SdsDocForm):
        def __chapter(req: SrsReq):
            return  req.sub_function or req.function or req.module
        try:
            sql = select(func.count(SdsDoc.id)).where(SdsDoc.srsdoc_id == form.srsdoc_id, SdsDoc.version == form.version)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            
            row = SdsDoc(srsdoc_id=form.srsdoc_id, version=form.version, change_log=form.change_log, n_id=0, file_no=form.file_no)
            db.session.add(row)
            db.session.flush()
            if form.content:
                self.__update_nodes(row, 0, form.content)
            srs_reqs: List[SrsReq] = db.session.execute(select(SrsReq).where(SrsReq.doc_id == form.srsdoc_id)).scalars().all()
    
            req_values = [dict(doc_id=row.id, req_id=req.id) for req in srs_reqs if req.type_code != "2"]
            if req_values:
                db.session.execute(pg_insert(SdsReqd).values(req_values).on_conflict_do_nothing())

            req_values = [dict(doc_id=row.id, req_id=req.id, sds_code=req.code.replace("SRS", "SDS"), chapter=__chapter(req)) for req in srs_reqs if req.type_code != "reqd"]
            if req_values:
                db.session.execute(pg_insert(SdsTrace).values(req_values).on_conflict_do_nothing())
                
            db.session.commit()
            return Resp.resp_ok(data=SdsDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
    
    async def add_doc_file(self, doc_id: int, file):
        size, path = await save_file("sds_node_img", doc_id, file)
        return Resp.resp_ok(data=path)   
   
    async def delete_sds_doc(self, id):
        db.session.execute(delete(SdsReqd).where(SdsReqd.doc_id == id))
        db.session.execute(delete(SdsTrace).where(SdsTrace.doc_id == id))
        db.session.execute(delete(SdsNode).where(SdsNode.doc_id == id))
        db.session.execute(delete(SdsDoc).where(SdsDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def add_sds_node(self, node: SdsNodeForm):
        sql = select(SdsNode, SdsDoc).join(SdsDoc, SdsNode.doc_id == SdsDoc.id)
        sql = sql.where(SdsNode.doc_id == node.doc_id, SdsNode.n_id == node.p_id)
        result = db.session.execute(sql).first()
        if not result:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        _, doc = result
        doc.n_id += 1
        table = node.table.json() if node.table else None
        row = SdsNode(doc_id=doc.id, n_id=doc.n_id, p_id=node.p_id, priority=doc.n_id, 
                            title=node.title, img_url=node.img_url, text=node.text, table=table)
        db.session.add(row)
        db.session.commit()
        return Resp.resp_ok(data=SdsNodeForm(doc_id=row.doc_id, n_id=row.n_id, p_id=row.p_id, priority=row.priority,
                            title=row.title, img_url=row.img_url, text=row.text, table=node.table))

    async def delete_sds_node(self, doc_id, n_id):
        db.session.execute(delete(SdsNode).where(SdsNode.doc_id == doc_id, SdsNode.n_id == n_id))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_sds_doc(self, form: SdsDocForm):
        try:
            sql = select(func.count(SdsDoc.id)).where(SdsDoc.srsdoc_id == form.srsdoc_id, SdsDoc.version == form.version, SdsDoc.id != form.id)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            sql = select(SdsDoc).where(SdsDoc.id == form.id)
            row:SdsDoc = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict().items():
                if key == "id" or key == "n_id" or value is None:
                    continue
                setattr(row, key, value)
            if form.content:
                row.n_id = 0
                db.session.execute(delete(SdsNode).where(SdsNode.doc_id == row.id))
                self.__update_nodes(row, 0, form.content)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    def __query_imgs(self, product_id: int):
        subquery = select(DocFile.category, func.max(DocFile.id).label("max_id"))
        subquery = subquery.where(DocFile.product_id == product_id).group_by(DocFile.category).subquery()
        sql = select(DocFile).join(subquery, DocFile.id == subquery.c.max_id)
        rows: List[DocFile] = db.session.execute(sql).scalars().all()
        return {row.category: row.file_url for row in rows}

    async def get_sds_doc(self, id:str, with_tree: bool = False):
        sql = select(SdsDoc, SrsDoc, Product).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id).join(Product, SrsDoc.product_id == Product.id).where(SdsDoc.id == id)
        row, row_srs, row_prd = db.session.execute(sql).first() or (None, None, None)
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        
        tree = []
        if with_tree:
            sql = select(SdsNode).where(SdsNode.doc_id == id).order_by(SdsNode.priority)
            nodes: list[SdsNode] = db.session.execute(sql).scalars().all()
            objs_dict = dict()
            objs = []
            prod_imgs = self.__query_imgs(row_srs.product_id)
            for node in nodes:
                table = Table.parse_raw(node.table) if node.table else None
                obj = SdsNodeForm(children=[], doc_id=node.doc_id, n_id=node.n_id, p_id=node.p_id,
                                title=node.title, label=node.label, img_url=node.img_url, text=node.text, ref_type=node.ref_type, table=table, sds_code=node.sds_code)
                if not obj.img_url and obj.ref_type in prod_imgs:
                    obj.img_url = prod_imgs[obj.ref_type]

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
        return Resp.resp_ok(data=SdsDocObj(**row.dict(), product_id=row_srs.product_id, product_name=row_prd.name, product_version=row_prd.full_version, content=tree))

    async def list_sds_doc(self, op_user: UserObj, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(SdsDoc, SrsDoc, Product).outerjoin(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id).outerjoin(Product, SrsDoc.product_id == Product.id)
        if product_id:
            sql = sql.where(SrsDoc.product_id == product_id)
        if version:
            sql = sql.where(SdsDoc.version.like(f"%{version}%"))
        if not product_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))
        
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()
        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(SdsDoc.create_time))
        rows: list[SdsDoc] = db.session.execute(sql).all()

        objs = []
        for row, row_srs, row_prd in rows:
            obj = SdsDocObj(**row.dict())
            if row_prd:
                obj.product_id = row_prd.id
                obj.product_name = row_prd.name
                obj.product_version = row_prd.full_version
            if row_srs:
                obj.srs_version = row_srs.version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))

    async def export_sds_doc(self, output, id: int = 0, *args, **kwargs):
        if Document is None or Pt is None or dox_enum is None:
            return
        from .serv_utils import docx_util
        async def __query_sds_traces_x():
            resp = await sdstrace_serv.list_sds_trace(None, doc_id=id, page_size=5000)
            reqs: List[SdsTraceObj] = resp.data.rows or []
            reqs_dict = dict()
            for req in reqs:
                reqs_dict.setdefault((req.type_code, req.type_name), []).append(req)
            
            results = []
            for (type_code, type_name), reqs in reqs_dict.items():
                headers = [TabHeader(code="srs_code", name="需求编号"), 
                       TabHeader(code="sds_code", name="设计编号"), 
                       TabHeader(code="chapter", name="需求/代码")]
                rows = []
                for req in reqs:
                    row = dict()
                    location = f"（章节 {req.location}） " if req.location else ""
                    row["srs_code"] = req.srs_code
                    row["sds_code"] = req.sds_code
                    row["chapter"] = req.chapter + location
                    rows.append(row)
                table = Table(headers=headers, rows=rows)
                results.append(SdsNodeForm(label=type_name, table=table))
            return results

        def __fix_chapter(p_title: str, nodes: List[SdsNodeForm]):
            chapter =re.search(r'(\d(\.\d)*)', p_title or "")
            chapter = chapter.group() if chapter else None
            chapter = f"{chapter}." if chapter else ""
            for idx, node in enumerate(nodes or []):
                if node.with_chapter == 1 and chapter and node.title:
                    node.title = f"{chapter}{idx+1} {node.title}"
                    __fix_chapter(node.title, node.children)


        def __query_sds_logics(reqd_ids):
            result_dict = dict()
            if not reqd_ids:
                return result_dict
            sql = select(Logic).where(Logic.reqd_id.in_(reqd_ids)).order_by(Logic.id)
            rows: List[Logic] = db.session.execute(sql).scalars().all()
            for row in rows:
                reqd_id = row.reqd_id
                logics = result_dict.get(reqd_id, [])
                logics.append(SdsNodeForm(img_url=row.img_url))
                logics.append(SdsNodeForm(text=row.txt))
                result_dict[reqd_id] = logics
            return result_dict

        async def __query_sds_reqds(p_title: str):
            resp = await sdstreqd_serv.list_sds_reqd(None, doc_id=id, page_size=2000)
            reqds: List[SdsReqdObj] = resp.data.rows or []
            reqd_ids = [reqd.id for reqd in reqds]
            sds_logics = __query_sds_logics(reqd_ids)
            parents = dict()
            for idx, reqd in enumerate(reqds):
                with_chapter = 1 if reqd.sub_function else 0
                title = reqd.name if reqd.sub_function else None

                node = SdsNodeForm(with_chapter=with_chapter, title=title, children=[])
                node.children.append(SdsNodeForm(label="（一）总体描述", text=reqd.overview))
                node.children.append(SdsNodeForm(label="（二）功能", text=reqd.func_detail))

                node.children.append(SdsNodeForm(label="（三）程序逻辑", text=reqd.logic_txt))
                logics = sds_logics.get(reqd.id, [])
                node.children.extend(logics)

                node.children.append(SdsNodeForm(label="（四）输入项", text=reqd.intput))
                node.children.append(SdsNodeForm(label="（五）输出项", text=reqd.output))
                node.children.append(SdsNodeForm(label="（六）接口", text=reqd.interface))
                p_node = find_parent(SdsNodeForm, [reqd.module, reqd.function], parents)
                p_node.children.append(node)
            p_nodes = [node for key, node in parents.items() if node.level == 0]
            __fix_chapter(p_title, p_nodes)
            return p_nodes

        async def __writenodes(nodes: List[SdsNodeForm], docx: Document, level: int = 0):
            font_def = 10.5
            font_size = font_def
            if level == 0 :
                font_size = 16.0
            elif level == 1:
                font_size = 14.0
            font_name = "宋体"
            for node in nodes or []:
                if node.title:
                    docx_util.save_title2docx(node.title, docx, level+1, font_size)
                if node.sds_code:
                    docx_util.save_txt2docx("设计编号：" + node.sds_code, docx, font_def)
                if node.label:
                    docx_util.save_txt2docx(node.label, docx, font_def)
                if node.text:
                    docx_util.save_txt2docx(node.text, docx, font_def)
                if node.img_url:
                    docx_util.save_img2docx(node.img_url, docx, mw=500, mh=500)

                if node.ref_type == RefTypes.sds_traces.value:
                    results = await __query_sds_traces_x()
                    await __writenodes(results, docx, level + 1)
                elif node.ref_type == RefTypes.sds_reqds.value:
                    sds_reqds = await __query_sds_reqds(node.title)
                    await __writenodes(sds_reqds, docx, level + 1)
                else:
                    if node.table and node.table.headers:
                        docx_util.save_tab2docx(node.table, docx)
                        
                if node.children:
                    await __writenodes(node.children, docx, level + 1)

        resp = await self.get_sds_doc(id=id, with_tree=True)
        sds_doc: SdsDocObj = resp.data
        if sds_doc:
            docx = Document()

            header_para = docx.sections[0].header.add_paragraph()
            header_para.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.RIGHT
            docx_util.fonted_txt(header_para, sds_doc.file_no)
            
            await __writenodes(sds_doc.content, docx, level=0)

            docx.save(output)
            output.seek(0)

    async def get_sds_doc_txts(self, doc_id):
        def __gather_nodes(texts:List[str],nodes: List[SdsNodeForm]):
            for node in nodes:
                values = [node.title, node.text]
                values = [value for value in values if value]
                texts += values
                if node.children:
                    __gather_nodes(texts, node.children)
            return texts

        docdata: Resp[SdsDocObj] = (await self.get_sds_doc(doc_id, with_tree=True)).data
        content = docdata.content if docdata and docdata.content else []
        txts = __gather_nodes([], content)
        return Resp.resp_ok(data=txts)

    async def compare_sds_doc(self, id0: int, id1: int):
        def __query_srs_reqs():
            sql = select(SrsReqd, SrsReq, SrsDoc, SdsDoc).join(SrsReq, SrsReqd.req_id == SrsReq.id)
            sql = sql.join(SrsDoc, SrsReq.doc_id == SrsDoc.id)
            sql = sql.join(SdsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            sql = sql.where(SdsDoc.id.in_([id0, id1])).order_by(SrsDoc.id, SdsDoc.id, SrsReq.module, SrsReq.function, SrsReq.code)
            rows:  List[Tuple[SrsReqd, SrsReq, SrsDoc, SdsDoc]] = db.session.execute(sql).all()
            attrs_dict = dict()
            for reqd, req, srsdoc, sdsdoc in rows:
                values =  [reqd.overview, reqd.participant, reqd.pre_condition,
                           reqd.trigger, reqd.work_flow, reqd.post_condition, reqd.exception, reqd.constraint,
                           req.module, req.function, req.code]
                values = [value for value in values if value]
                attrs: List[str] = attrs_dict.setdefault(sdsdoc.id, [])
                attrs += values
            return attrs_dict
        
        def __query_sds_reqds():
            sql = select(SdsReqd).where(SdsReqd.doc_id.in_([id0, id1]))
            rows: List[SdsReqd] = db.session.execute(sql).scalars().all()
            attrs_dict = dict()
            for reqd in rows:
                values =  [reqd.overview, reqd.func_detail, reqd.logic_txt, reqd.intput, reqd.output, reqd.interface]
                values = [value for value in values if value]
                attrs: List[str] = attrs_dict.setdefault(reqd.doc_id, [])
                attrs += values
            return attrs_dict
        
        def __query_sds_traces():
            sql = select(SdsTrace).where(SdsTrace.doc_id.in_([id0, id1]))
            rows: List[SdsTrace] = db.session.execute(sql).scalars().all()
            attrs_dict = dict()
            for trace in rows:
                values =  [trace.sds_code, trace.chapter]
                values = [value for value in values if value]
                attrs: List[str] = attrs_dict.setdefault(trace.doc_id, [])
                attrs += values
            return attrs_dict
        
        async def __query_srsdocs():
            result = dict()
            result[id0] = (await srsdoc_serv.get_srs_doc_txts(id0)).data
            result[id1] = (await srsdoc_serv.get_srs_doc_txts(id1)).data
            return result
        
        async def __query_sdsdocs():
            result = dict()
            result[id0] = (await self.get_sds_doc_txts(id0)).data
            result[id1] = (await self.get_sds_doc_txts(id1)).data
            return result

        sql = select(SdsDoc, SrsDoc, Product).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id).join(Product, SrsDoc.product_id == Product.id).where(SdsDoc.id.in_([id0, id1]))
        rows: List[Tuple[SdsDoc, SrsDoc, Product]] = db.session.execute(sql).all()
        if not rows:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        
        srs_reqs_dict = __query_srs_reqs()
        sds_reqds_dict = __query_sds_reqds()
        sds_traces_dict = __query_sds_traces()
        srsdocs_dict = await __query_srsdocs()
        sdsdocs_dict = await __query_sdsdocs()
        infos = dict()
        for row_sdsdoc, row_srsdoc, row_prd in rows:
            srs_reqs = srs_reqs_dict.get(row_sdsdoc.id) or []

            sds_reqds = sds_reqds_dict.get(row_sdsdoc.id) or []
            sds_traces = sds_traces_dict.get(row_sdsdoc.id) or []
            sds_reqds += sds_traces
            
            srsdoc_txts = srsdocs_dict.get(row_sdsdoc.id) or []
            sdsdoc_txts = sdsdocs_dict.get(row_sdsdoc.id) or []

            info = dict(
                product_name=row_prd.name,
                product_type_code=row_prd.type_code,
                product_version=row_prd.full_version,
                product_udi=row_prd.udi,
                product_scope=row_prd.scope,
                srs_version=row_srsdoc.version,
                sds_version=row_sdsdoc.version,

                srs_reqs=srs_reqs,
                sds_reqds=sds_reqds,
                srsdoc_txts=srsdoc_txts,
                sdsdoc_txts=sdsdoc_txts,
            )
            infos[row_sdsdoc.id] = info
        info0 = infos.get(id0) or dict()
        info1 = infos.get(id1) or dict()
        results = []
        for column in ["product_name", "product_type_code", "product_version", "product_udi", "product_scope", "srs_version", "sds_version", 
                       "srs_reqs", "sds_reqds", "srsdoc_txts", "sdsdoc_txts"]:
            value0 = info0.get(column) or ""
            value1 = info1.get(column) or ""
            same_flag =  1 if value0 == value1 else 0
            results.append(CompareObj(column_code=column, column_name=ts(f"sdsdiff.{column}"), same_flag=same_flag, values=[value0, value1]))
        return Resp.resp_ok(data=results)
        