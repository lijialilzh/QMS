#!/usr/bin/env python
# encoding: utf-8

# 现场测试记录接口层（测试文件 VV-006）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_ftr_record_doc import FtrRecordDocForm
from ..obj.vobj_ftr_record_doc import FtrRecordDocObj
from ..serv.serv_ftr_record_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_ftr_record_doc", summary="添加现场测试记录", response_model=Resp[FtrRecordDocForm])
@try_log(perm=Perms.ftr_record_doc_edit)
async def add_ftr_record_doc(form: FtrRecordDocForm):
    return await server.add_ftr_record_doc(form)


@router.get("/duplicate_ftr_record_doc", summary="复制现场测试记录", response_model=Resp[FtrRecordDocForm])
@try_log(perm=Perms.ftr_record_doc_edit)
async def duplicate_ftr_record_doc(id: int, product_id: int = None):
    return await server.duplicate_ftr_record_doc(id, product_id)


@router.post("/update_ftr_record_doc", summary="更新现场测试记录", response_model=Resp[Any])
@try_log(perm=Perms.ftr_record_doc_edit)
async def update_ftr_record_doc(form: FtrRecordDocForm):
    return await server.update_ftr_record_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[FtrRecordDocObj])
@try_log(perm=Perms.ftr_record_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_ftr_record_doc", summary="删除现场测试记录", response_model=Resp[Any])
@try_log(perm=Perms.ftr_record_doc_edit)
async def delete_ftr_record_doc(id: int):
    return await server.delete_ftr_record_doc(id)


@router.get("/list_ftr_record_doc", summary="查询现场测试记录列表", response_model=Resp[Page[FtrRecordDocObj]])
@try_log(perm=Perms.ftr_record_doc_view)
async def list_ftr_record_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_ftr_record_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_ftr_record_doc", summary="查询现场测试记录详情", response_model=Resp[FtrRecordDocObj])
@try_log(perm=Perms.ftr_record_doc_view)
async def get_ftr_record_doc(id: int):
    return await server.get_ftr_record_doc(id)


@router.get("/export_ftr_record_doc", summary="导出现场测试记录")
@try_log(perm=Perms.ftr_record_doc_view)
async def export_ftr_record_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_ftr_record_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"现场测试记录-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})