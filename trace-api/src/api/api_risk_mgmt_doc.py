#!/usr/bin/env python
# encoding: utf-8

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_risk_mgmt_doc import RiskAnalysisForm, RiskControlForm, RiskMgmtDocForm, RiskParticipantForm
from ..obj.tobj_role import Perms
from ..obj.vobj_risk_mgmt_doc import RiskAnalysisObj, RiskControlObj, RiskMgmtDocObj, RiskParticipantObj
from ..serv.serv_risk_mgmt_doc import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_risk_mgmt_doc", summary="添加风险管理文档", response_model=Resp[RiskMgmtDocForm])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def add_risk_mgmt_doc(form: RiskMgmtDocForm):
    return await server.add_risk_mgmt_doc(form)


@router.post("/import_risk_mgmt_doc_word", summary="导入Word并创建风险管理文档", response_model=Resp[RiskMgmtDocForm])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def import_risk_mgmt_doc_word(
    product_id: int = Form(...),
    version: str = Form(...),
    file_no: str = Form(""),
    change_log: str = Form(""),
    file: UploadFile = File(...),
):
    return await server.import_risk_mgmt_doc_word(
        product_id=product_id,
        version=version,
        file_no=file_no,
        change_log=change_log,
        file=file,
    )


@router.get("/duplicate_risk_mgmt_doc", summary="复制风险管理文档", response_model=Resp[RiskMgmtDocForm])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def duplicate_risk_mgmt_doc(id: int):
    return await server.duplicate_risk_mgmt_doc(id)


@router.post("/update_risk_mgmt_doc", summary="更新风险管理文档", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def update_risk_mgmt_doc(form: RiskMgmtDocForm):
    return await server.update_risk_mgmt_doc(form)


@router.delete("/delete_risk_mgmt_doc", summary="删除风险管理文档", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def delete_risk_mgmt_doc(id: int):
    return await server.delete_risk_mgmt_doc(id)


@router.get("/list_risk_mgmt_doc", summary="查询风险管理文档列表", response_model=Resp[Page[RiskMgmtDocObj]])
@try_log(perm=Perms.risk_mgmt_doc_view)
async def list_risk_mgmt_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_risk_mgmt_doc(product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_risk_mgmt_doc", summary="查询风险管理文档详情", response_model=Resp[RiskMgmtDocObj])
@try_log(perm=Perms.risk_mgmt_doc_view)
async def get_risk_mgmt_doc(id: int):
    return await server.get_risk_mgmt_doc(id)


@router.post("/add_risk_participant", summary="添加风险分析参与人员", response_model=Resp[RiskParticipantForm])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def add_risk_participant(form: RiskParticipantForm):
    return await server.add_risk_participant(form)


@router.post("/update_risk_participant", summary="更新风险分析参与人员", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def update_risk_participant(form: RiskParticipantForm):
    return await server.update_risk_participant(form)


@router.delete("/delete_risk_participant", summary="删除风险分析参与人员", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def delete_risk_participant(id: int):
    return await server.delete_risk_participant(id)


@router.get("/list_risk_participant", summary="查询风险分析参与人员列表", response_model=Resp[Page[RiskParticipantObj]])
@try_log(perm=Perms.risk_mgmt_doc_view)
async def list_risk_participant(keyword: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_risk_participant(keyword=keyword, page_index=page_index, page_size=page_size)


@router.post("/add_risk_analysis", summary="添加风险分析矩阵", response_model=Resp[RiskAnalysisForm])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def add_risk_analysis(form: RiskAnalysisForm):
    return await server.add_risk_analysis(form)


@router.post("/update_risk_analysis", summary="更新风险分析矩阵", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def update_risk_analysis(form: RiskAnalysisForm):
    return await server.update_risk_analysis(form)


@router.delete("/delete_risk_analysis", summary="删除风险分析矩阵", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def delete_risk_analysis(id: int):
    return await server.delete_risk_analysis(id)


@router.get("/list_risk_analysis", summary="查询风险分析矩阵列表", response_model=Resp[Page[RiskAnalysisObj]])
@try_log(perm=Perms.risk_mgmt_doc_view)
async def list_risk_analysis(product_id: int = 0, doc_id: int = 0, keyword: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_risk_analysis(product_id=product_id, doc_id=doc_id, keyword=keyword, page_index=page_index, page_size=page_size)


@router.post("/add_risk_control", summary="添加风险控制措施", response_model=Resp[RiskControlForm])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def add_risk_control(form: RiskControlForm):
    return await server.add_risk_control(form)


@router.post("/update_risk_control", summary="更新风险控制措施", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def update_risk_control(form: RiskControlForm):
    return await server.update_risk_control(form)


@router.delete("/delete_risk_control", summary="删除风险控制措施", response_model=Resp[Any])
@try_log(perm=Perms.risk_mgmt_doc_edit)
async def delete_risk_control(id: int):
    return await server.delete_risk_control(id)


@router.get("/list_risk_control", summary="查询风险控制措施列表", response_model=Resp[Page[RiskControlObj]])
@try_log(perm=Perms.risk_mgmt_doc_view)
async def list_risk_control(product_id: int = 0, doc_id: int = 0, keyword: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_risk_control(product_id=product_id, doc_id=doc_id, keyword=keyword, page_index=page_index, page_size=page_size)


@router.get("/export_risk_mgmt_doc", summary="导出风险管理文档")
@try_log(perm=Perms.risk_mgmt_doc_view)
async def export_risk_mgmt_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_risk_mgmt_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"风险管理报告-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
