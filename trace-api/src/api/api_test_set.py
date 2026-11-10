#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
from typing import Any
from fastapi import APIRouter, Form, File, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.vobj_test_set import TestSetObj
from ..obj.tobj_test_set import TestSetForm
from ..obj.tobj_role import Perms
from ..utils import download_name
from ..obj import Resp, Page
from ..serv.serv_test_set import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_test_set", summary="添加测试集", response_model=Resp[Any])
@try_log(perm=Perms.test_set_edit)
async def add_test_set(product_id: int = Form(...), stage: str = Form(...), file: UploadFile = File(default=None)):
    form = TestSetForm(product_id=product_id, stage=stage)
    return await server.add_test_set(form, file) 


@router.delete("/delete_test_set", summary="删除测试集", response_model=Resp[Any])
@try_log(perm=Perms.test_set_edit)
async def delete_test_set(id: int):
    return await server.delete_test_set(id)  


@router.post("/update_test_set", summary="更新测试集", response_model=Resp[Any])
@try_log(perm=Perms.test_set_edit)
async def update_test_set(id: int = Form(...), product_id: int = Form(default=None), stage: str = Form(default=None), file: UploadFile = File(default=None)):
    form = TestSetForm(id=id, product_id=product_id, stage=stage)
    return await server.update_test_set(form, file) 


@router.get("/list_test_set", summary="查询测试集列表", response_model=Resp[Page[TestSetObj]])
@try_log(perm=[Perms.test_set_view, Perms.srs_doc_view])
async def list_test_set(product_id: int = None, stage: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_test_set(op_user, product_id=product_id, stage=stage, page_index=page_index, page_size=page_size)


@router.get("/get_test_set", summary="查询测试集详情", response_model=Resp[TestSetObj])
@try_log(perm=Perms.test_set_view)
async def get_test_set(id: int):
    return await server.get_test_set(id)


def _test_case_review_file_no(product_id: int, kind: str) -> str:
    """测试用例评审记录的文件编号取该产品 DHF（软件测试/用户测试用例）。"""
    from sqlalchemy import select
    from ..model.prod_dhf import ProdDhf
    from ..utils.sql_ctx import db
    kw = "用户测试用例" if kind == "用户测试" else "测试用例"
    rows = db.session.execute(
        select(ProdDhf).where(ProdDhf.product_id == product_id)
    ).scalars().all()
    for row in rows:
        name = str(getattr(row, "name", "") or "")
        if kw not in name:
            continue
        if kw == "测试用例" and "用户" in name:
            continue
        no = (getattr(row, "code", "") or "").strip()
        if no:
            return no
    return ""


@router.get("/export_test_case_review", summary="导出测试用例评审记录")
@try_log(perm=Perms.test_set_view)
async def export_test_case_review(product_id: int, kind: str):
    """kind=软件测试|用户测试；导出 Word，版本暂 A0。"""
    output = io.BytesIO()
    title = server.export_test_case_review(output, product_id=product_id, kind=kind)
    file_no = _test_case_review_file_no(product_id, kind)
    filename = download_name.quoted(file_no, title, "docx", fallback=title)
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
