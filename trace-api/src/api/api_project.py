#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.vobj_project import ProjectObj
from ..obj.tobj_project import ProjectForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_project import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_project", summary="添加项目", response_model=Resp[Any])
@try_log(perm=Perms.project_edit)
async def add_project(form: ProjectForm):
    return await server.add_project(form) 


@router.delete("/delete_project", summary="删除项目", response_model=Resp[Any])
@try_log(perm=Perms.project_edit)
async def delete_project(id: int):
    return await server.delete_project(id)  


@router.post("/update_project", summary="更新项目", response_model=Resp[Any])
@try_log(perm=Perms.project_edit)
async def update_project(form: ProjectForm):
    return await server.update_project(form) 


@router.get("/list_project", summary="查询项目列表", response_model=Resp[Page[ProjectObj]])
@try_log(perm=Perms.project_view)
async def list_project(name: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_project(name, page_index, page_size)


@router.get("/get_project", summary="查询项目详情", response_model=Resp[ProjectObj])
@try_log(perm=Perms.project_view)
async def get_project(id: int):
    return await server.get_project(id)
