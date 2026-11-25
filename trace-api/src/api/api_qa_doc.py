#!/usr/bin/env python
# encoding: utf-8

# 质量文件接口。详见 docs/function_docs/105_质量文件管理.md。

import io
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..utils import download_name
from ..obj.tobj_qa_doc import QaDocForm
from ..obj.vobj_qa_doc import QaDocObj
from ..serv.qa_doc_templates import KINDS
from ..serv.serv_qa_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_qa_doc", summary="添加质量文件", response_model=Resp[QaDocForm])
@try_log(perm=Perms.qa_file_edit)
async def add_qa_doc(form: QaDocForm):
    return await server.add_qa_doc(form)


@router.post("/update_qa_doc", summary="更新质量文件", response_model=Resp[Any])
@try_log(perm=Perms.qa_file_edit)
async def update_qa_doc(form: QaDocForm):
    return await server.update_qa_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取", response_model=Resp[QaDocObj])
@try_log(perm=Perms.qa_file_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_qa_doc", summary="删除质量文件", response_model=Resp[Any])
@try_log(perm=Perms.qa_file_edit)
async def delete_qa_doc(id: int):
    return await server.delete_qa_doc(id)


@router.get("/list_qa_doc", summary="查询质量文件列表", response_model=Resp[Page[QaDocObj]])
@try_log(perm=Perms.qa_file_view)
async def list_qa_doc(kind: str = None, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_qa_doc(op_user=op_user, kind=kind, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_qa_doc", summary="查询质量文件详情", response_model=Resp[QaDocObj])
@try_log(perm=Perms.qa_file_view)
async def get_qa_doc(id: int):
    return await server.get_qa_doc(id)


@router.get("/export_qa_doc", summary="导出质量文件")
@try_log(perm=Perms.qa_file_view)
async def export_qa_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_qa_doc(output, id)
    doc = await server.get_qa_doc(id)
    data = getattr(doc, "data", None)
    name = KINDS.get(getattr(data, "kind", None), "质量文件")
    filename = download_name.for_obj(data, name, "docx")
    return StreamingResponse(
        content=output,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
