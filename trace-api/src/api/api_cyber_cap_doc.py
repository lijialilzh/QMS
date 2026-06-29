#!/usr/bin/env python
# encoding: utf-8

# 网络安全能力分析（MDS2）接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_cyber_cap_doc import CyberCapDocForm
from ..obj.vobj_cyber_cap_doc import CyberCapDocObj
from ..serv.serv_cyber_cap_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.get("/cyber_cap_schema", summary="网络安全能力分析编辑模板", response_model=Resp[Any])
@try_log(perm=Perms.cyber_cap_doc_view)
async def cyber_cap_schema():
    return server.get_schema()


@router.get("/cyber_cap_autofill", summary="网络安全能力分析自动获取预览", response_model=Resp[Any])
@try_log(perm=Perms.cyber_cap_doc_view)
async def cyber_cap_autofill(product_id: int):
    return await server.autofill_preview(product_id)


@router.post("/add_cyber_cap_doc", summary="添加网络安全能力分析", response_model=Resp[CyberCapDocForm])
@try_log(perm=Perms.cyber_cap_doc_edit)
async def add_cyber_cap_doc(form: CyberCapDocForm):
    return await server.add_cyber_cap_doc(form)


@router.get("/duplicate_cyber_cap_doc", summary="复制网络安全能力分析", response_model=Resp[CyberCapDocForm])
@try_log(perm=Perms.cyber_cap_doc_edit)
async def duplicate_cyber_cap_doc(id: int, product_id: int = None):
    return await server.duplicate_cyber_cap_doc(id, product_id)


@router.post("/update_cyber_cap_doc", summary="更新网络安全能力分析", response_model=Resp[Any])
@try_log(perm=Perms.cyber_cap_doc_edit)
async def update_cyber_cap_doc(form: CyberCapDocForm):
    return await server.update_cyber_cap_doc(form)


@router.delete("/delete_cyber_cap_doc", summary="删除网络安全能力分析", response_model=Resp[Any])
@try_log(perm=Perms.cyber_cap_doc_edit)
async def delete_cyber_cap_doc(id: int):
    return await server.delete_cyber_cap_doc(id)


@router.get("/list_cyber_cap_doc", summary="查询网络安全能力分析列表", response_model=Resp[Page[CyberCapDocObj]])
@try_log(perm=Perms.cyber_cap_doc_view)
async def list_cyber_cap_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_cyber_cap_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_cyber_cap_doc", summary="查询网络安全能力分析详情", response_model=Resp[CyberCapDocObj])
@try_log(perm=Perms.cyber_cap_doc_view)
async def get_cyber_cap_doc(id: int):
    return await server.get_cyber_cap_doc(id)


@router.get("/export_cyber_cap_doc", summary="导出网络安全能力分析")
@try_log(perm=Perms.cyber_cap_doc_view)
async def export_cyber_cap_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_cyber_cap_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"网络安全能力分析-{timestamp}.xlsx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}", "Cache-Control": "no-store"},
    )
