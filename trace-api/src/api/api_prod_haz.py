#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from datetime import datetime
from ..obj.tobj_prod_haz import ProdHazForm, ProdHazsForm
from ..obj.vobj_prod_haz import ProdHazObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_haz import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_prod_hazs", summary="添加HAZ", response_model=Resp[Any])
@try_log(perm=Perms.prod_haz_edit)
async def add_prod_hazs(form: ProdHazsForm):
    return await server.add_prod_hazs(form) 


@router.post("/update_prod_haz", summary="更新HAZ", response_model=Resp[Any])
@try_log(perm=Perms.prod_haz_edit)
async def update_prod_haz(form: ProdHazForm):
    return await server.update_prod_haz(form) 


@router.delete("/delete_prod_hazs", summary="删除HAZ", response_model=Resp[Any])
@try_log(perm=Perms.prod_haz_edit)
async def delete_prod_hazs(id: str):
    return await server.delete_prod_hazs((id or "").split(","))  


@router.get("/list_prod_haz", summary="查询HAZ列表", response_model=Resp[Page[ProdHazObj]])
@try_log(perm=Perms.prod_haz_view)
async def list_prod_haz(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_prod_haz(op_user, prod_id=prod_id, page_index=page_index, page_size=page_size)


@router.get("/export_prod_hazs", summary="导出HAZ列表", response_model=Resp[Any])
@try_log(perm=Perms.prod_haz_view)
async def export_prod_hazs(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    output = io.BytesIO()
    await server.export_prod_hazs(op_user, output, prod_id=prod_id, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_prod_haz')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
