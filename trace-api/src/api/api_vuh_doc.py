#!/usr/bin/env python
# encoding: utf-8

# 版本更新历史接口层，详见 docs/function_docs/54_版本更新历史.md。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_vuh_doc import VuhDocForm
from ..obj.vobj_vuh_doc import VuhDocObj
from ..serv.serv_vuh_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_vuh_doc", summary="添加版本更新历史", response_model=Resp[VuhDocForm])
@try_log(perm=Perms.vuh_doc_edit)
async def add_vuh_doc(form: VuhDocForm):
    return await server.add_vuh_doc(form)


@router.get("/duplicate_vuh_doc", summary="复制版本更新历史", response_model=Resp[VuhDocForm])
@try_log(perm=Perms.vuh_doc_edit)
async def duplicate_vuh_doc(id: int, product_id: int = None):
    return await server.duplicate_vuh_doc(id, product_id)


@router.post("/update_vuh_doc", summary="更新版本更新历史", response_model=Resp[Any])
@try_log(perm=Perms.vuh_doc_edit)
async def update_vuh_doc(form: VuhDocForm):
    return await server.update_vuh_doc(form)


@router.delete("/delete_vuh_doc", summary="删除版本更新历史", response_model=Resp[Any])
@try_log(perm=Perms.vuh_doc_edit)
async def delete_vuh_doc(id: int):
    return await server.delete_vuh_doc(id)


@router.get("/list_vuh_doc", summary="查询版本更新历史列表", response_model=Resp[Page[VuhDocObj]])
@try_log(perm=Perms.vuh_doc_view)
async def list_vuh_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_vuh_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_vuh_doc", summary="查询版本更新历史详情", response_model=Resp[VuhDocObj])
@try_log(perm=Perms.vuh_doc_view)
async def get_vuh_doc(id: int):
    return await server.get_vuh_doc(id)


@router.get("/export_vuh_doc", summary="导出版本更新历史")
@try_log(perm=Perms.vuh_doc_view)
async def export_vuh_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_vuh_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"版本更新历史-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
