#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any, List
from datetime import datetime
from uuid import uuid4
from fastapi import APIRouter, Form, File, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.vobj_srs_doc import SrsDocObj
from ..obj.vobj_sds_doc import CompareObj
from ..obj.tobj_srs_doc import SrsDocForm, SrsNodeForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_srs_doc import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_srs_doc", summary="添加SRS_DOC", response_model=Resp[SrsDocForm])
@try_log(perm=Perms.srs_doc_edit)
async def add_srs_doc(form: SrsDocForm):
    return await server.add_srs_doc(form) 


@router.get("/duplicate_srs_doc", summary="复制SRS_DOC", response_model=Resp[SrsDocForm])
@try_log(perm=Perms.srs_doc_edit)
async def duplicate_srs_doc(id: int):
    return await server.duplicate_srs_doc(id)


@router.delete("/delete_srs_doc", summary="删除SRS_DOC", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def delete_srs_doc(id: int):
    return await server.delete_srs_doc(id) 


@router.post("/add_srs_node", summary="增加SRS_DOC节点", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def add_srs_node(form: SrsNodeForm):
    return await server.add_srs_node(form) 


@router.delete("/delete_srs_node", summary="删除SRS_DOC节点", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def delete_srs_node(doc_id: int, n_id: int):
    return await server.delete_srs_node(doc_id, n_id) 


@router.post("/update_srs_doc", summary="更新SRS_DOC", response_model=Resp[Any])
@try_log(perm=Perms.srs_doc_edit)
async def update_srs_doc(form: SrsDocForm):
    return await server.update_srs_doc(form) 


@router.get("/list_srs_doc", summary="查询SRS_DOC列表", response_model=Resp[Page[SrsDocObj]])
@try_log(perm=Perms.srs_doc_view)
async def list_srs_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_srs_doc(op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_srs_doc", summary="查询SRS_DOC详情", response_model=Resp[SrsDocObj])
@try_log(perm=Perms.srs_doc_view)
async def get_srs_doc(id: int):
    return await server.get_srs_doc(id, with_tree=True)


@router.post("/add_doc_file", summary="添加文档文件", response_model=Resp[str])
@try_log(perm=Perms.sds_doc_edit)
async def add_doc_file(doc_id: int = Form(...), file: UploadFile = File(default=None)):
    return await server.add_doc_file(doc_id, file) 


@router.get("/export_srs_doc", summary="导出SRS_DOC")
@try_log(perm=Perms.srs_doc_view)
async def export_srs_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_srs_doc(output, id)
    output.seek(0)
    timestamp = datetime.now().strftime("%y%m%d.%H%M%S")
    suffix = uuid4().hex[:8]
    raw_name = f"srs_doc_{timestamp}_{suffix}.docx"
    filename = urllib.parse.quote(raw_name)
    return StreamingResponse(content=output, 
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename={filename}; filename*=UTF-8''{filename}",
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
        }
    )


@router.get("/list_doc_trace", summary="SRS_DOC追溯", response_model=Resp[List[Any]])
@try_log(perm=Perms.srs_doc_view)
async def list_doc_trace(id: int = 0):
    return await server.list_doc_trace(id)


@router.post("/import_srs_doc_word", summary="导入SRS Word", response_model=Resp[SrsDocForm])
@try_log(perm=Perms.srs_doc_edit)
async def import_srs_doc_word(
    product_id: int = Form(...),
    version: str = Form(...),
    change_log: str = Form(default=""),
    file: UploadFile = File(...),
):
    return await server.import_srs_doc_word(product_id=product_id, version=version, change_log=change_log, file=file)


@router.get("/export_doc_trace", summary="导出SRS_DOC追溯")
@try_log(perm=Perms.srs_doc_view)
async def export_doc_trace(id: int = 0):
    resp = await server.get_srs_doc(id)
    doc = resp.data or SrsDocObj()
    name = f"{doc.product_name}-{doc.product_version}-{doc.version}"

    output = io.BytesIO()
    await server.export_doc_trace(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_doc_trace')}-{name}-{timestamp}.xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/compare_srs_doc", summary="对比SRS_DOC", response_model=Resp[List[CompareObj]])
@try_log(perm=Perms.srs_doc_view)
async def compare_srs_doc(id0: int, id1: int):
    return await server.compare_srs_doc(id0, id1)
