#!/usr/bin/env python
# encoding: utf-8

# 网络安全风险管理计划接口层，与网络安全风险管理报告（api_cybersec_doc）独立并行。

import io
import urllib.parse
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_cybersec_plan_doc import CybersecPlanDocForm
from ..obj.vobj_cybersec_plan_doc import CybersecPlanDocObj
from ..serv.serv_cybersec_plan_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_cybersec_plan_doc", summary="添加网络安全风险管理计划", response_model=Resp[CybersecPlanDocForm])
@try_log(perm=Perms.cybersec_plan_doc_edit)
async def add_cybersec_plan_doc(form: CybersecPlanDocForm):
    return server.add_cybersec_plan_doc(form)


@router.get("/duplicate_cybersec_plan_doc", summary="复制网络安全风险管理计划", response_model=Resp[CybersecPlanDocForm])
@try_log(perm=Perms.cybersec_plan_doc_edit)
async def duplicate_cybersec_plan_doc(id: int, product_id: int = None):
    return server.duplicate_cybersec_plan_doc(id, product_id)


@router.post("/update_cybersec_plan_doc", summary="更新网络安全风险管理计划", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_plan_doc_edit)
async def update_cybersec_plan_doc(form: CybersecPlanDocForm):
    return server.update_cybersec_plan_doc(form)


@router.delete("/delete_cybersec_plan_doc", summary="删除网络安全风险管理计划", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_plan_doc_edit)
async def delete_cybersec_plan_doc(id: int):
    return server.delete_cybersec_plan_doc(id)


@router.get("/list_cybersec_plan_doc", summary="查询网络安全风险管理计划列表", response_model=Resp[Page[CybersecPlanDocObj]])
@try_log(perm=Perms.cybersec_plan_doc_view)
async def list_cybersec_plan_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return server.list_cybersec_plan_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_cybersec_plan_doc", summary="查询网络安全风险管理计划详情", response_model=Resp[CybersecPlanDocObj])
@try_log(perm=Perms.cybersec_plan_doc_view)
async def get_cybersec_plan_doc(id: int):
    return server.get_cybersec_plan_doc(id)


@router.get("/cybersec_plan_autofill", summary="网络安全风险管理计划自动获取预览", response_model=Resp[Any])
@try_log(perm=Perms.cybersec_plan_doc_view)
async def cybersec_plan_autofill(product_id: int, version: str = ""):
    return server.cybersec_plan_autofill(product_id, version)


@router.get("/export_cybersec_plan_doc", summary="导出网络安全风险管理计划")
@try_log(perm=Perms.cybersec_plan_doc_view)
async def export_cybersec_plan_doc(id: int):
    output = io.BytesIO()
    server.export_cybersec_plan_doc(output, id)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename={urllib.parse.quote('网络安全风险管理计划.docx')}"},
    )
