#!/usr/bin/env python
# encoding: utf-8

# 软件测试报告接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_str_doc import StrDocForm
from ..obj.vobj_str_doc import StrDocObj
from ..serv.serv_str_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_str_doc", summary="添加软件测试报告", response_model=Resp[StrDocForm])
@try_log(perm=Perms.str_doc_edit)
async def add_str_doc(form: StrDocForm):
    return await server.add_str_doc(form)


@router.get("/duplicate_str_doc", summary="复制软件测试报告", response_model=Resp[StrDocForm])
@try_log(perm=Perms.str_doc_edit)
async def duplicate_str_doc(id: int, product_id: int = None):
    return await server.duplicate_str_doc(id, product_id)


@router.post("/update_str_doc", summary="更新软件测试报告", response_model=Resp[Any])
@try_log(perm=Perms.str_doc_edit)
async def update_str_doc(form: StrDocForm):
    return await server.update_str_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[StrDocObj])
@try_log(perm=Perms.str_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_str_doc", summary="删除软件测试报告", response_model=Resp[Any])
@try_log(perm=Perms.str_doc_edit)
async def delete_str_doc(id: int):
    return await server.delete_str_doc(id)


@router.get("/list_str_doc", summary="查询软件测试报告列表", response_model=Resp[Page[StrDocObj]])
@try_log(perm=Perms.str_doc_view)
async def list_str_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_str_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_str_doc", summary="查询软件测试报告详情", response_model=Resp[StrDocObj])
@try_log(perm=Perms.str_doc_view)
async def get_str_doc(id: int):
    return await server.get_str_doc(id)


@router.get("/export_str_doc", summary="导出软件测试报告")
@try_log(perm=Perms.str_doc_view)
async def export_str_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_str_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"软件测试报告-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
