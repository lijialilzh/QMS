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
    # 单元/集成/系统：下载名 = 记录文件编号 + 测试记录标题；其它阶段：合集编号+名称
    from sqlalchemy import select
    from ..model.test_set import TestSet
    from ..model.dev_test_record_doc import DevTestRecordDoc
    from ..utils.sql_ctx import db
    ts_row = db.session.execute(select(TestSet).where(TestSet.id == set_id)).scalars().first()
    stage = (getattr(ts_row, "stage", None) or "") if ts_row else ""
    product_id = getattr(ts_row, "product_id", None) if ts_row else None
    if stage in ("单元测试", "集成测试", "系统测试") and product_id:
        from ..serv.serv_dev_test_record_doc import STAGE_META
        rec = db.session.execute(
            select(DevTestRecordDoc).where(
                DevTestRecordDoc.product_id == product_id,
                DevTestRecordDoc.stage == stage,
            ).order_by(DevTestRecordDoc.id.desc())
        ).scalars().first()
        file_no = (getattr(rec, "file_no", None) or "").strip() if rec else ""
        title = (STAGE_META.get(stage) or {}).get("title") or f"{stage}记录"
        raw = f"{file_no} {title}".strip() if file_no else title
    else:
        file_no = (getattr(ts_row, "file_no", None) or "").strip() if ts_row else ""
        file_name = (getattr(ts_row, "file_name", None) or "").strip() if ts_row else ""
        if file_no:
            raw = f"{file_no} {file_name}".strip() if file_name else file_no
        else:
            raw = f"{ts('file_test_case')}-{datetime.now().strftime('%y%m%d.%H%M')}"
    filename = urllib.parse.quote(f"{raw}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
