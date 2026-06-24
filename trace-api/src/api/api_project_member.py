#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter, File, Form, UploadFile
from ..obj.tobj_project_member import ProjectMemberForm
from ..obj.vobj_project_member import ProjectMemberObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_project_member import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_project_member", summary="添加项目人员", response_model=Resp[Any])
@try_log(perm=Perms.project_member_edit)
async def add_project_member(form: ProjectMemberForm):
    return await server.add_project_member(form)


@router.post("/update_project_member", summary="更新项目人员", response_model=Resp[Any])
@try_log(perm=Perms.project_member_edit)
async def update_project_member(form: ProjectMemberForm):
    return await server.update_project_member(form)


@router.delete("/delete_project_members", summary="删除项目人员", response_model=Resp[Any])
@try_log(perm=Perms.project_member_edit)
async def delete_project_members(id: str):
    return await server.delete_project_members((id or "").split(","))


@router.get("/list_project_member", summary="查询项目人员列表", response_model=Resp[Page[ProjectMemberObj]])
@try_log(perm=Perms.project_member_view)
async def list_project_member(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    return await server.list_project_member(prod_id, page_index, page_size)


@router.post("/import_project_members", summary="导入项目人员清单", response_model=Resp[Any])
@try_log(perm=Perms.project_member_edit)
async def import_project_members(prod_id: int = Form(...), replace: bool = Form(True), file: UploadFile = File(...)):
    content = await file.read()
    return await server.import_project_members(prod_id, content, replace)
