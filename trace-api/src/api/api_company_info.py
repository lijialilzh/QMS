#!/usr/bin/env python
# encoding: utf-8

from typing import Any
from fastapi import APIRouter
from ..obj.vobj_company_info import CompanyInfoObj
from ..obj.tobj_company_info import CompanyInfoForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_company_info import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_company_info", summary="添加公司基本信息", response_model=Resp[Any])
@try_log(perm=Perms.company_info_edit)
async def add_company_info(form: CompanyInfoForm):
    return await server.add_company_info(form)


@router.delete("/delete_company_info", summary="删除公司基本信息", response_model=Resp[Any])
@try_log(perm=Perms.company_info_edit)
async def delete_company_info(id: int):
    return await server.delete_company_info(id)


@router.post("/update_company_info", summary="更新公司基本信息", response_model=Resp[Any])
@try_log(perm=Perms.company_info_edit)
async def update_company_info(form: CompanyInfoForm):
    return await server.update_company_info(form)


@router.get("/list_company_info", summary="查询公司基本信息列表", response_model=Resp[Page[CompanyInfoObj]])
@try_log(perm=Perms.company_info_view)
async def list_company_info(fuzzy: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_company_info(fuzzy=fuzzy, page_index=page_index, page_size=page_size)


@router.get("/get_company_info", summary="查询公司基本信息详情", response_model=Resp[CompanyInfoObj])
@try_log(perm=Perms.company_info_view)
async def get_company_info(id: int):
    return await server.get_company_info(id)
