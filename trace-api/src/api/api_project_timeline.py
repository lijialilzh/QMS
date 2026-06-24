#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.tobj_project_timeline import TimelineRowForm, TimelineCellForm
from ..obj.tobj_role import Perms
from ..obj import Resp
from ..serv.serv_project_timeline import Server
from . import try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.get("/list_timeline", summary="查询项目时间线", response_model=Resp[Any])
@try_log(perm=Perms.project_timeline_view)
async def list_timeline(prod_id: int = None):
    return await server.list_timeline(prod_id)


@router.post("/add_timeline_row", summary="新增时间线行", response_model=Resp[Any])
@try_log(perm=Perms.project_timeline_edit)
async def add_timeline_row(form: TimelineRowForm):
    return await server.add_timeline_row(form)


@router.post("/update_timeline_row", summary="更新时间线行", response_model=Resp[Any])
@try_log(perm=Perms.project_timeline_edit)
async def update_timeline_row(form: TimelineRowForm):
    return await server.update_timeline_row(form)


@router.delete("/delete_timeline_row", summary="删除时间线行（支持逗号多 id）", response_model=Resp[Any])
@try_log(perm=Perms.project_timeline_edit)
async def delete_timeline_row(id: str):
    return await server.delete_timeline_row((id or "").split(","))


@router.post("/update_timeline_cell", summary="更新时间线单元格", response_model=Resp[Any])
@try_log(perm=Perms.project_timeline_edit)
async def update_timeline_cell(form: TimelineCellForm):
    return await server.update_timeline_cell(form)


@router.post("/import_timeline", summary="导入时间线模板", response_model=Resp[Any])
@try_log(perm=Perms.project_timeline_edit)
async def import_timeline(prod_id: int = Form(...), replace: bool = Form(True), file: UploadFile = File(...)):
    content = await file.read()
    return await server.import_timeline(prod_id, content, replace)


@router.get("/export_timeline", summary="导出时间线", response_model=Resp[Any])
@try_log(perm=Perms.project_timeline_view)
async def export_timeline(prod_id: int = None):
    output = io.BytesIO()
    await server.export_timeline(prod_id, output)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_project_timeline')}-{timestamp}.xlsx")
    return StreamingResponse(content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
