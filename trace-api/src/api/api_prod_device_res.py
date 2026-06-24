#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_prod_device_res import ProdDeviceResForm
from ..obj.vobj_prod_device_res import ProdDeviceResObj
from ..obj.tobj_role import Perms
from ..obj import Resp
from ..serv.serv_prod_device_res import Server
from . import try_log

router = APIRouter()
server = Server()


@router.get("/get_prod_device_res", summary="查询产品设备资源", response_model=Resp[ProdDeviceResObj])
@try_log(perm=Perms.prod_device_view)
async def get_prod_device_res(prod_id: int = None):
    return await server.get_prod_device_res(prod_id)


@router.post("/save_prod_device_res", summary="保存产品设备资源", response_model=Resp[Any])
@try_log(perm=Perms.prod_device_edit)
async def save_prod_device_res(form: ProdDeviceResForm):
    return await server.save_prod_device_res(form)
