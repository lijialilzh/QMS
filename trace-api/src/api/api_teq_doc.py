#!/usr/bin/env python
# encoding: utf-8

# 测试设备清单接口层（测试文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_teq_doc import TeqDocForm
from ..obj.vobj_teq_doc import TeqDocObj
from ..serv.serv_teq_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_teq_doc", summary="添加测试设备清单", response_model=Resp[TeqDocForm])
@try_log(perm=Perms.teq_doc_edit)
async def add_teq_doc(form: TeqDocForm):
    return await server.add_teq_doc(form)


@router.get("/duplicate_teq_doc", summary="复制测试设备清单", response_model=Resp[TeqDocForm])
@try_log(perm=Perms.teq_doc_edit)
async def duplicate_teq_doc(id: int, product_id: int = None):
    return await server.duplicate_teq_doc(id, product_id)


@router.post("/update_teq_doc", summary="更新测试设备清单", response_model=Resp[Any])
@try_log(perm=Perms.teq_doc_edit)
async def update_teq_doc(form: TeqDocForm):
    return await server.update_teq_doc(form)


@router.delete("/delete_teq_doc", summary="删除测试设备清单", response_model=Resp[Any])
@try_log(perm=Perms.teq_doc_edit)
async def delete_teq_doc(id: int):
    return await server.delete_teq_doc(id)


@router.get("/list_teq_doc", summary="查询测试设备清单列表", response_model=Resp[Page[TeqDocObj]])
@try_log(perm=Perms.teq_doc_view)
async def list_teq_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_teq_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_teq_doc", summary="查询测试设备清单详情", response_model=Resp[TeqDocObj])
@try_log(perm=Perms.teq_doc_view)
async def get_teq_doc(id: int):
    return await server.get_teq_doc(id)


@router.get("/export_teq_doc", summary="导出测试设备清单")
@try_log(perm=Perms.teq_doc_view)
async def export_teq_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_teq_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"测试设备清单-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )