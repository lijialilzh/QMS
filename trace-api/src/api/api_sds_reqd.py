#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import json
from typing import Any, List, Optional
from fastapi import APIRouter, Form, File, UploadFile
from ..obj.tobj_sds_reqd import SdsReqdForm, LogicForm
from ..obj.vobj_sds_reqd import SdsReqdObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_sds_reqd import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/update_sds_reqd", summary="更新SDS需求细节", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def update_sds_reqd(id: int = Form(default=None), 
                          doc_id: int = Form(default=None),
                          req_id: int = Form(default=None),
                          overview: str = Form(default=None),
                          func_detail: str = Form(default=None),
                          logic_txt: str = Form(default=None),
                          intput: str = Form(default=None),
                          output: str = Form(default=None),
                          interface: str = Form(default=None),
                          new_imgs: Optional[List[UploadFile]] = File(default=None),
                          new_logics: str = Form(default=None),\
                          alt_logics: str = Form(default=None),
                          ):
    form = SdsReqdForm(id=id,
                       doc_id=doc_id,
                       req_id=req_id,
                       overview=overview,
                       func_detail=func_detail,
                       logic_txt=logic_txt,
                       intput=intput,
                       output=output,
                       interface=interface)
    new_list = json.loads(new_logics) if new_logics else []
    new_list = [LogicForm(**item) for item in new_list]
    alt_list = json.loads(alt_logics) if alt_logics else []
    alt_list = [LogicForm(**item) for item in alt_list]
    return await server.update_sds_reqd(form, new_imgs, new_list, alt_list)


@router.delete("/delete_sds_logic", summary="删除SDS需求逻辑", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def delete_sds_logic(logic_id: int = None):
    return await server.delete_sds_logic(logic_id)


@router.get("/list_sds_reqd", summary="查询SDS需求细节列表", response_model=Resp[Page[SdsReqdObj]])
@try_log(perm=Perms.sds_doc_view)
async def list_sds_reqd(prod_id: int = None, doc_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_sds_reqd(op_user, prod_id=prod_id, doc_id=doc_id, page_index=page_index, page_size=page_size)


@router.get("/get_sds_reqd", summary="查询SDS需求细节详情", response_model=Resp[SdsReqdObj])
@try_log(perm=Perms.sds_doc_view)
async def get_sds_reqd(id: int = 0):
    return await server.get_sds_reqd(id)  
