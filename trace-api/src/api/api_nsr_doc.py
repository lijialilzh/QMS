#!/usr/bin/env python
# encoding: utf-8

# 自研软件网络安全研究报告接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_nsr_doc import NsrDocForm
from ..obj.vobj_nsr_doc import NsrDocObj
from ..serv.serv_nsr_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_nsr_doc", summary="添加自研软件网络安全研究报告", response_model=Resp[NsrDocForm])
@try_log(perm=Perms.nsr_doc_edit)
async def add_nsr_doc(form: NsrDocForm):
    return await server.add_nsr_doc(form)


@router.get("/duplicate_nsr_doc", summary="复制自研软件网络安全研究报告", response_model=Resp[NsrDocForm])
@try_log(perm=Perms.nsr_doc_edit)
async def duplicate_nsr_doc(id: int, product_id: int = None):
    return await server.duplicate_nsr_doc(id, product_id)


@router.post("/update_nsr_doc", summary="更新自研软件网络安全研究报告", response_model=Resp[Any])
@try_log(perm=Perms.nsr_doc_edit)
async def update_nsr_doc(form: NsrDocForm):
    return await server.update_nsr_doc(form)


@router.delete("/delete_nsr_doc", summary="删除自研软件网络安全研究报告", response_model=Resp[Any])
@try_log(perm=Perms.nsr_doc_edit)
async def delete_nsr_doc(id: int):
    return await server.delete_nsr_doc(id)


@router.get("/list_nsr_doc", summary="查询自研软件网络安全研究报告列表", response_model=Resp[Page[NsrDocObj]])
@try_log(perm=Perms.nsr_doc_view)
async def list_nsr_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_nsr_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_nsr_doc", summary="查询自研软件网络安全研究报告详情", response_model=Resp[NsrDocObj])
@try_log(perm=Perms.nsr_doc_view)
async def get_nsr_doc(id: int):
    return await server.get_nsr_doc(id)


@router.get("/nsr_autofill", summary="自研软件网络安全研究报告自动获取预览", response_model=Resp[Any])
@try_log(perm=Perms.nsr_doc_view)
async def nsr_autofill(product_id: int):
    return await server.nsr_autofill(product_id)


@router.get("/export_nsr_doc", summary="导出自研软件网络安全研究报告")
@try_log(perm=Perms.nsr_doc_view)
async def export_nsr_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_nsr_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"自研软件网络安全研究报告-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}", "Cache-Control": "no-store"},
    )
