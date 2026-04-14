#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from ..utils.i18n import ts
from ..obj.tobj_prod_dhf import ProdDhfForm, ProdDhfBatchDeleteForm
from ..obj.vobj_prod_dhf import ProdDhfObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_dhf import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_prod_dhf", summary="添加DHF", response_model=Resp[Any])
@try_log(perm=Perms.prod_dhf_edit)
async def add_prod_dhf(form: ProdDhfForm):
    return await server.add_prod_dhf(form) 


@router.post("/update_prod_dhf", summary="更新DHF", response_model=Resp[Any])
@try_log(perm=Perms.prod_dhf_edit)
async def update_prod_dhf(form: ProdDhfForm):
    return await server.update_prod_dhf(form) 


@router.delete("/delete_prod_dhf", summary="删除DHF", response_model=Resp[Any])
@try_log(perm=Perms.prod_dhf_edit)
async def delete_prod_dhfs(id: int):
    return await server.delete_prod_dhf(id)  


@router.post("/delete_prod_dhfs", summary="批量删除DHF", response_model=Resp[Any])
@try_log(perm=Perms.prod_dhf_edit)
async def delete_prod_dhfs_batch(form: ProdDhfBatchDeleteForm):
    return await server.delete_prod_dhfs(form.ids or [])


@router.get("/list_prod_dhf", summary="查询DHF列表", response_model=Resp[Page[ProdDhfObj]])
@try_log(perm=Perms.prod_dhf_view)
async def list_prod_dhf(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_prod_dhf(op_user, prod_id=prod_id, page_index=page_index, page_size=page_size)


@router.get("/get_prod_dhf", summary="查询DHF详情", response_model=Resp[ProdDhfObj])
@try_log(perm=Perms.prod_dhf_view)
async def get_prod_dhf(id: int):
    return await server.get_prod_dhf(id)  


@router.get("/export_prod_dhfs", summary="导出DHF列表", response_model=Resp[Any])
@try_log(perm=Perms.prod_dhf_view)
async def export_prod_dhfs(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    output = io.BytesIO()
    await server.export_prod_dhfs(op_user, output, prod_id=prod_id, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_prod_dhf')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.post("/import_prod_dhfs", summary="导入DHF", response_model=Resp[Any])
@try_log(perm=Perms.prod_dhf_edit)
async def import_prod_dhfs(prod_id: int = Form(...), file: UploadFile = File(...)):
    return await server.import_prod_dhfs(prod_id, file)