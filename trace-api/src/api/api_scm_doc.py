#!/usr/bin/env python
# encoding: utf-8

# 软件配置管理计划接口层（开发文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_scm_doc import ScmDocForm
from ..obj.vobj_scm_doc import ScmDocObj
from ..serv.serv_scm_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_scm_doc", summary="添加软件配置管理计划", response_model=Resp[ScmDocForm])
@try_log(perm=Perms.scm_doc_edit)
async def add_scm_doc(form: ScmDocForm):
    return await server.add_scm_doc(form)


@router.get("/duplicate_scm_doc", summary="复制软件配置管理计划", response_model=Resp[ScmDocForm])
@try_log(perm=Perms.scm_doc_edit)
async def duplicate_scm_doc(id: int, product_id: int = None):
    return await server.duplicate_scm_doc(id, product_id)


@router.post("/update_scm_doc", summary="更新软件配置管理计划", response_model=Resp[Any])
@try_log(perm=Perms.scm_doc_edit)
async def update_scm_doc(form: ScmDocForm):
    return await server.update_scm_doc(form)


@router.delete("/delete_scm_doc", summary="删除软件配置管理计划", response_model=Resp[Any])
@try_log(perm=Perms.scm_doc_edit)
async def delete_scm_doc(id: int):
    return await server.delete_scm_doc(id)


@router.get("/list_scm_doc", summary="查询软件配置管理计划列表", response_model=Resp[Page[ScmDocObj]])
@try_log(perm=Perms.scm_doc_view)
async def list_scm_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_scm_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_scm_doc", summary="查询软件配置管理计划详情", response_model=Resp[ScmDocObj])
@try_log(perm=Perms.scm_doc_view)
async def get_scm_doc(id: int):
    return await server.get_scm_doc(id)


@router.get("/export_scm_doc", summary="导出软件配置管理计划")
@try_log(perm=Perms.scm_doc_view)
async def export_scm_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_scm_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"软件配置管理计划-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
