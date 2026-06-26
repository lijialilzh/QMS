#!/usr/bin/env python
# encoding: utf-8

# 产品标签样稿接口层，详见 docs/function_docs/58_产品标签样稿.md。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_label_doc import LabelDocForm
from ..obj.vobj_label_doc import LabelDocObj
from ..serv.serv_label_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_label_doc", summary="添加产品标签样稿", response_model=Resp[LabelDocForm])
@try_log(perm=Perms.label_doc_edit)
async def add_label_doc(form: LabelDocForm):
    return await server.add_label_doc(form)


@router.get("/duplicate_label_doc", summary="复制产品标签样稿", response_model=Resp[LabelDocForm])
@try_log(perm=Perms.label_doc_edit)
async def duplicate_label_doc(id: int, product_id: int = None):
    return await server.duplicate_label_doc(id, product_id)


@router.post("/update_label_doc", summary="更新产品标签样稿", response_model=Resp[Any])
@try_log(perm=Perms.label_doc_edit)
async def update_label_doc(form: LabelDocForm):
    return await server.update_label_doc(form)


@router.delete("/delete_label_doc", summary="删除产品标签样稿", response_model=Resp[Any])
@try_log(perm=Perms.label_doc_edit)
async def delete_label_doc(id: int):
    return await server.delete_label_doc(id)


@router.get("/list_label_doc", summary="查询产品标签样稿列表", response_model=Resp[Page[LabelDocObj]])
@try_log(perm=Perms.label_doc_view)
async def list_label_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_label_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_label_doc", summary="查询产品标签样稿详情", response_model=Resp[LabelDocObj])
@try_log(perm=Perms.label_doc_view)
async def get_label_doc(id: int):
    return await server.get_label_doc(id)


@router.get("/export_label_doc", summary="导出产品标签样稿")
@try_log(perm=Perms.label_doc_view)
async def export_label_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_label_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"产品标签样稿-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
