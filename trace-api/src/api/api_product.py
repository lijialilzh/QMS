#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from ..obj.vobj_user import UserObj
from ..obj.vobj_product import ProductObj
from ..obj.tobj_product import ProductForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_product import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_product", summary="添加产品", response_model=Resp[Any])
@try_log(perm=Perms.product_edit)
async def add_product(form: ProductForm):
    op_user: UserObj = CtxUser.get()
    return await server.add_product(op_user, form) 


@router.delete("/delete_product", summary="删除产品", response_model=Resp[Any])
@try_log(perm=Perms.product_edit)
async def delete_product(id: int):
    return await server.delete_product(id)  


@router.post("/update_product", summary="更新产品", response_model=Resp[Any])
@try_log(perm=Perms.product_edit)
async def update_product(form: ProductForm):
    op_user: UserObj = CtxUser.get()
    return await server.update_product(op_user, form) 


@router.get("/list_product", summary="查询产品列表", response_model=Resp[Page[ProductObj]])
@try_log(perm=[Perms.product_view, Perms.srs_doc_view, Perms.sds_doc_view])
async def list_product(fuzzy: str = None, with_trace:int = 0, page_index: int = 0, page_size: int = 10):
    op_user: UserObj = CtxUser.get()
    return await server.list_product(op_user, fuzzy=fuzzy, with_trace=with_trace, page_index=page_index, page_size=page_size)


@router.get("/get_product", summary="查询产品详情", response_model=Resp[ProductObj])
@try_log(perm=Perms.product_view)
async def get_product(id: int):
    return await server.get_product(id)


@router.get("/export_product_trace", summary="导出产品追溯", response_model=Resp[Any])
@try_log(perm=Perms.product_view)
async def export_product_trace(id: int):
    output = io.BytesIO()
    await server.export_product_trace(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_product_trace')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/export_products", summary="导出产品列表", response_model=Resp[Any])
@try_log(perm=Perms.product_view)
async def export_products(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    op_user: UserObj = CtxUser.get()
    output = io.BytesIO()
    await server.export_products(output, op_user, fuzzy=fuzzy, page_index=page_index, page_size=page_size)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_product')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
