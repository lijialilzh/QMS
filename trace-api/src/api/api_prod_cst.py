#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from datetime import datetime
from ..obj.tobj_prod_cst import ProdCstForm, ProdCstsForm
from ..obj.vobj_prod_cst import ProdCstObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_cst import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_prod_csts", summary="添加CST", response_model=Resp[Any])
@try_log(perm=Perms.prod_cst_edit)
async def add_prod_csts(form: ProdCstsForm):
    return await server.add_prod_csts(form) 


@router.post("/update_prod_cst", summary="更新CST", response_model=Resp[Any])
@try_log(perm=Perms.prod_cst_edit)
async def update_prod_cst(form: ProdCstForm):
    return await server.update_prod_cst(form) 


@router.delete("/delete_prod_csts", summary="删除CST", response_model=Resp[Any])
@try_log(perm=Perms.prod_cst_edit)
async def delete_prod_csts(id: str):
    return await server.delete_prod_csts((id or "").split(","))  


@router.get("/list_prod_cst", summary="查询CST列表", response_model=Resp[Page[ProdCstObj]])
@try_log(perm=Perms.prod_cst_view)
async def list_prod_cst(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_prod_cst(op_user, prod_id=prod_id, page_index=page_index, page_size=page_size)


@router.get("/export_prod_csts", summary="导出CST列表", response_model=Resp[Any])
@try_log(perm=Perms.prod_cst_view)
async def export_prod_csts(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    output = io.BytesIO()
    await server.export_prod_csts(op_user, output, prod_id=prod_id, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_prod_cst')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
