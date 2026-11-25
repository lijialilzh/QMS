#!/usr/bin/env python
# encoding: utf-8


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_ecr import EcrForm
from ..obj.vobj_ecr import EcrObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_ecr import Server
from . import try_log, ROLES_BASE_WRITE

router = APIRouter()
server = Server()


@router.post("/add_ecr", summary="添加ECR", response_model=Resp[Any])
@try_log(perm=Perms.ecr_edit, roles=ROLES_BASE_WRITE)
async def add_ecr(form: EcrForm):
    return await server.add_ecr(form)


@router.post("/update_ecr", summary="更新ECR", response_model=Resp[Any])
@try_log(perm=Perms.ecr_edit, roles=ROLES_BASE_WRITE)
async def update_ecr(form: EcrForm):
    return await server.update_ecr(form)


@router.delete("/delete_ecr", summary="删除ECR", response_model=Resp[Any])
@try_log(perm=Perms.ecr_edit, roles=ROLES_BASE_WRITE)
async def delete_ecr(id: str):
    return await server.delete_ecr((id or "").split(","))


@router.get("/list_ecr", summary="查询ECR列表", response_model=Resp[Page[EcrObj]])
@try_log(perm=Perms.ecr_view)
async def list_ecr(keyword: str = None, page_index: int = 0, page_size: int = 20):
    return await server.list_ecr(keyword, page_index, page_size)
