#!/usr/bin/env python
# encoding: utf-8

# 开发设备清单接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_deq_doc import DeqDocForm
from ..obj.vobj_deq_doc import DeqDocObj
from ..serv.serv_deq_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_deq_doc", summary="添加开发设备清单", response_model=Resp[DeqDocForm])
@try_log(perm=Perms.deq_doc_edit)
async def add_deq_doc(form: DeqDocForm):
    return await server.add_deq_doc(form)


@router.get("/duplicate_deq_doc", summary="复制开发设备清单", response_model=Resp[DeqDocForm])
@try_log(perm=Perms.deq_doc_edit)
async def duplicate_deq_doc(id: int, product_id: int = None):
    return await server.duplicate_deq_doc(id, product_id)


@router.post("/update_deq_doc", summary="更新开发设备清单", response_model=Resp[Any])
@try_log(perm=Perms.deq_doc_edit)
async def update_deq_doc(form: DeqDocForm):
    return await server.update_deq_doc(form)


@router.delete("/delete_deq_doc", summary="删除开发设备清单", response_model=Resp[Any])
@try_log(perm=Perms.deq_doc_edit)
async def delete_deq_doc(id: int):
    return await server.delete_deq_doc(id)


@router.get("/list_deq_doc", summary="查询开发设备清单列表", response_model=Resp[Page[DeqDocObj]])
@try_log(perm=Perms.deq_doc_view)
async def list_deq_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_deq_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_deq_doc", summary="查询开发设备清单详情", response_model=Resp[DeqDocObj])
@try_log(perm=Perms.deq_doc_view)
async def get_deq_doc(id: int):
    return await server.get_deq_doc(id)


@router.get("/export_deq_doc", summary="导出开发设备清单")
@try_log(perm=Perms.deq_doc_view)
async def export_deq_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_deq_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"开发设备清单-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
