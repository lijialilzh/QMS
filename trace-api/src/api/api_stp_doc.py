#!/usr/bin/env python
# encoding: utf-8

# 软件测试计划接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_stp_doc import StpDocForm
from ..obj.vobj_stp_doc import StpDocObj
from ..serv.serv_stp_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_stp_doc", summary="添加软件测试计划", response_model=Resp[StpDocForm])
@try_log(perm=Perms.stp_doc_edit)
async def add_stp_doc(form: StpDocForm):
    return await server.add_stp_doc(form)


@router.get("/duplicate_stp_doc", summary="复制软件测试计划", response_model=Resp[StpDocForm])
@try_log(perm=Perms.stp_doc_edit)
async def duplicate_stp_doc(id: int, product_id: int = None):
    return await server.duplicate_stp_doc(id, product_id)


@router.post("/update_stp_doc", summary="更新软件测试计划", response_model=Resp[Any])
@try_log(perm=Perms.stp_doc_edit)
async def update_stp_doc(form: StpDocForm):
    return await server.update_stp_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[StpDocObj])
@try_log(perm=Perms.stp_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_stp_doc", summary="删除软件测试计划", response_model=Resp[Any])
@try_log(perm=Perms.stp_doc_edit)
async def delete_stp_doc(id: int):
    return await server.delete_stp_doc(id)


@router.get("/list_stp_doc", summary="查询软件测试计划列表", response_model=Resp[Page[StpDocObj]])
@try_log(perm=Perms.stp_doc_view)
async def list_stp_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_stp_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_stp_doc", summary="查询软件测试计划详情", response_model=Resp[StpDocObj])
@try_log(perm=Perms.stp_doc_view)
async def get_stp_doc(id: int):
    return await server.get_stp_doc(id)


@router.get("/export_stp_doc", summary="导出软件测试计划")
@try_log(perm=Perms.stp_doc_view)
async def export_stp_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_stp_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"软件测试计划-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
