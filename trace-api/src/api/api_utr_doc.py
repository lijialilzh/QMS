#!/usr/bin/env python
# encoding: utf-8

# 用户测试报告接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_utr_doc import UtrDocForm
from ..obj.vobj_utr_doc import UtrDocObj
from ..serv.serv_utr_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_utr_doc", summary="添加用户测试报告", response_model=Resp[UtrDocForm])
@try_log(perm=Perms.utr_doc_edit)
async def add_utr_doc(form: UtrDocForm):
    return await server.add_utr_doc(form)


@router.get("/duplicate_utr_doc", summary="复制用户测试报告", response_model=Resp[UtrDocForm])
@try_log(perm=Perms.utr_doc_edit)
async def duplicate_utr_doc(id: int, product_id: int = None):
    return await server.duplicate_utr_doc(id, product_id)


@router.post("/update_utr_doc", summary="更新用户测试报告", response_model=Resp[Any])
@try_log(perm=Perms.utr_doc_edit)
async def update_utr_doc(form: UtrDocForm):
    return await server.update_utr_doc(form)


@router.delete("/delete_utr_doc", summary="删除用户测试报告", response_model=Resp[Any])
@try_log(perm=Perms.utr_doc_edit)
async def delete_utr_doc(id: int):
    return await server.delete_utr_doc(id)


@router.get("/list_utr_doc", summary="查询用户测试报告列表", response_model=Resp[Page[UtrDocObj]])
@try_log(perm=Perms.utr_doc_view)
async def list_utr_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_utr_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_utr_doc", summary="查询用户测试报告详情", response_model=Resp[UtrDocObj])
@try_log(perm=Perms.utr_doc_view)
async def get_utr_doc(id: int):
    return await server.get_utr_doc(id)


@router.get("/export_utr_doc", summary="导出用户测试报告")
@try_log(perm=Perms.utr_doc_view)
async def export_utr_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_utr_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"用户测试报告-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
