#!/usr/bin/env python
# encoding: utf-8

# 自研软件研究报告接口层。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_research_doc import ResearchDocForm
from ..obj.vobj_research_doc import ResearchDocObj
from ..serv.serv_research_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_research_doc", summary="添加自研软件研究报告", response_model=Resp[ResearchDocForm])
@try_log(perm=Perms.research_doc_edit)
async def add_research_doc(form: ResearchDocForm):
    return await server.add_research_doc(form)


@router.get("/duplicate_research_doc", summary="复制自研软件研究报告", response_model=Resp[ResearchDocForm])
@try_log(perm=Perms.research_doc_edit)
async def duplicate_research_doc(id: int, product_id: int = None):
    return await server.duplicate_research_doc(id, product_id)


@router.post("/update_research_doc", summary="更新自研软件研究报告", response_model=Resp[Any])
@try_log(perm=Perms.research_doc_edit)
async def update_research_doc(form: ResearchDocForm):
    return await server.update_research_doc(form)


@router.delete("/delete_research_doc", summary="删除自研软件研究报告", response_model=Resp[Any])
@try_log(perm=Perms.research_doc_edit)
async def delete_research_doc(id: int):
    return await server.delete_research_doc(id)


@router.get("/list_research_doc", summary="查询自研软件研究报告列表", response_model=Resp[Page[ResearchDocObj]])
@try_log(perm=Perms.research_doc_view)
async def list_research_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_research_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_research_doc", summary="查询自研软件研究报告详情", response_model=Resp[ResearchDocObj])
@try_log(perm=Perms.research_doc_view)
async def get_research_doc(id: int):
    return await server.get_research_doc(id)


@router.get("/research_autofill", summary="自研软件研究报告自动获取预览", response_model=Resp[Any])
@try_log(perm=Perms.research_doc_view)
async def research_autofill(product_id: int):
    return await server.research_autofill(product_id)


@router.get("/export_research_doc", summary="导出自研软件研究报告")
@try_log(perm=Perms.research_doc_view)
async def export_research_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_research_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"自研软件研究报告-{timestamp}.docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}", "Cache-Control": "no-store"},
    )
