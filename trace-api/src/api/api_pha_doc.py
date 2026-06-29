#!/usr/bin/env python
# encoding: utf-8

# 初步危害分析清单接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_pha_doc import PhaDocForm
from ..obj.vobj_pha_doc import PhaDocObj
from ..serv.serv_pha_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_pha_doc", summary="添加初步危害分析清单", response_model=Resp[PhaDocForm])
@try_log(perm=Perms.pha_doc_edit)
async def add_pha_doc(form: PhaDocForm):
    return await server.add_pha_doc(form)


@router.get("/duplicate_pha_doc", summary="复制初步危害分析清单", response_model=Resp[PhaDocForm])
@try_log(perm=Perms.pha_doc_edit)
async def duplicate_pha_doc(id: int, product_id: int = None):
    return await server.duplicate_pha_doc(id, product_id)


@router.post("/update_pha_doc", summary="更新初步危害分析清单", response_model=Resp[Any])
@try_log(perm=Perms.pha_doc_edit)
async def update_pha_doc(form: PhaDocForm):
    return await server.update_pha_doc(form)


@router.delete("/delete_pha_doc", summary="删除初步危害分析清单", response_model=Resp[Any])
@try_log(perm=Perms.pha_doc_edit)
async def delete_pha_doc(id: int):
    return await server.delete_pha_doc(id)


@router.get("/list_pha_doc", summary="查询初步危害分析清单列表", response_model=Resp[Page[PhaDocObj]])
@try_log(perm=Perms.pha_doc_view)
async def list_pha_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_pha_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_pha_doc", summary="查询初步危害分析清单详情", response_model=Resp[PhaDocObj])
@try_log(perm=Perms.pha_doc_view)
async def get_pha_doc(id: int):
    return await server.get_pha_doc(id)


@router.get("/export_pha_doc", summary="导出初步危害分析清单")
@try_log(perm=Perms.pha_doc_view)
async def export_pha_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_pha_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"初步危害分析清单-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
