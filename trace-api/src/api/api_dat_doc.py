#!/usr/bin/env python
# encoding: utf-8

# 数据申请单接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_dat_doc import DatDocForm
from ..obj.vobj_dat_doc import DatDocObj
from ..serv.serv_dat_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_dat_doc", summary="添加数据申请单", response_model=Resp[DatDocForm])
@try_log(perm=Perms.dat_doc_edit)
async def add_dat_doc(form: DatDocForm):
    return await server.add_dat_doc(form)


@router.get("/duplicate_dat_doc", summary="复制数据申请单", response_model=Resp[DatDocForm])
@try_log(perm=Perms.dat_doc_edit)
async def duplicate_dat_doc(id: int, product_id: int = None):
    return await server.duplicate_dat_doc(id, product_id)


@router.post("/update_dat_doc", summary="更新数据申请单", response_model=Resp[Any])
@try_log(perm=Perms.dat_doc_edit)
async def update_dat_doc(form: DatDocForm):
    return await server.update_dat_doc(form)


@router.delete("/delete_dat_doc", summary="删除数据申请单", response_model=Resp[Any])
@try_log(perm=Perms.dat_doc_edit)
async def delete_dat_doc(id: int):
    return await server.delete_dat_doc(id)


@router.get("/list_dat_doc", summary="查询数据申请单列表", response_model=Resp[Page[DatDocObj]])
@try_log(perm=Perms.dat_doc_view)
async def list_dat_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_dat_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_dat_doc", summary="查询数据申请单详情", response_model=Resp[DatDocObj])
@try_log(perm=Perms.dat_doc_view)
async def get_dat_doc(id: int):
    return await server.get_dat_doc(id)


@router.get("/export_dat_doc", summary="导出数据申请单")
@try_log(perm=Perms.dat_doc_view)
async def export_dat_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_dat_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"数据申请单-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
