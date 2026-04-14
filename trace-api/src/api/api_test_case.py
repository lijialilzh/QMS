#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any
from datetime import datetime
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from ..obj.vobj_test_case import TestCaseObj
from ..obj.tobj_test_case import TestCaseForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_test_case import Server
from . import try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_test_case", summary="添加测试用例", response_model=Resp[Any])
@try_log(perm=Perms.test_case_edit)
async def add_test_case(form: TestCaseForm):
    return await server.add_test_case(form) 


@router.delete("/delete_test_case", summary="删除测试用例", response_model=Resp[Any])
@try_log(perm=Perms.test_case_edit)
async def delete_test_case(id: int):
    return await server.delete_test_case(id)  


@router.post("/update_test_case", summary="更新测试用例", response_model=Resp[Any])
@try_log(perm=Perms.test_case_edit)
async def update_test_case(form: TestCaseForm):
    return await server.update_test_case(form) 


@router.get("/list_test_case", summary="查询测试用例列表", response_model=Resp[Page[TestCaseObj]])
@try_log(perm=[Perms.test_case_view, Perms.srs_doc_view])
async def list_test_case(set_id: int):
    return await server.list_test_case(set_id=set_id)


@router.get("/get_test_case", summary="查询测试用例详情", response_model=Resp[TestCaseObj])
@try_log(perm=Perms.test_case_view)
async def get_test_case(id: int):
    return await server.get_test_case(id)


@router.get("/export_test_cases", summary="导出测试用例列表", response_model=Resp[Any])
@try_log(perm=Perms.test_case_view)
async def export_test_cases(set_id: int):
    output = io.BytesIO()
    await server.export_test_cases(output, set_id=set_id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_test_case')}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
