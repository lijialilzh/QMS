#!/usr/bin/env python
# encoding: utf-8

# 网络安全管理接口层，对应 docs/function_docs/47_网络安全管理.md 第 4 节。
# 与风险管理报告（api_risk_mgmt_doc）零耦合。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_cybersec_doc import (
    CybersecDocForm,
    CybersecThreatForm,
    CybersecControlInternalForm,
    CybersecControlSbomForm,
    CybersecControlScanForm,
)
from ..obj.vobj_cybersec_doc import (
    CybersecDocObj,
    CybersecThreatObj,
    CybersecControlInternalObj,
    CybersecControlSbomObj,
    CybersecControlScanObj,
)
from ..serv.serv_cybersec_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


# ---------------- 文档 ----------------
@router.post("/add_cybersec_doc", summary="添加网络安全报告", response_model=Resp[CybersecDocForm])
@try_log(perm=Perms.cybersec_doc_edit)
async def add_cybersec_doc(form: CybersecDocForm):
    return await server.add_cybersec_doc(form)


@router.post("/import_cybersec_doc_word", summary="导入Word并创建网络安全报告", response_model=Resp[CybersecDocForm])
@try_log(perm=Perms.cybersec_doc_edit)
async def import_cybersec_doc_word(
    product_id: int = Form(...),
    version: str = Form(...),
    file_no: str = Form(""),
    change_log: str = Form(""),
    file: UploadFile = File(...),
):
    return await server.import_cybersec_doc_word(
        product_id=product_id,
        version=version,
        file_no=file_no,
        change_log=change_log,
        file=file,
    )


@router.get("/duplicate_cybersec_doc", summary="复制网络安全报告", response_model=Resp[CybersecDocForm])
@try_log(perm=Perms.cybersec_doc_edit)
async def duplicate_cybersec_doc(id: int, product_id: int = None):
    return await server.duplicate_cybersec_doc(id, product_id)


