#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_srs_type import SrsTypeForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_srs_type import Server
from . import try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_srs_type", summary="添加SrsType", response_model=Resp[SrsTypeForm])
@try_log(perm=Perms.srs_doc_edit)
async def add_srs_type(form: SrsTypeForm):
    return await server.add_srs_type(form) 


@router.delete("/delete_srs_type", summary="删除SrsType", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def delete_srs_type(id: int):
    return await server.delete_srs_type(id)  


@router.post("/update_srs_type", summary="更新SrsType", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def update_srs_type(form: SrsTypeForm):
    return await server.update_srs_type(form) 


@router.get("/list_srs_type", summary="查询SrsType列表", response_model=Resp[Page[SrsTypeForm]])
@try_log(perm=Perms.srs_doc_view)
async def list_srs_type(doc_id: int = 0, page_index: int = 0, page_size: int = 10):
    return await server.list_srs_type(doc_id=doc_id, page_index=page_index, page_size=page_size)
