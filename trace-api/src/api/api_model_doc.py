#!/usr/bin/env python
# encoding: utf-8

# 模型文件接口层，详见 docs/function_docs/99_模型文件管理.md。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_model_doc import ModelDocForm
from ..obj.vobj_model_doc import ModelDocObj
from ..serv.serv_model_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_model_doc", summary="添加模型文件", response_model=Resp[ModelDocForm])
@try_log(perm=Perms.model_doc_edit)
async def add_model_doc(form: ModelDocForm):
    return await server.add_model_doc(form)


@router.get("/duplicate_model_doc", summary="复制模型文件", response_model=Resp[ModelDocForm])
@try_log(perm=Perms.model_doc_edit)
async def duplicate_model_doc(id: int, product_id: int = None):
    return await server.duplicate_model_doc(id, product_id)


@router.post("/update_model_doc", summary="更新模型文件", response_model=Resp[Any])
@try_log(perm=Perms.model_doc_edit)
async def update_model_doc(form: ModelDocForm):
    return await server.update_model_doc(form)


@router.delete("/delete_model_doc", summary="删除模型文件", response_model=Resp[Any])
@try_log(perm=Perms.model_doc_edit)
async def delete_model_doc(id: int):
    return await server.delete_model_doc(id)


@router.get("/list_model_doc", summary="查询模型文件列表", response_model=Resp[Page[ModelDocObj]])
@try_log(perm=Perms.model_doc_view)
async def list_model_doc(product_id: int = 0, version: str = None, doc_type: str = None,
                         page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_model_doc(
        op_user=op_user, product_id=product_id, version=version, doc_type=doc_type,
        page_index=page_index, page_size=page_size,
    )


@router.get("/get_model_doc", summary="查询模型文件详情", response_model=Resp[ModelDocObj])
@try_log(perm=Perms.model_doc_view)
async def get_model_doc(id: int):
    return await server.get_model_doc(id)


@router.get("/export_model_doc", summary="导出模型文件")
@try_log(perm=Perms.model_doc_view)
async def export_model_doc(id: int = 0):
    output = io.BytesIO()
    result = await server.export_model_doc(output, id) or ("模型文件", "docx")
    if isinstance(result, tuple):
        title, ext = result[0] or "模型文件", result[1] or "docx"
    else:
        title, ext = result, "docx"
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{title}-{timestamp}.{ext}")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
