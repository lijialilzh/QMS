#!/usr/bin/env python
# encoding: utf-8

# 安装维护手册接口层（测试文件 VV-005）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_imm_doc import ImmDocForm
from ..obj.vobj_imm_doc import ImmDocObj
from ..serv.serv_imm_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_imm_doc", summary="添加安装维护手册", response_model=Resp[ImmDocForm])
@try_log(perm=Perms.imm_doc_edit)
async def add_imm_doc(form: ImmDocForm):
    return await server.add_imm_doc(form)


@router.get("/duplicate_imm_doc", summary="复制安装维护手册", response_model=Resp[ImmDocForm])
@try_log(perm=Perms.imm_doc_edit)
async def duplicate_imm_doc(id: int, product_id: int = None):
    return await server.duplicate_imm_doc(id, product_id)


@router.post("/update_imm_doc", summary="更新安装维护手册", response_model=Resp[Any])
@try_log(perm=Perms.imm_doc_edit)
async def update_imm_doc(form: ImmDocForm):
    return await server.update_imm_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取自动填充内容", response_model=Resp[ImmDocObj])
@try_log(perm=Perms.imm_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_imm_doc", summary="删除安装维护手册", response_model=Resp[Any])
@try_log(perm=Perms.imm_doc_edit)
async def delete_imm_doc(id: int):
    return await server.delete_imm_doc(id)


@router.get("/list_imm_doc", summary="查询安装维护手册列表", response_model=Resp[Page[ImmDocObj]])
@try_log(perm=Perms.imm_doc_view)
async def list_imm_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_imm_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_imm_doc", summary="查询安装维护手册详情", response_model=Resp[ImmDocObj])
@try_log(perm=Perms.imm_doc_view)
async def get_imm_doc(id: int):
    return await server.get_imm_doc(id)


@router.get("/export_imm_doc", summary="导出安装维护手册")
@try_log(perm=Perms.imm_doc_view)
async def export_imm_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_imm_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"安装维护手册-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.get("/export_imm_md5_attachment", summary="导出MD5值附件")
@try_log(perm=Perms.imm_doc_view)
async def export_imm_md5_attachment(id: int = 0):
    output = io.BytesIO()
    await server.export_imm_md5_attachment(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"MD5值附件-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.get("/export_imm_md5_review", summary="导出MD5值评审记录")
@try_log(perm=Perms.imm_doc_view)
async def export_imm_md5_review(id: int = 0):
    output = io.BytesIO()
    await server.export_imm_md5_review(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"MD5值评审记录-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
