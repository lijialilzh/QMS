#!/usr/bin/env python
# encoding: utf-8

# 网络安全维护计划接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_nsmp_doc import NsmpDocForm
from ..obj.vobj_nsmp_doc import NsmpDocObj
from ..serv.serv_nsmp_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_nsmp_doc", summary="添加网络安全维护计划", response_model=Resp[NsmpDocForm])
@try_log(perm=Perms.nsmp_doc_edit)
async def add_nsmp_doc(form: NsmpDocForm):
    return await server.add_nsmp_doc(form)


@router.get("/duplicate_nsmp_doc", summary="复制网络安全维护计划", response_model=Resp[NsmpDocForm])
@try_log(perm=Perms.nsmp_doc_edit)
async def duplicate_nsmp_doc(id: int, product_id: int = None):
    return await server.duplicate_nsmp_doc(id, product_id)


@router.post("/update_nsmp_doc", summary="更新网络安全维护计划", response_model=Resp[Any])
@try_log(perm=Perms.nsmp_doc_edit)
async def update_nsmp_doc(form: NsmpDocForm):
    return await server.update_nsmp_doc(form)


@router.delete("/delete_nsmp_doc", summary="删除网络安全维护计划", response_model=Resp[Any])
@try_log(perm=Perms.nsmp_doc_edit)
async def delete_nsmp_doc(id: int):
    return await server.delete_nsmp_doc(id)


@router.get("/list_nsmp_doc", summary="查询网络安全维护计划列表", response_model=Resp[Page[NsmpDocObj]])
@try_log(perm=Perms.nsmp_doc_view)
async def list_nsmp_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_nsmp_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_nsmp_doc", summary="查询网络安全维护计划详情", response_model=Resp[NsmpDocObj])
@try_log(perm=Perms.nsmp_doc_view)
async def get_nsmp_doc(id: int):
    return await server.get_nsmp_doc(id)


@router.get("/nsmp_autofill", summary="网络安全维护计划自动获取预览", response_model=Resp[Any])
@try_log(perm=Perms.nsmp_doc_view)
async def nsmp_autofill(product_id: int, version: str = ""):
    return await server.nsmp_autofill(product_id, version)


@router.get("/export_nsmp_doc", summary="导出网络安全维护计划")
@try_log(perm=Perms.nsmp_doc_view)
async def export_nsmp_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_nsmp_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"网络安全维护计划-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
