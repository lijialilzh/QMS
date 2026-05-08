#!/usr/bin/env python
# encoding: utf-8

import logging
import copy
from typing import List
from sqlalchemy import delete, func, select
from docx import Document

from ..model.product import Product
from ..model.risk_mgmt_doc import RiskAnalysis, RiskControl, RiskMgmtDoc
from ..obj import Page, Resp
from ..obj.tobj_risk_mgmt_doc import RiskAnalysisForm, RiskControlForm, RiskMgmtDocForm
from ..obj.vobj_risk_mgmt_doc import RiskAnalysisObj, RiskControlObj, RiskMgmtDocObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from .serv_utils import new_version

logger = logging.getLogger(__name__)


DEFAULT_RISK_CONTENT = {
    "sections": [
        {"title": "1 目的", "children": []},
        {"title": "2 范围", "children": []},
        {"title": "3 产品描述", "children": [
            {"title": "3.1 产品预期用途", "children": []},
            {"title": "3.2 产品功能描述", "children": []},
        ]},
        {"title": "4 评审", "children": [
            {"title": "4.1 评审数据", "children": []},
            {"title": "4.2 风险分析参与人员", "ref_type": "participants", "children": []},
            {"title": "4.3 审评历史", "children": []},
        ]},
        {"title": "5 风险分析方式", "children": [
            {"title": "5.1 危害识别", "children": [
                {"title": "5.1.1 与合理可预见相关的环境相关的危害", "children": []},
                {"title": "5.1.2 考虑的危害包括", "children": []},
                {"title": "5.1.3 危害初步原因的考虑应包括", "children": []},
                {"title": "5.1.4 危害重点考虑的原因应包括", "children": []},
            ]},
            {"title": "5.2 风险评价准则", "children": [
                {"title": "5.2.1 严重度定义", "children": []},
                {"title": "5.2.2 发生概率定义", "children": []},
                {"title": "5.2.3 接受标准", "children": []},
            ]},
        ]},
        {"title": "6 风险分析", "children": [
            {"title": "6.1 与安全有关特征的问题识别", "children": []},
            {"title": "6.2 已知或可预见的危险（源）识别", "children": []},
            {"title": "6.3 估计每个危险情况的风险", "children": []},
            {"title": "6.4 风险评价", "ref_type": "risk_analysis", "children": []},
            {"title": "6.5 风险控制", "ref_type": "risk_controls", "children": [
                {"title": "6.5.1 风险控制方案分析", "children": []},
                {"title": "6.5.2 风险控制措施的实施", "children": []},
                {"title": "6.5.3 剩余风险分析和风险/受益分析", "children": []},
                {"title": "6.5.4 由风险控制措施产生的风险", "children": []},
            ]},
        ]},
        {"title": "7 风险的可接受性评价", "children": [
            {"title": "7.1 RCMs实施风险控制措施前/后的风险分布", "children": []},
            {"title": "7.2 综合剩余风险评价", "children": []},
            {"title": "7.3 软件安全级别判定", "children": []},
        ]},
        {"title": "8 生产和生产后活动", "children": []},
        {"title": "9 结论", "children": []},
        {"title": "10 参考标准", "children": []},
        {"title": "11 风险管理文件", "children": []},
        {"title": "附录A 与安全有关特征的问题识别", "children": []},
        {"title": "附录B 风险分析矩阵", "ref_type": "risk_analysis", "children": []},
    ],
    "participants": [],
    "riskMatrix": [],
    "riskControls": [],
}


