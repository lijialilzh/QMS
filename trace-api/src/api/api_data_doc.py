#!/usr/bin/env python
# encoding: utf-8

# 数据文件接口层，详见 docs/function_docs/100_数据文件管理.md。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_data_doc import DataDocForm
from ..obj.vobj_data_doc import DataDocObj
from ..serv.serv_data_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_data_doc", summary="添加数据文件", response_model=Resp[DataDocForm])
@try_log(perm=Perms.data_doc_edit)
async def add_data_doc(form: DataDocForm):
    return await server.add_data_doc(form)


@router.get("/duplicate_data_doc", summary="复制数据文件", response_model=Resp[DataDocForm])
@try_log(perm=Perms.data_doc_edit)
async def duplicate_data_doc(id: int, product_id: int = None):
    return await server.duplicate_data_doc(id, product_id)


@router.post("/update_data_doc", summary="更新数据文件", response_model=Resp[Any])
@try_log(perm=Perms.data_doc_edit)
async def update_data_doc(form: DataDocForm):
    return await server.update_data_doc(form)


@router.delete("/delete_data_doc", summary="删除数据文件", response_model=Resp[Any])
@try_log(perm=Perms.data_doc_edit)
async def delete_data_doc(id: int):
    return await server.delete_data_doc(id)


@router.get("/list_data_doc", summary="查询数据文件列表", response_model=Resp[Page[DataDocObj]])
@try_log(perm=Perms.data_doc_view)
async def list_data_doc(product_id: int = 0, version: str = None, doc_type: str = None,
                         page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_data_doc(
        op_user=op_user, product_id=product_id, version=version, doc_type=doc_type,
        page_index=page_index, page_size=page_size,
    )


@router.get("/get_data_doc", summary="查询数据文件详情", response_model=Resp[DataDocObj])
@try_log(perm=Perms.data_doc_view)
async def get_data_doc(id: int):
    return await server.get_data_doc(id)


@router.get("/export_data_doc", summary="导出数据文件")
@try_log(perm=Perms.data_doc_view)
async def export_data_doc(id: int = 0):
    output = io.BytesIO()
    result = await server.export_data_doc(output, id) or ("数据文件", "docx")
    if isinstance(result, tuple):
        title, ext = result[0] or "数据文件", result[1] or "docx"
    else:
        title, ext = result, "docx"
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{title}-{timestamp}.{ext}")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import_stats_excel", summary="导入统计脚本 Excel（仅解析，不落库）")
@try_log(perm=Perms.data_doc_edit)
async def import_stats_excel(file: UploadFile = File(...)):
    raw = await file.read()
    return server.parse_stats_excel(raw)
