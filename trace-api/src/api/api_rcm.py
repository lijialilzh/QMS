#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any
from datetime import datetime
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.vobj_rcm import RcmObj
from ..obj.tobj_rcm import RcmForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_rcm import Server
from . import try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_rcm", summary="添加RCM", response_model=Resp[Any])
@try_log(perm=Perms.rcm_edit)
async def add_rcm(form: RcmForm):
    return await server.add_rcm(form) 


@router.delete("/delete_rcm", summary="删除RCM", response_model=Resp[Any])
@try_log(perm=Perms.rcm_edit)
async def delete_rcm(id: int):
    return await server.delete_rcm(id)  


@router.post("/update_rcm", summary="更新RCM", response_model=Resp[Any])
@try_log(perm=Perms.rcm_edit)
async def update_rcm(form: RcmForm):
    return await server.update_rcm(form) 


@router.get("/list_rcm", summary="查询RCM列表", response_model=Resp[Page[RcmObj]])
@try_log(perm=[Perms.rcm_view, Perms.srs_doc_view, Perms.haz_view, Perms.prod_rcm_view])
async def list_rcm(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_rcm(fuzzy=fuzzy, page_index=page_index, page_size=page_size)


@router.get("/get_rcm", summary="查询RCM详情", response_model=Resp[RcmObj])
@try_log(perm=Perms.rcm_view)
async def get_rcm(id: int):
    return await server.get_rcm(id)


@router.get("/export_rcms", summary="导出RCM列表", response_model=Resp[Any])
@try_log(perm=Perms.rcm_view)
async def export_rcms(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    output = io.BytesIO()
    await server.export_rcms(output, fuzzy=fuzzy, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_rcm')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.post("/import_rcms", summary="导入RCM", response_model=Resp[Any])
@try_log(perm=Perms.rcm_edit)
async def import_rcms(file: UploadFile = File(...)):
    return await server.import_rcms(file)
