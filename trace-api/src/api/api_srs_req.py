#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.vobj_srs_req import SrsReqObj
from ..obj.tobj_srs_req import SrsReqForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_srs_req import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_srs_req", summary="添加SRS需求", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def add_srs_req(form: SrsReqForm):
    return await server.add_srs_req(form) 


@router.post("/update_srs_req", summary="更新SRS需求", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def update_srs_req(form: SrsReqForm):
    return await server.update_srs_req(form) 


@router.delete("/delete_srs_req", summary="删除SRS需求", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def delete_srs_reqs(id: int):
    return await server.delete_srs_req(id)  


@router.get("/list_srs_req", summary="查询SRS需求列表", response_model=Resp[Page[SrsReqObj]])
@try_log(perm=Perms.srs_doc_view)
async def list_srs_req(doc_id: int = None, type_code: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_srs_req(doc_id=doc_id, type_code=type_code, page_index=page_index, page_size=page_size)


@router.get("/get_srs_req", summary="查询SRS需求详情", response_model=Resp[SrsReqObj])
@try_log(perm=Perms.srs_doc_view)
async def get_srs_req(id: int):
    return await server.get_srs_req(id)  
