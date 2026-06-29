#!/usr/bin/env python
# encoding: utf-8

# 产品发布说明接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_release_note import ReleaseNoteForm
from ..obj.vobj_release_note import ReleaseNoteObj
from ..serv.serv_release_note import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_release_note", summary="添加产品发布说明", response_model=Resp[ReleaseNoteForm])
@try_log(perm=Perms.release_note_edit)
async def add_release_note(form: ReleaseNoteForm):
    return await server.add_release_note(form)


@router.get("/duplicate_release_note", summary="复制产品发布说明", response_model=Resp[ReleaseNoteForm])
@try_log(perm=Perms.release_note_edit)
async def duplicate_release_note(id: int, product_id: int = None):
    return await server.duplicate_release_note(id, product_id)


@router.post("/update_release_note", summary="更新产品发布说明", response_model=Resp[Any])
@try_log(perm=Perms.release_note_edit)
async def update_release_note(form: ReleaseNoteForm):
    return await server.update_release_note(form)


@router.delete("/delete_release_note", summary="删除产品发布说明", response_model=Resp[Any])
@try_log(perm=Perms.release_note_edit)
async def delete_release_note(id: int):
    return await server.delete_release_note(id)


@router.get("/list_release_note", summary="查询产品发布说明列表", response_model=Resp[Page[ReleaseNoteObj]])
@try_log(perm=Perms.release_note_view)
async def list_release_note(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_release_note(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_release_note", summary="查询产品发布说明详情", response_model=Resp[ReleaseNoteObj])
@try_log(perm=Perms.release_note_view)
async def get_release_note(id: int):
    return await server.get_release_note(id)


@router.get("/export_release_note", summary="导出产品发布说明")
@try_log(perm=Perms.release_note_view)
async def export_release_note(id: int = 0):
    output = io.BytesIO()
    await server.export_release_note(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"产品发布说明-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
