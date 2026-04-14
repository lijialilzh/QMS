#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any, List
from datetime import datetime
from fastapi import APIRouter, Form, File, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.vobj_sds_doc import CompareObj, SdsDocObj
from ..obj.tobj_sds_doc import SdsDocForm, SdsNodeForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_sds_doc import Server
from . import CtxUser, try_log
from ..utils.i18n import ts

router = APIRouter()
server = Server()


@router.post("/add_sds_doc", summary="添加SDS_DOC", response_model=Resp[SdsDocForm])
@try_log(perm=Perms.sds_doc_edit)
async def add_sds_doc(form: SdsDocForm):
    return await server.add_sds_doc(form)


@router.get("/duplicate_sds_doc", summary="复制SDS_DOC", response_model=Resp[SdsDocForm])
@try_log(perm=Perms.sds_doc_edit)
async def duplicate_sds_doc(id: int):
    return await server.duplicate_sds_doc(id)


@router.post("/add_doc_file", summary="添加文档文件", response_model=Resp[str])
@try_log(perm=Perms.sds_doc_edit)
async def add_doc_file(doc_id: int = Form(...), file: UploadFile = File(default=None)):
    return await server.add_doc_file(doc_id, file) 


@router.delete("/delete_sds_doc", summary="删除SDS_DOC", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def delete_sds_doc(id: int):
    return await server.delete_sds_doc(id)  


@router.post("/add_sds_node", summary="增加SDS_DOC节点", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def add_sds_node(form:SdsNodeForm):
    return await server.add_sds_node(form) 


@router.delete("/delete_sds_node", summary="删除SDS_DOC节点", response_model=Resp[List[SdsNodeForm]])
@try_log(perm=Perms.sds_doc_edit)
async def delete_sds_node(doc_id: int, n_id: int):
    return await server.delete_sds_node(doc_id, n_id) 


@router.post("/update_sds_doc", summary="更新SDS_DOC", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def update_sds_doc(form: SdsDocForm):
    return await server.update_sds_doc(form) 


@router.get("/list_sds_doc", summary="查询SDS_DOC列表", response_model=Resp[Page[SdsDocObj]])
@try_log(perm=Perms.sds_doc_view)
async def list_sds_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_sds_doc(op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_sds_doc", summary="查询SDS_DOC详情", response_model=Resp[SdsDocObj])
@try_log(perm=Perms.sds_doc_view)
async def get_sds_doc(id: int):
    return await server.get_sds_doc(id, with_tree=True)


@router.get("/export_sds_doc", summary="导出SDS_DOC")
@try_log(perm=Perms.sds_doc_view)
async def export_sds_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_sds_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"{ts('file_sds_doc')}-{timestamp}.docx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/compare_sds_doc", summary="对比SDS_DOC", response_model=Resp[List[CompareObj]])
@try_log(perm=Perms.sds_doc_view)
async def compare_sds_doc(id0: int, id1: int):
    return await server.compare_sds_doc(id0, id1)
