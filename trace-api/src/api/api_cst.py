#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.vobj_cst import CstObj
from ..obj.tobj_cst import CstForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_cst import Server
from . import try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_cst", summary="添加CST", response_model=Resp[Any])
@try_log(perm=Perms.cst_edit)
async def add_cst(form: CstForm):
    return await server.add_cst(form) 


@router.delete("/delete_cst", summary="删除CST", response_model=Resp[Any])
@try_log(perm=Perms.cst_edit)
async def delete_cst(id: int):
    return await server.delete_cst(id)  


@router.post("/update_cst", summary="更新CST", response_model=Resp[Any])
@try_log(perm=Perms.cst_edit)
async def update_cst(form: CstForm):
    return await server.update_cst(form) 


@router.get("/list_cst", summary="查询CST列表", response_model=Resp[Page[CstObj]])
@try_log(perm=[Perms.cst_view, Perms.prod_cst_view])
async def list_cst(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_cst(fuzzy=fuzzy, page_index=page_index, page_size=page_size)


@router.get("/get_cst", summary="查询CST详情", response_model=Resp[CstObj])
@try_log(perm=Perms.cst_view)
async def get_cst(id: int):
    return await server.get_cst(id)


@router.get("/export_csts", summary="导出CST列表", response_model=Resp[Any])
@try_log(perm=Perms.cst_view)
async def export_csts(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    output = io.BytesIO()
    await server.export_csts(output, fuzzy=fuzzy, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_cst')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.post("/import_csts", summary="导入CST", response_model=Resp[Any])
@try_log(perm=Perms.cst_edit)
async def import_csts(file: UploadFile = File(...)):
    return await server.import_csts(file)
