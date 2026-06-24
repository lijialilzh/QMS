#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_prod_runtime_env import ProdRuntimeEnvForm
from ..obj.vobj_prod_runtime_env import ProdRuntimeEnvObj
from ..obj.tobj_role import Perms
from ..obj import Resp
from ..serv.serv_prod_runtime_env import Server
from . import try_log

router = APIRouter()
server = Server()


@router.get("/get_prod_runtime_env", summary="查询产品运行环境", response_model=Resp[ProdRuntimeEnvObj])
@try_log(perm=Perms.prod_runtime_view)
async def get_prod_runtime_env(prod_id: int = None):
    return await server.get_prod_runtime_env(prod_id)


@router.post("/save_prod_runtime_env", summary="保存产品运行环境", response_model=Resp[Any])
@try_log(perm=Perms.prod_runtime_edit)
async def save_prod_runtime_env(form: ProdRuntimeEnvForm):
    return await server.save_prod_runtime_env(form)
