#!/usr/bin/env python
# encoding: utf-8

# 代码审查记录接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_crr_doc import CrrDocForm
from ..obj.vobj_crr_doc import CrrDocObj
from ..serv.serv_crr_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_crr_doc", summary="添加代码审查记录", response_model=Resp[CrrDocForm])
@try_log(perm=Perms.crr_doc_edit)
async def add_crr_doc(form: CrrDocForm):
    return await server.add_crr_doc(form)


@router.get("/duplicate_crr_doc", summary="复制代码审查记录", response_model=Resp[CrrDocForm])
@try_log(perm=Perms.crr_doc_edit)
async def duplicate_crr_doc(id: int, product_id: int = None):
    return await server.duplicate_crr_doc(id, product_id)


@router.post("/update_crr_doc", summary="更新代码审查记录", response_model=Resp[Any])
@try_log(perm=Perms.crr_doc_edit)
async def update_crr_doc(form: CrrDocForm):
    return await server.update_crr_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[CrrDocObj])
@try_log(perm=Perms.crr_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_crr_doc", summary="删除代码审查记录", response_model=Resp[Any])
@try_log(perm=Perms.crr_doc_edit)
async def delete_crr_doc(id: int):
    return await server.delete_crr_doc(id)


@router.get("/list_crr_doc", summary="查询代码审查记录列表", response_model=Resp[Page[CrrDocObj]])
@try_log(perm=Perms.crr_doc_view)
async def list_crr_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_crr_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_crr_doc", summary="查询代码审查记录详情", response_model=Resp[CrrDocObj])
@try_log(perm=Perms.crr_doc_view)
async def get_crr_doc(id: int):
    return await server.get_crr_doc(id)


@router.get("/export_crr_doc", summary="导出代码审查记录")
@try_log(perm=Perms.crr_doc_view)
async def export_crr_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_crr_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"代码审查记录-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