class Server(object):
    def __normalize_content(self, content):
        result = copy.deepcopy(DEFAULT_RISK_CONTENT)
        if isinstance(content, dict):
            result.update(content)
        result.setdefault("sections", copy.deepcopy(DEFAULT_RISK_CONTENT["sections"]))
        result.setdefault("participants", [])
        result.setdefault("riskMatrix", [])
        result.setdefault("riskControls", [])
        return result

    def __to_obj(self, row: RiskMgmtDoc, product: Product = None):
        obj = RiskMgmtDocObj(**row.dict())
        obj.content = self.__normalize_content(obj.content)
        if product:
            obj.product_name = product.name
            obj.product_version = product.full_version
            obj.product_full_version = product.full_version
            obj.product_type_code = product.type_code
        return obj

    def __fill_list_obj(self, obj, product: Product = None, doc: RiskMgmtDoc = None):
        if product:
            obj.product_name = product.name
            obj.product_full_version = product.full_version
        if doc:
            obj.doc_version = doc.version
        return obj

    def __to_analysis_obj(self, row: RiskAnalysis, product: Product = None, doc: RiskMgmtDoc = None):
        return self.__fill_list_obj(RiskAnalysisObj(**row.dict()), product, doc)

    def __to_control_obj(self, row: RiskControl, product: Product = None, doc: RiskMgmtDoc = None):
        return self.__fill_list_obj(RiskControlObj(**row.dict()), product, doc)

    def __sync_product_id_from_doc(self, form):
        if form.doc_id and not form.product_id:
            doc = db.session.execute(select(RiskMgmtDoc).where(RiskMgmtDoc.id == form.doc_id)).scalars().first()
            if doc:
                form.product_id = doc.product_id
        return form

    async def add_risk_mgmt_doc(self, form: RiskMgmtDocForm):
        try:
            sql = select(func.count(RiskMgmtDoc.id)).where(
                RiskMgmtDoc.product_id == form.product_id,
                RiskMgmtDoc.version == form.version,
            )
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = RiskMgmtDoc(**form.dict(exclude_none=True))
            row.id = None
            row.content = self.__normalize_content(row.content)
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def import_risk_mgmt_doc_word(self, product_id: int, version: str, file_no: str = "", change_log: str = "", file=None):
        form = RiskMgmtDocForm(product_id=product_id, version=version, file_no=file_no, change_log=change_log)
        return await self.add_risk_mgmt_doc(form)

    async def duplicate_risk_mgmt_doc(self, id: int):
        try:
            fromdoc: RiskMgmtDoc = db.session.execute(select(RiskMgmtDoc).where(RiskMgmtDoc.id == id)).scalars().first()
            if not fromdoc:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            version = new_version(fromdoc.version)
            sql = select(func.count(RiskMgmtDoc.id)).where(RiskMgmtDoc.product_id == fromdoc.product_id, RiskMgmtDoc.version == version)
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            newdoc = RiskMgmtDoc(
                product_id=fromdoc.product_id,
                version=version,
                file_no=fromdoc.file_no,
                change_log=fromdoc.change_log,
                content=copy.deepcopy(self.__normalize_content(fromdoc.content)),
            )
            db.session.add(newdoc)
            db.session.flush()

            for item in db.session.execute(select(RiskAnalysis).where(RiskAnalysis.doc_id == fromdoc.id)).scalars().all():
                newitem = RiskAnalysis(**item.dict())
                newitem.id = None
                newitem.doc_id = newdoc.id
                db.session.add(newitem)
            for item in db.session.execute(select(RiskControl).where(RiskControl.doc_id == fromdoc.id)).scalars().all():
                newitem = RiskControl(**item.dict())
                newitem.id = None
                newitem.doc_id = newdoc.id
                db.session.add(newitem)
            db.session.commit()
            return Resp.resp_ok(data=RiskMgmtDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_risk_mgmt_doc(self, form: RiskMgmtDocForm):
        try:
            row: RiskMgmtDoc = db.session.execute(select(RiskMgmtDoc).where(RiskMgmtDoc.id == form.id)).scalars().first()
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

    async def delete_risk_mgmt_doc(self, id: int):
        db.session.execute(delete(RiskAnalysis).where(RiskAnalysis.doc_id == id))
        db.session.execute(delete(RiskControl).where(RiskControl.doc_id == id))
        db.session.execute(delete(RiskMgmtDoc).where(RiskMgmtDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def get_risk_mgmt_doc(self, id: int):
        sql = select(RiskMgmtDoc, Product).join(Product, RiskMgmtDoc.product_id == Product.id).where(RiskMgmtDoc.id == id)
        row = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        return Resp.resp_ok(data=self.__to_obj(doc, product))

    async def list_risk_mgmt_doc(self, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if product_id:
            wheres.append(RiskMgmtDoc.product_id == product_id)
        if version:
            wheres.append(RiskMgmtDoc.version.like(f"%{version}%"))
        sql_total = select(func.count(RiskMgmtDoc.id)).where(*wheres)
        total = db.session.execute(sql_total).scalar() or 0
        sql = (
            select(RiskMgmtDoc, Product)
            .join(Product, RiskMgmtDoc.product_id == Product.id)
            .where(*wheres)
            .order_by(RiskMgmtDoc.id.desc())
            .offset(page_index * page_size)
            .limit(page_size)
        )
        rows: List[RiskMgmtDocObj] = [self.__to_obj(doc, product) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    async def add_risk_analysis(self, form: RiskAnalysisForm):
        try:
            form = self.__sync_product_id_from_doc(form)
            sql = select(func.count(RiskAnalysis.id)).where(RiskAnalysis.doc_id == form.doc_id, RiskAnalysis.haz_code == form.haz_code)
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = RiskAnalysis(**form.dict(exclude_none=True))
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_risk_analysis(self, form: RiskAnalysisForm):
        try:
            form = self.__sync_product_id_from_doc(form)
            row: RiskAnalysis = db.session.execute(select(RiskAnalysis).where(RiskAnalysis.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            sql = select(func.count(RiskAnalysis.id)).where(
                RiskAnalysis.doc_id == form.doc_id,
                RiskAnalysis.haz_code == form.haz_code,
                RiskAnalysis.id != form.id,
            )
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            for key, value in form.dict(exclude_none=True).items():
                if key != "id":
                    setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_risk_analysis(self, id: int):
        db.session.execute(delete(RiskAnalysis).where(RiskAnalysis.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def list_risk_analysis(self, product_id: int = 0, doc_id: int = 0, keyword: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if product_id:
            wheres.append(RiskAnalysis.product_id == product_id)
        if doc_id:
            wheres.append(RiskAnalysis.doc_id == doc_id)
        if keyword:
            like = f"%{keyword}%"
            wheres.append((RiskAnalysis.haz_code.like(like)) | (RiskAnalysis.source.like(like)) | (RiskAnalysis.hazard_situation.like(like)))
        total = db.session.execute(select(func.count(RiskAnalysis.id)).where(*wheres)).scalar() or 0
        sql = (
            select(RiskAnalysis, RiskMgmtDoc, Product)
            .join(RiskMgmtDoc, RiskAnalysis.doc_id == RiskMgmtDoc.id)
            .join(Product, RiskAnalysis.product_id == Product.id)
            .where(*wheres)
            .order_by(RiskAnalysis.id.desc())
            .offset(page_index * page_size)
            .limit(page_size)
        )
        rows = [self.__to_analysis_obj(row, product, doc) for row, doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    async def add_risk_control(self, form: RiskControlForm):
        try:
            form = self.__sync_product_id_from_doc(form)
            sql = select(func.count(RiskControl.id)).where(RiskControl.doc_id == form.doc_id, RiskControl.rcm_code == form.rcm_code)
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = RiskControl(**form.dict(exclude_none=True))
            row.id = None
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_risk_control(self, form: RiskControlForm):
        try:
            form = self.__sync_product_id_from_doc(form)
            row: RiskControl = db.session.execute(select(RiskControl).where(RiskControl.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            sql = select(func.count(RiskControl.id)).where(
                RiskControl.doc_id == form.doc_id,
                RiskControl.rcm_code == form.rcm_code,
                RiskControl.id != form.id,
            )
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            for key, value in form.dict(exclude_none=True).items():
                if key != "id":
                    setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_risk_control(self, id: int):
        db.session.execute(delete(RiskControl).where(RiskControl.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def list_risk_control(self, product_id: int = 0, doc_id: int = 0, keyword: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if product_id:
            wheres.append(RiskControl.product_id == product_id)
        if doc_id:
            wheres.append(RiskControl.doc_id == doc_id)
        if keyword:
            like = f"%{keyword}%"
            wheres.append((RiskControl.rcm_code.like(like)) | (RiskControl.description.like(like)) | (RiskControl.hazard_codes.like(like)))
        total = db.session.execute(select(func.count(RiskControl.id)).where(*wheres)).scalar() or 0
        sql = (
            select(RiskControl, RiskMgmtDoc, Product)
            .join(RiskMgmtDoc, RiskControl.doc_id == RiskMgmtDoc.id)
            .join(Product, RiskControl.product_id == Product.id)
            .where(*wheres)
            .order_by(RiskControl.id.desc())
            .offset(page_index * page_size)
            .limit(page_size)
        )
        rows = [self.__to_control_obj(row, product, doc) for row, doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    async def export_risk_mgmt_doc(self, output, id: int):
        resp = await self.get_risk_mgmt_doc(id)
        obj: RiskMgmtDocObj = resp.data
        document = Document()
        document.add_heading("风险管理报告", 0)
        document.add_paragraph(f"产品名称：{obj.product_name or ''}")
        document.add_paragraph(f"产品型号：{obj.product_type_code or ''}")
        document.add_paragraph(f"产品版本：{obj.product_full_version or ''}")
        document.add_paragraph(f"文件编号：{obj.file_no or ''}")
        def add_section(section: dict, level: int = 1):
            title = section.get("title", "")
            document.add_heading(title, level=min(level, 4))
            if section.get("ref_type") == "participants":
                table = document.add_table(rows=1, cols=4)
                headers = ["序号", "姓名", "部门/岗位", "职责"]
                for idx, header in enumerate(headers):
                    table.rows[0].cells[idx].text = header
                for idx, item in enumerate((obj.content or {}).get("participants", []), start=1):
                    cells = table.add_row().cells
                    cells[0].text = str(idx)
                    cells[1].text = str(item.get("name", "") or "")
                    cells[2].text = str(item.get("role", "") or "")
                    cells[3].text = str(item.get("responsibility", "") or "")
            if section.get("ref_type") == "risk_analysis":
                rows = db.session.execute(select(RiskAnalysis).where(RiskAnalysis.doc_id == id).order_by(RiskAnalysis.id)).scalars().all()
                table = document.add_table(rows=1, cols=7)
                headers = ["HAZ编号", "危险源", "事件序列", "危险情况", "伤害", "初始风险", "分类"]
                for idx, header in enumerate(headers):
                    table.rows[0].cells[idx].text = header
                for row in rows:
                    cells = table.add_row().cells
                    cells[0].text = row.haz_code or ""
                    cells[1].text = row.source or ""
                    cells[2].text = row.event_sequence or ""
                    cells[3].text = row.hazard_situation or ""
                    cells[4].text = row.harm or ""
                    cells[5].text = " / ".join([str(v) for v in [row.init_rate, row.init_degree, row.init_level] if v])
                    cells[6].text = row.category or ""
            if section.get("ref_type") == "risk_controls":
                rows = db.session.execute(select(RiskControl).where(RiskControl.doc_id == id).order_by(RiskControl.id)).scalars().all()
                table = document.add_table(rows=1, cols=5)
                headers = ["RCM编号", "控制措施描述", "关联HAZ编号", "验证证据", "是否引入新风险"]
                for idx, header in enumerate(headers):
                    table.rows[0].cells[idx].text = header
                for row in rows:
                    cells = table.add_row().cells
                    cells[0].text = row.rcm_code or ""
                    cells[1].text = row.description or ""
                    cells[2].text = row.hazard_codes or ""
                    cells[3].text = row.verification_evidence or ""
                    cells[4].text = "是" if row.new_risk_flag else "否"
            for child in section.get("children", []) or []:
                add_section(child, level + 1)

        for section in (obj.content or {}).get("sections", []):
            add_section(section)
        document.save(output)
        output.seek(0)