@router.post("/update_cybersec_doc", summary="更新网络安全报告", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def update_cybersec_doc(form: CybersecDocForm):
    return await server.update_cybersec_doc(form)


@router.delete("/delete_cybersec_doc", summary="删除网络安全报告", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def delete_cybersec_doc(id: int):
    return await server.delete_cybersec_doc(id)


@router.get("/list_cybersec_doc", summary="查询网络安全报告列表", response_model=Resp[Page[CybersecDocObj]])
@try_log(perm=Perms.cybersec_doc_view)
async def list_cybersec_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_cybersec_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_cybersec_doc", summary="查询网络安全报告详情", response_model=Resp[CybersecDocObj])
@try_log(perm=Perms.cybersec_doc_view)
async def get_cybersec_doc(id: int):
    return await server.get_cybersec_doc(id)


@router.get("/preview_cybersec_content", summary="按产品预览自动填充内容", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_view)
async def preview_cybersec_content(product_id: int = 0, version: str = ""):
    return await server.preview_cybersec_content(product_id=product_id, version=version)


@router.get("/export_cybersec_doc", summary="导出网络安全报告")
@try_log(perm=Perms.cybersec_doc_view)
async def export_cybersec_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_cybersec_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"网络安全风险管理报告-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------- 威胁 ----------------
@router.post("/add_cybersec_threat", summary="添加网络安全威胁", response_model=Resp[CybersecThreatForm])
@try_log(perm=Perms.cybersec_doc_edit)
async def add_cybersec_threat(form: CybersecThreatForm):
    return await server.add_cybersec_threat(form)


@router.post("/update_cybersec_threat", summary="更新网络安全威胁", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def update_cybersec_threat(form: CybersecThreatForm):
    return await server.update_cybersec_threat(form)


@router.delete("/delete_cybersec_threat", summary="删除网络安全威胁", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def delete_cybersec_threat(id: int):
    return await server.delete_cybersec_threat(id)


@router.get("/list_cybersec_threat", summary="查询网络安全威胁列表", response_model=Resp[Page[CybersecThreatObj]])
@try_log(perm=Perms.cybersec_doc_view)
async def list_cybersec_threat(product_id: int = 0, doc_id: int = 0, view_type: str = None, keyword: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_cybersec_threat(product_id=product_id, doc_id=doc_id, view_type=view_type, keyword=keyword, page_index=page_index, page_size=page_size)


# ---------------- 内部 RCM ----------------
@router.post("/add_cybersec_control_internal", summary="添加内部RCM", response_model=Resp[CybersecControlInternalForm])
@try_log(perm=Perms.cybersec_doc_edit)
async def add_cybersec_control_internal(form: CybersecControlInternalForm):
    return await server.add_cybersec_control_internal(form)


@router.post("/update_cybersec_control_internal", summary="更新内部RCM", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def update_cybersec_control_internal(form: CybersecControlInternalForm):
    return await server.update_cybersec_control_internal(form)


@router.delete("/delete_cybersec_control_internal", summary="删除内部RCM", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def delete_cybersec_control_internal(id: int):
    return await server.delete_cybersec_control_internal(id)


@router.get("/list_cybersec_control_internal", summary="查询内部RCM列表", response_model=Resp[Page[CybersecControlInternalObj]])
@try_log(perm=Perms.cybersec_doc_view)
async def list_cybersec_control_internal(product_id: int = 0, doc_id: int = 0, keyword: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_cybersec_control_internal(product_id=product_id, doc_id=doc_id, keyword=keyword, page_index=page_index, page_size=page_size)


# ---------------- SBOM RCM ----------------
@router.post("/add_cybersec_control_sbom", summary="添加SBOM RCM", response_model=Resp[CybersecControlSbomForm])
@try_log(perm=Perms.cybersec_doc_edit)
async def add_cybersec_control_sbom(form: CybersecControlSbomForm):
    return await server.add_cybersec_control_sbom(form)


@router.post("/update_cybersec_control_sbom", summary="更新SBOM RCM", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def update_cybersec_control_sbom(form: CybersecControlSbomForm):
    return await server.update_cybersec_control_sbom(form)


@router.delete("/delete_cybersec_control_sbom", summary="删除SBOM RCM", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def delete_cybersec_control_sbom(id: int):
    return await server.delete_cybersec_control_sbom(id)


@router.get("/list_cybersec_control_sbom", summary="查询SBOM RCM列表", response_model=Resp[Page[CybersecControlSbomObj]])
@try_log(perm=Perms.cybersec_doc_view)
async def list_cybersec_control_sbom(product_id: int = 0, doc_id: int = 0, keyword: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_cybersec_control_sbom(product_id=product_id, doc_id=doc_id, keyword=keyword, page_index=page_index, page_size=page_size)


# ---------------- 网络安全扫描 RCM ----------------
@router.post("/add_cybersec_control_scan", summary="添加网络安全扫描RCM", response_model=Resp[CybersecControlScanForm])
@try_log(perm=Perms.cybersec_doc_edit)
async def add_cybersec_control_scan(form: CybersecControlScanForm):
    return await server.add_cybersec_control_scan(form)


@router.post("/update_cybersec_control_scan", summary="更新网络安全扫描RCM", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def update_cybersec_control_scan(form: CybersecControlScanForm):
    return await server.update_cybersec_control_scan(form)


@router.delete("/delete_cybersec_control_scan", summary="删除网络安全扫描RCM", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_doc_edit)
async def delete_cybersec_control_scan(id: int):
    return await server.delete_cybersec_control_scan(id)


@router.get("/list_cybersec_control_scan", summary="查询网络安全扫描RCM列表", response_model=Resp[Page[CybersecControlScanObj]])
@try_log(perm=Perms.cybersec_doc_view)
async def list_cybersec_control_scan(product_id: int = 0, doc_id: int = 0, keyword: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_cybersec_control_scan(product_id=product_id, doc_id=doc_id, keyword=keyword, page_index=page_index, page_size=page_size)
