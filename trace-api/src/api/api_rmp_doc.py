#!/usr/bin/env python
# encoding: utf-8

# 风险管理计划接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_rmp_doc import RmpDocForm
from ..obj.vobj_rmp_doc import RmpDocObj
from ..serv.serv_rmp_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_rmp_doc", summary="添加风险管理计划", response_model=Resp[RmpDocForm])
@try_log(perm=Perms.rmp_doc_edit)
async def add_rmp_doc(form: RmpDocForm):
    return await server.add_rmp_doc(form)


@router.get("/duplicate_rmp_doc", summary="复制风险管理计划", response_model=Resp[RmpDocForm])
@try_log(perm=Perms.rmp_doc_edit)
async def duplicate_rmp_doc(id: int, product_id: int = None):
    return await server.duplicate_rmp_doc(id, product_id)


@router.post("/update_rmp_doc", summary="更新风险管理计划", response_model=Resp[Any])
@try_log(perm=Perms.rmp_doc_edit)
async def update_rmp_doc(form: RmpDocForm):
    return await server.update_rmp_doc(form)


@router.delete("/delete_rmp_doc", summary="删除风险管理计划", response_model=Resp[Any])
@try_log(perm=Perms.rmp_doc_edit)
async def delete_rmp_doc(id: int):
    return await server.delete_rmp_doc(id)


@router.get("/list_rmp_doc", summary="查询风险管理计划列表", response_model=Resp[Page[RmpDocObj]])
@try_log(perm=Perms.rmp_doc_view)
async def list_rmp_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_rmp_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_rmp_doc", summary="查询风险管理计划详情", response_model=Resp[RmpDocObj])
@try_log(perm=Perms.rmp_doc_view)
async def get_rmp_doc(id: int):
    return await server.get_rmp_doc(id)


@router.get("/rmp_autofill", summary="风险管理计划自动获取预览", response_model=Resp[Any])
@try_log(perm=Perms.rmp_doc_view)
async def rmp_autofill(product_id: int, version: str = ""):
    return await server.rmp_autofill(product_id, version)


@router.get("/export_rmp_doc", summary="导出风险管理计划")
@try_log(perm=Perms.rmp_doc_view)
async def export_rmp_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_rmp_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"风险管理计划-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
