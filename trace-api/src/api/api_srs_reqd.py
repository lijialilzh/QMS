#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_srs_reqd import SrsReqdForm
from ..obj.vobj_srs_reqd import SrsReqdObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_srs_reqd import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_srs_reqd", summary="新增SRS需求细节", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def add_srs_reqd(form: SrsReqdForm):
    return await server.add_srs_reqd(form) 


@router.delete("/delete_srs_reqd", summary="删除SRS需求细节", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def delete_srs_reqd(req_id: int):
    return await server.delete_srs_reqd(req_id) 


@router.post("/update_srs_reqd", summary="更新SRS需求细节", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def update_srs_reqd(form: SrsReqdForm):
    return await server.update_srs_reqd(form) 


@router.get("/list_srs_reqd", summary="查询SRS需求细节列表", response_model=Resp[Page[SrsReqdObj]])
@try_log(perm=Perms.srs_doc_view)
async def list_srs_reqd(product_id: int = None, doc_id: int = None, page_index: int = 0, page_size: int = 10):
    return await server.list_srs_reqd(product_id=product_id, doc_id=doc_id, page_index=page_index, page_size=page_size)


@router.get("/get_srs_reqd", summary="查询SRS需求细节详情", response_model=Resp[SrsReqdObj])
@try_log(perm=Perms.srs_doc_view)
async def get_srs_reqd(req_id: int):
    return await server.get_srs_reqd(req_id)  
