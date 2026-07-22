#!/usr/bin/env python
# encoding: utf-8

# 软件开发计划接口层，模板参考产品开发计划(api_pdp_doc)。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_sd_doc import SdDocForm
from ..obj.vobj_sd_doc import SdDocObj
from ..serv.serv_sd_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_sd_doc", summary="添加软件开发计划", response_model=Resp[SdDocForm])
@try_log(perm=Perms.sd_doc_edit)
async def add_sd_doc(form: SdDocForm):
    return await server.add_sd_doc(form)


@router.get("/duplicate_sd_doc", summary="复制软件开发计划", response_model=Resp[SdDocForm])
@try_log(perm=Perms.sd_doc_edit)
async def duplicate_sd_doc(id: int, product_id: int = None):
    return await server.duplicate_sd_doc(id, product_id)


@router.post("/update_sd_doc", summary="更新软件开发计划", response_model=Resp[Any])
@try_log(perm=Perms.sd_doc_edit)
async def update_sd_doc(form: SdDocForm):
    return await server.update_sd_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[SdDocObj])
@try_log(perm=Perms.sd_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_sd_doc", summary="删除软件开发计划", response_model=Resp[Any])
@try_log(perm=Perms.sd_doc_edit)
async def delete_sd_doc(id: int):
    return await server.delete_sd_doc(id)


@router.get("/list_sd_doc", summary="查询软件开发计划列表", response_model=Resp[Page[SdDocObj]])
@try_log(perm=Perms.sd_doc_view)
async def list_sd_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_sd_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_sd_doc", summary="查询软件开发计划详情", response_model=Resp[SdDocObj])
@try_log(perm=Perms.sd_doc_view)
async def get_sd_doc(id: int):
    return await server.get_sd_doc(id)


@router.get("/export_sd_doc", summary="导出软件开发计划")
@try_log(perm=Perms.sd_doc_view)
async def export_sd_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_sd_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"软件开发计划-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
