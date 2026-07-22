#!/usr/bin/env python
# encoding: utf-8

# 用户测试计划接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_utp_doc import UtpDocForm
from ..obj.vobj_utp_doc import UtpDocObj
from ..serv.serv_utp_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_utp_doc", summary="添加用户测试计划", response_model=Resp[UtpDocForm])
@try_log(perm=Perms.utp_doc_edit)
async def add_utp_doc(form: UtpDocForm):
    return await server.add_utp_doc(form)


@router.get("/duplicate_utp_doc", summary="复制用户测试计划", response_model=Resp[UtpDocForm])
@try_log(perm=Perms.utp_doc_edit)
async def duplicate_utp_doc(id: int, product_id: int = None):
    return await server.duplicate_utp_doc(id, product_id)


@router.post("/update_utp_doc", summary="更新用户测试计划", response_model=Resp[Any])
@try_log(perm=Perms.utp_doc_edit)
async def update_utp_doc(form: UtpDocForm):
    return await server.update_utp_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[UtpDocObj])
@try_log(perm=Perms.utp_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_utp_doc", summary="删除用户测试计划", response_model=Resp[Any])
@try_log(perm=Perms.utp_doc_edit)
async def delete_utp_doc(id: int):
    return await server.delete_utp_doc(id)


@router.get("/list_utp_doc", summary="查询用户测试计划列表", response_model=Resp[Page[UtpDocObj]])
@try_log(perm=Perms.utp_doc_view)
async def list_utp_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_utp_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_utp_doc", summary="查询用户测试计划详情", response_model=Resp[UtpDocObj])
@try_log(perm=Perms.utp_doc_view)
async def get_utp_doc(id: int):
    return await server.get_utp_doc(id)


@router.get("/export_utp_doc", summary="导出用户测试计划")
@try_log(perm=Perms.utp_doc_view)
async def export_utp_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_utp_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"用户测试计划-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
