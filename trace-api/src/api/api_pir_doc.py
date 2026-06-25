#!/usr/bin/env python
# encoding: utf-8

# 产品立项报告接口层，详见 docs/function_docs/53_产品立项报告.md。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_pir_doc import PirDocForm
from ..obj.vobj_pir_doc import PirDocObj
from ..serv.serv_pir_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_pir_doc", summary="添加产品立项报告", response_model=Resp[PirDocForm])
@try_log(perm=Perms.pir_doc_edit)
async def add_pir_doc(form: PirDocForm):
    return await server.add_pir_doc(form)


@router.get("/duplicate_pir_doc", summary="复制产品立项报告", response_model=Resp[PirDocForm])
@try_log(perm=Perms.pir_doc_edit)
async def duplicate_pir_doc(id: int, product_id: int = None):
    return await server.duplicate_pir_doc(id, product_id)


@router.post("/update_pir_doc", summary="更新产品立项报告", response_model=Resp[Any])
@try_log(perm=Perms.pir_doc_edit)
async def update_pir_doc(form: PirDocForm):
    return await server.update_pir_doc(form)


@router.delete("/delete_pir_doc", summary="删除产品立项报告", response_model=Resp[Any])
@try_log(perm=Perms.pir_doc_edit)
async def delete_pir_doc(id: int):
    return await server.delete_pir_doc(id)


@router.get("/list_pir_doc", summary="查询产品立项报告列表", response_model=Resp[Page[PirDocObj]])
@try_log(perm=Perms.pir_doc_view)
async def list_pir_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_pir_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_pir_doc", summary="查询产品立项报告详情", response_model=Resp[PirDocObj])
@try_log(perm=Perms.pir_doc_view)
async def get_pir_doc(id: int):
    return await server.get_pir_doc(id)


@router.get("/export_pir_doc", summary="导出产品立项报告")
@try_log(perm=Perms.pir_doc_view)
async def export_pir_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_pir_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"产品立项报告-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
