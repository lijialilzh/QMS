#!/usr/bin/env python
# encoding: utf-8

# 产品验收记录接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_acc_doc import AccDocForm
from ..obj.vobj_acc_doc import AccDocObj
from ..serv.serv_acc_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_acc_doc", summary="添加产品验收记录", response_model=Resp[AccDocForm])
@try_log(perm=Perms.acc_doc_edit)
async def add_acc_doc(form: AccDocForm):
    return await server.add_acc_doc(form)


@router.get("/duplicate_acc_doc", summary="复制产品验收记录", response_model=Resp[AccDocForm])
@try_log(perm=Perms.acc_doc_edit)
async def duplicate_acc_doc(id: int, product_id: int = None):
    return await server.duplicate_acc_doc(id, product_id)


@router.post("/update_acc_doc", summary="更新产品验收记录", response_model=Resp[Any])
@try_log(perm=Perms.acc_doc_edit)
async def update_acc_doc(form: AccDocForm):
    return await server.update_acc_doc(form)


@router.delete("/delete_acc_doc", summary="删除产品验收记录", response_model=Resp[Any])
@try_log(perm=Perms.acc_doc_edit)
async def delete_acc_doc(id: int):
    return await server.delete_acc_doc(id)


@router.get("/list_acc_doc", summary="查询产品验收记录列表", response_model=Resp[Page[AccDocObj]])
@try_log(perm=Perms.acc_doc_view)
async def list_acc_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_acc_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_acc_doc", summary="查询产品验收记录详情", response_model=Resp[AccDocObj])
@try_log(perm=Perms.acc_doc_view)
async def get_acc_doc(id: int):
    return await server.get_acc_doc(id)


@router.get("/acc_autofill", summary="产品验收记录自动获取预览", response_model=Resp[Any])
@try_log(perm=Perms.acc_doc_view)
async def acc_autofill(product_id: int):
    return await server.acc_autofill(product_id)


@router.get("/export_acc_doc", summary="导出产品验收记录")
@try_log(perm=Perms.acc_doc_view)
async def export_acc_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_acc_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"产品验收记录-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
