#!/usr/bin/env python
# encoding: utf-8

# 产品开发计划接口层，详见 docs/function_docs/52_产品开发计划.md。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_pdp_doc import PdpDocForm
from ..obj.vobj_pdp_doc import PdpDocObj
from ..serv.serv_pdp_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_pdp_doc", summary="添加产品开发计划", response_model=Resp[PdpDocForm])
@try_log(perm=Perms.pdp_doc_edit)
async def add_pdp_doc(form: PdpDocForm):
    return await server.add_pdp_doc(form)


@router.get("/duplicate_pdp_doc", summary="复制产品开发计划", response_model=Resp[PdpDocForm])
@try_log(perm=Perms.pdp_doc_edit)
async def duplicate_pdp_doc(id: int, product_id: int = None):
    return await server.duplicate_pdp_doc(id, product_id)


@router.post("/update_pdp_doc", summary="更新产品开发计划", response_model=Resp[Any])
@try_log(perm=Perms.pdp_doc_edit)
async def update_pdp_doc(form: PdpDocForm):
    return await server.update_pdp_doc(form)


@router.delete("/delete_pdp_doc", summary="删除产品开发计划", response_model=Resp[Any])
@try_log(perm=Perms.pdp_doc_edit)
async def delete_pdp_doc(id: int):
    return await server.delete_pdp_doc(id)


@router.get("/list_pdp_doc", summary="查询产品开发计划列表", response_model=Resp[Page[PdpDocObj]])
@try_log(perm=Perms.pdp_doc_view)
async def list_pdp_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_pdp_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_pdp_doc", summary="查询产品开发计划详情", response_model=Resp[PdpDocObj])
@try_log(perm=Perms.pdp_doc_view)
async def get_pdp_doc(id: int):
    return await server.get_pdp_doc(id)


@router.get("/export_pdp_doc", summary="导出产品开发计划")
@try_log(perm=Perms.pdp_doc_view)
async def export_pdp_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_pdp_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"产品开发计划-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
