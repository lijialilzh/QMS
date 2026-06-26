#!/usr/bin/env python
# encoding: utf-8

# 产品技术要求接口层，详见 docs/function_docs/56_产品技术要求.md。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_ptr_doc import PtrDocForm
from ..obj.vobj_ptr_doc import PtrDocObj
from ..serv.serv_ptr_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_ptr_doc", summary="添加产品技术要求", response_model=Resp[PtrDocForm])
@try_log(perm=Perms.ptr_doc_edit)
async def add_ptr_doc(form: PtrDocForm):
    return await server.add_ptr_doc(form)


@router.get("/duplicate_ptr_doc", summary="复制产品技术要求", response_model=Resp[PtrDocForm])
@try_log(perm=Perms.ptr_doc_edit)
async def duplicate_ptr_doc(id: int, product_id: int = None):
    return await server.duplicate_ptr_doc(id, product_id)


@router.post("/update_ptr_doc", summary="更新产品技术要求", response_model=Resp[Any])
@try_log(perm=Perms.ptr_doc_edit)
async def update_ptr_doc(form: PtrDocForm):
    return await server.update_ptr_doc(form)


@router.delete("/delete_ptr_doc", summary="删除产品技术要求", response_model=Resp[Any])
@try_log(perm=Perms.ptr_doc_edit)
async def delete_ptr_doc(id: int):
    return await server.delete_ptr_doc(id)


@router.get("/list_ptr_doc", summary="查询产品技术要求列表", response_model=Resp[Page[PtrDocObj]])
@try_log(perm=Perms.ptr_doc_view)
async def list_ptr_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_ptr_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_ptr_doc", summary="查询产品技术要求详情", response_model=Resp[PtrDocObj])
@try_log(perm=Perms.ptr_doc_view)
async def get_ptr_doc(id: int):
    return await server.get_ptr_doc(id)


@router.get("/export_ptr_doc", summary="导出产品技术要求")
@try_log(perm=Perms.ptr_doc_view)
async def export_ptr_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_ptr_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"产品技术要求-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
