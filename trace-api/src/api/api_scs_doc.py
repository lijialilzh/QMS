#!/usr/bin/env python
# encoding: utf-8

# 软件配置状态报告接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_scs_doc import ScsDocForm
from ..obj.vobj_scs_doc import ScsDocObj
from ..serv.serv_scs_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_scs_doc", summary="添加软件配置状态报告", response_model=Resp[ScsDocForm])
@try_log(perm=Perms.scs_doc_edit)
async def add_scs_doc(form: ScsDocForm):
    return await server.add_scs_doc(form)


@router.get("/duplicate_scs_doc", summary="复制软件配置状态报告", response_model=Resp[ScsDocForm])
@try_log(perm=Perms.scs_doc_edit)
async def duplicate_scs_doc(id: int, product_id: int = None):
    return await server.duplicate_scs_doc(id, product_id)


@router.post("/update_scs_doc", summary="更新软件配置状态报告", response_model=Resp[Any])
@try_log(perm=Perms.scs_doc_edit)
async def update_scs_doc(form: ScsDocForm):
    return await server.update_scs_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[ScsDocObj])
@try_log(perm=Perms.scs_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_scs_doc", summary="删除软件配置状态报告", response_model=Resp[Any])
@try_log(perm=Perms.scs_doc_edit)
async def delete_scs_doc(id: int):
    return await server.delete_scs_doc(id)


@router.get("/list_scs_doc", summary="查询软件配置状态报告列表", response_model=Resp[Page[ScsDocObj]])
@try_log(perm=Perms.scs_doc_view)
async def list_scs_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_scs_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_scs_doc", summary="查询软件配置状态报告详情", response_model=Resp[ScsDocObj])
@try_log(perm=Perms.scs_doc_view)
async def get_scs_doc(id: int):
    return await server.get_scs_doc(id)


@router.get("/export_scs_doc", summary="导出软件配置状态报告")
@try_log(perm=Perms.scs_doc_view)
async def export_scs_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_scs_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"软件配置状态报告-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
