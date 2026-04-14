#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from datetime import datetime
from ..obj.tobj_prod_rcm import ProdRcmsForm
from ..obj.vobj_prod_rcm import ProdRcmObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_rcm import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_prod_rcms", summary="添加RCM", response_model=Resp[Any])
@try_log(perm=Perms.prod_rcm_edit)
async def add_prod_rcms(form: ProdRcmsForm):
    return await server.add_prod_rcms(form) 


@router.delete("/delete_prod_rcms", summary="删除RCM", response_model=Resp[Any])
@try_log(perm=Perms.prod_rcm_edit)
async def delete_prod_rcms(id: str):
    return await server.delete_prod_rcms((id or "").split(","))  


@router.get("/list_prod_rcm", summary="查询RCM列表", response_model=Resp[Page[ProdRcmObj]])
@try_log(perm=Perms.prod_rcm_view)
async def list_prod_rcm(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_prod_rcm(op_user, prod_id=prod_id, page_index=page_index, page_size=page_size)


@router.get("/export_prod_rcms", summary="导出RCM列表", response_model=Resp[Any])
@try_log(perm=Perms.prod_rcm_view)
async def export_prod_rcms(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    output = io.BytesIO()
    await server.export_prod_rcms(op_user, output, prod_id=prod_id, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_prod_rcm')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
