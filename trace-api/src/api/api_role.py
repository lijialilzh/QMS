#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_role import RoleForm
from ..obj.vobj_role import RoleObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_role import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_role", summary="添加角色", response_model=Resp[Any])
@try_log(perm=Perms.role_edit)
async def add_role(form: RoleForm):
    return await server.add_role(form) 


@router.delete("/delete_role", summary="删除角色", response_model=Resp[Any])
@try_log(perm=Perms.role_edit)
async def delete_role(code: str):
    return await server.delete_role(code)  


@router.post("/update_role", summary="更新角色", response_model=Resp[Any])
@try_log(perm=Perms.role_edit)
async def update_role(form: RoleForm):
    return await server.update_role(form) 


@router.get("/list_role", summary="查询角色列表", response_model=Resp[Page[RoleObj]])
@try_log(perm=[Perms.role_view, Perms.user_view])
async def list_role(name: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_role(name, page_index, page_size)


@router.get("/get_role", summary="查询角色详情", response_model=Resp[RoleObj])
@try_log(perm=Perms.role_view)
async def get_role(code: str):
    return await server.get_role(code)