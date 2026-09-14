#!/usr/bin/env python
# encoding: utf-8


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_prod_algo_module import ProdAlgoModuleForm
from ..obj.vobj_prod_algo_module import ProdAlgoModuleObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_algo_module import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_prod_algo_module", summary="添加算法模块", response_model=Resp[Any])
@try_log(perm=Perms.prod_algo_module_edit)
async def add_prod_algo_module(form: ProdAlgoModuleForm):
    return await server.add_prod_algo_module(form)


@router.post("/update_prod_algo_module", summary="更新算法模块", response_model=Resp[Any])
@try_log(perm=Perms.prod_algo_module_edit)
async def update_prod_algo_module(form: ProdAlgoModuleForm):
    return await server.update_prod_algo_module(form)


@router.delete("/delete_prod_algo_modules", summary="删除算法模块", response_model=Resp[Any])
@try_log(perm=Perms.prod_algo_module_edit)
async def delete_prod_algo_modules(id: str):
    return await server.delete_prod_algo_modules((id or "").split(","))


@router.get("/list_prod_algo_module", summary="查询算法模块列表", response_model=Resp[Page[ProdAlgoModuleObj]])
@try_log(perm=Perms.prod_algo_module_view)
async def list_prod_algo_module(prod_id: int = None, page_index: int = 0, page_size: int = 100):
    return await server.list_prod_algo_module(prod_id, page_index, page_size)
