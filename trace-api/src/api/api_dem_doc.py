#!/usr/bin/env python
# encoding: utf-8

# 开发环境维护说明接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_dem_doc import DemDocForm
from ..obj.vobj_dem_doc import DemDocObj
from ..serv.serv_dem_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_dem_doc", summary="添加开发环境维护说明", response_model=Resp[DemDocForm])
@try_log(perm=Perms.dem_doc_edit)
async def add_dem_doc(form: DemDocForm):
    return await server.add_dem_doc(form)


@router.get("/duplicate_dem_doc", summary="复制开发环境维护说明", response_model=Resp[DemDocForm])
@try_log(perm=Perms.dem_doc_edit)
async def duplicate_dem_doc(id: int, product_id: int = None):
    return await server.duplicate_dem_doc(id, product_id)


@router.post("/update_dem_doc", summary="更新开发环境维护说明", response_model=Resp[Any])
@try_log(perm=Perms.dem_doc_edit)
async def update_dem_doc(form: DemDocForm):
    return await server.update_dem_doc(form)


@router.delete("/delete_dem_doc", summary="删除开发环境维护说明", response_model=Resp[Any])
@try_log(perm=Perms.dem_doc_edit)
async def delete_dem_doc(id: int):
    return await server.delete_dem_doc(id)


@router.get("/list_dem_doc", summary="查询开发环境维护说明列表", response_model=Resp[Page[DemDocObj]])
@try_log(perm=Perms.dem_doc_view)
async def list_dem_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_dem_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_dem_doc", summary="查询开发环境维护说明详情", response_model=Resp[DemDocObj])
@try_log(perm=Perms.dem_doc_view)
async def get_dem_doc(id: int):
    return await server.get_dem_doc(id)


@router.get("/export_dem_doc", summary="导出开发环境维护说明")
@try_log(perm=Perms.dem_doc_view)
async def export_dem_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_dem_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"开发环境维护说明-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
