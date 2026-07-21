#!/usr/bin/env python
# encoding: utf-8

# 测试环境维护记录接口层（测试文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_tem_doc import TemDocForm
from ..obj.vobj_tem_doc import TemDocObj
from ..serv.serv_tem_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_tem_doc", summary="添加测试环境维护记录", response_model=Resp[TemDocForm])
@try_log(perm=Perms.tem_doc_edit)
async def add_tem_doc(form: TemDocForm):
    return await server.add_tem_doc(form)


@router.get("/duplicate_tem_doc", summary="复制测试环境维护记录", response_model=Resp[TemDocForm])
@try_log(perm=Perms.tem_doc_edit)
async def duplicate_tem_doc(id: int, product_id: int = None):
    return await server.duplicate_tem_doc(id, product_id)


@router.post("/update_tem_doc", summary="更新测试环境维护记录", response_model=Resp[Any])
@try_log(perm=Perms.tem_doc_edit)
async def update_tem_doc(form: TemDocForm):
    return await server.update_tem_doc(form)

@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[TemDocObj])
@try_log(perm=Perms.tem_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)

@router.delete("/delete_tem_doc", summary="删除测试环境维护记录", response_model=Resp[Any])
@try_log(perm=Perms.tem_doc_edit)
async def delete_tem_doc(id: int):
    return await server.delete_tem_doc(id)


@router.get("/refresh_content", summary="刷新测试环境维护记录内容")
@try_log(perm=Perms.tem_doc_view)
async def refresh_content(product_id: int):
    return await server.refresh_content(product_id)


@router.get("/list_tem_doc", summary="查询测试环境维护记录列表", response_model=Resp[Page[TemDocObj]])
@try_log(perm=Perms.tem_doc_view)
async def list_tem_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_tem_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_tem_doc", summary="查询测试环境维护记录详情", response_model=Resp[TemDocObj])
@try_log(perm=Perms.tem_doc_view)
async def get_tem_doc(id: int):
    return await server.get_tem_doc(id)


@router.get("/export_tem_doc", summary="导出测试环境维护记录")
@try_log(perm=Perms.tem_doc_view)
async def export_tem_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_tem_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"测试环境维护记录-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )