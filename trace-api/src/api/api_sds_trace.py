#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.vobj_sds_trace import SdsTraceObj
from ..obj.tobj_sds_trace import SdsTraceForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_sds_trace import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/update_sds_trace", summary="更新SDS追溯", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def update_sds_trace(form: SdsTraceForm):
    return await server.update_sds_trace(form) 


@router.get("/list_sds_trace", summary="查询SDS追溯列表", response_model=Resp[Page[SdsTraceObj]])
@try_log(perm=Perms.sds_doc_view)
async def list_sds_trace(prod_id: int = None, doc_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_sds_trace(op_user, prod_id=prod_id, doc_id=doc_id, page_index=page_index, page_size=page_size)


@router.get("/get_sds_trace", summary="查询SDS追溯详情", response_model=Resp[SdsTraceObj])
@try_log(perm=Perms.sds_doc_view)
async def get_sds_trace(id: int = 0):
    return await server.get_sds_trace(id)  
