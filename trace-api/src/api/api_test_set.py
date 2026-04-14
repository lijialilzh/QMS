#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter, Form, File, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.vobj_test_set import TestSetObj
from ..obj.tobj_test_set import TestSetForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_test_set import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_test_set", summary="添加测试集", response_model=Resp[Any])
@try_log(perm=Perms.test_set_edit)
async def add_test_set(product_id: int = Form(...), stage: str = Form(...), file: UploadFile = File(default=None)):
    form = TestSetForm(product_id=product_id, stage=stage)
    return await server.add_test_set(form, file) 


@router.delete("/delete_test_set", summary="删除测试集", response_model=Resp[Any])
@try_log(perm=Perms.test_set_edit)
async def delete_test_set(id: int):
    return await server.delete_test_set(id)  


@router.post("/update_test_set", summary="更新测试集", response_model=Resp[Any])
@try_log(perm=Perms.test_set_edit)
async def update_test_set(id: int = Form(...), product_id: int = Form(default=None), stage: str = Form(default=None), file: UploadFile = File(default=None)):
    form = TestSetForm(id=id, product_id=product_id, stage=stage)
    return await server.update_test_set(form, file) 


@router.get("/list_test_set", summary="查询测试集列表", response_model=Resp[Page[TestSetObj]])
@try_log(perm=[Perms.test_set_view, Perms.srs_doc_view])
async def list_test_set(product_id: int = None, stage: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_test_set(op_user, product_id=product_id, stage=stage, page_index=page_index, page_size=page_size)


@router.get("/get_test_set", summary="查询测试集详情", response_model=Resp[TestSetObj])
@try_log(perm=Perms.test_set_view)
async def get_test_set(id: int):
    return await server.get_test_set(id)
