#!/usr/bin/env python
# encoding: utf-8

from typing import Any
from fastapi import APIRouter
from ..obj.vobj_person_sign import PersonSignObj
from ..obj.tobj_person_sign import PersonSignForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_person_sign import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_person_sign", summary="添加人员签名", response_model=Resp[Any])
@try_log(perm=Perms.person_sign_edit)
async def add_person_sign(form: PersonSignForm):
    return await server.add_person_sign(form)


@router.delete("/delete_person_sign", summary="删除人员签名", response_model=Resp[Any])
@try_log(perm=Perms.person_sign_edit)
async def delete_person_sign(id: int):
    return await server.delete_person_sign(id)


@router.post("/update_person_sign", summary="更新人员签名", response_model=Resp[Any])
@try_log(perm=Perms.person_sign_edit)
async def update_person_sign(form: PersonSignForm):
    return await server.update_person_sign(form)


@router.get("/list_person_sign", summary="查询人员签名列表", response_model=Resp[Page[PersonSignObj]])
@try_log(perm=Perms.person_sign_view)
async def list_person_sign(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_person_sign(fuzzy=fuzzy, page_index=page_index, page_size=page_size)


@router.get("/get_person_sign", summary="查询人员签名详情", response_model=Resp[PersonSignObj])
@try_log(perm=Perms.person_sign_view)
async def get_person_sign(id: int):
    return await server.get_person_sign(id)
