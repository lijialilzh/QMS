#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter, File, Form, UploadFile
from ..obj.tobj_prod_hospital import ProdHospitalForm
from ..obj.vobj_prod_hospital import ProdHospitalObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_hospital import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_prod_hospital", summary="添加合规医院", response_model=Resp[Any])
@try_log(perm=Perms.prod_hospital_edit)
async def add_prod_hospital(form: ProdHospitalForm):
    return await server.add_prod_hospital(form)


@router.post("/update_prod_hospital", summary="更新合规医院", response_model=Resp[Any])
@try_log(perm=Perms.prod_hospital_edit)
async def update_prod_hospital(form: ProdHospitalForm):
    return await server.update_prod_hospital(form)


@router.delete("/delete_prod_hospitals", summary="删除合规医院", response_model=Resp[Any])
@try_log(perm=Perms.prod_hospital_edit)
async def delete_prod_hospitals(id: str):
    return await server.delete_prod_hospitals((id or "").split(","))


@router.get("/list_prod_hospital", summary="查询合规医院列表", response_model=Resp[Page[ProdHospitalObj]])
@try_log(perm=Perms.prod_hospital_view)
async def list_prod_hospital(prod_id: int = None, fuzzy: str = None,
                             org_name: str = None, hospital_no: str = None,
                             region: str = None, province: str = None, city: str = None,
                             page_index: int = 0, page_size: int = 10):
    return await server.list_prod_hospital(
        prod_id, fuzzy, org_name, hospital_no, region, province, city, page_index, page_size
    )


@router.post("/import_prod_hospitals", summary="导入合规医院列表", response_model=Resp[Any])
@try_log(perm=Perms.prod_hospital_edit)
async def import_prod_hospitals(prod_id: int = Form(...), replace: bool = Form(True), file: UploadFile = File(...)):
    content = await file.read()
    return await server.import_prod_hospitals(prod_id, content, replace)
