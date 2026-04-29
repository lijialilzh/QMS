#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter, Form, File, UploadFile
from ..obj.vobj_doc_file import DocFileObj
from ..obj.tobj_doc_file import DocFileForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_doc_file import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()
category = "img_topo"


@router.post("/add_doc_file", summary="添加文档文件", response_model=Resp[Any])
@try_log(perm=Perms.doc_file_topo_edit)
async def add_doc_file(product_id: int = Form(...), file: UploadFile = File(default=None)):
    form = DocFileForm(category=category, product_id=product_id)
    return await server.add_doc_file(form, file) 


@router.delete("/delete_doc_file", summary="删除文档文件", response_model=Resp[Any])
@try_log(perm=Perms.doc_file_topo_edit)
async def delete_doc_file(id: int):
    return await server.delete_doc_file(id)  


@router.post("/update_doc_file", summary="更新文档文件", response_model=Resp[Any])
@try_log(perm=Perms.doc_file_topo_edit)
async def update_doc_file(id: int = Form(...), product_id: int = Form(default=None), file: UploadFile = File(default=None)):
    form = DocFileForm(id=id, product_id=product_id)
    return await server.update_doc_file(form, file) 


@router.get("/list_doc_file", summary="查询文档文件列表", response_model=Resp[Page[DocFileObj]])
@try_log(perm=Perms.doc_file_topo_view)
async def list_doc_file(product_id: int = 0, file_name: str = None, file_no: str = None, doc_version: str = None, product_name: str = None, product_version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_doc_file(op_user, category=category, product_id=product_id, file_name=file_name, file_no=file_no, doc_version=doc_version, product_name=product_name, product_version=product_version, page_index=page_index, page_size=page_size)


@router.get("/get_doc_file", summary="查询文档文件详情", response_model=Resp[DocFileObj])
@try_log(perm=Perms.doc_file_topo_view)
async def get_doc_file(id: int):
    return await server.get_doc_file(id)
