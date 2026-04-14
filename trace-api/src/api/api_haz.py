#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse
from datetime import datetime
from ..obj.vobj_haz import HazObj
from ..obj.tobj_haz import HazForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_haz import Server
from . import try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_haz", summary="添加HAZ", response_model=Resp[Any])
@try_log(perm=Perms.haz_edit)
async def add_haz(form: HazForm):
    return await server.add_haz(form) 


@router.delete("/delete_haz", summary="删除HAZ", response_model=Resp[Any])
@try_log(perm=Perms.haz_edit)
async def delete_haz(id: int):
    return await server.delete_haz(id)  


@router.post("/update_haz", summary="更新HAZ", response_model=Resp[Any])
@try_log(perm=Perms.haz_edit)
async def update_haz(form: HazForm):
    return await server.update_haz(form) 


@router.get("/list_haz", summary="查询HAZ列表", response_model=Resp[Page[HazObj]])
@try_log(perm=[Perms.haz_view, Perms.prod_haz_view])
async def list_haz(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_haz(fuzzy=fuzzy, page_index=page_index, page_size=page_size)


@router.get("/get_haz", summary="查询HAZ详情", response_model=Resp[HazObj])
@try_log(perm=Perms.haz_view)
async def get_haz(id: int):
    return await server.get_haz(id)


@router.get("/export_hazs", summary="导出HAZ列表", response_model=Resp[Any])
@try_log(perm=Perms.haz_view)
async def export_hazs(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    output = io.BytesIO()
    await server.export_hazs(output, fuzzy=fuzzy, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_haz')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.post("/import_hazs", summary="导入HAZ", response_model=Resp[Any])
@try_log(perm=Perms.haz_edit)
async def import_hazs(file: UploadFile = File(...)):
    return await server.import_hazs(file)
