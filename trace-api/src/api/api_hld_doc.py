#!/usr/bin/env python
# encoding: utf-8

import io
import urllib.parse
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_hld_doc import HldDocForm, HldNodeForm
from ..obj.tobj_role import Perms
from ..obj.vobj_hld_doc import HldDocObj
from ..serv.serv_hld_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_hld_doc", summary="添加HLD_DOC", response_model=Resp[HldDocForm])
@try_log(perm=Perms.hld_doc_edit)
async def add_hld_doc(form: HldDocForm):
    return await server.add_hld_doc(form)


@router.get("/duplicate_hld_doc", summary="复制HLD_DOC", response_model=Resp[HldDocForm])
@try_log(perm=Perms.hld_doc_edit)
async def duplicate_hld_doc(id: int, product_id: int = None):
    return await server.duplicate_hld_doc(id, product_id)


@router.delete("/delete_hld_doc", summary="删除HLD_DOC", response_model=Resp[Any])
@try_log(perm=Perms.hld_doc_edit)
async def delete_hld_doc(id: int):
    return await server.delete_hld_doc(id)


@router.post("/add_hld_node", summary="增加HLD_DOC节点", response_model=Resp[Any])
@try_log(perm=Perms.hld_doc_edit)
async def add_hld_node(form: HldNodeForm):
    return await server.add_hld_node(form)


@router.delete("/delete_hld_node", summary="删除HLD_DOC节点", response_model=Resp[Any])
@try_log(perm=Perms.hld_doc_edit)
async def delete_hld_node(doc_id: int, n_id: int):
    return await server.delete_hld_node(doc_id, n_id)


@router.post("/update_hld_doc", summary="更新HLD_DOC", response_model=Resp[Any])
@try_log(perm=Perms.hld_doc_edit)
async def update_hld_doc(form: HldDocForm):
    return await server.update_hld_doc(form)


@router.post("/update_hld_doc_file_no", summary="更新HLD文件编号", response_model=Resp[Any])
@try_log(perm=Perms.hld_doc_edit)
async def update_hld_doc_file_no(id: int = Form(...), file_no: str = Form("")):
    return await server.update_hld_doc_file_no(id=id, file_no=file_no)


@router.get("/list_hld_doc", summary="查询HLD_DOC列表", response_model=Resp[Page[HldDocObj]])
@try_log(perm=Perms.hld_doc_view)
async def list_hld_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_hld_doc(op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_hld_doc", summary="查询HLD_DOC详情", response_model=Resp[HldDocObj])
@try_log(perm=Perms.hld_doc_view)
async def get_hld_doc(id: int):
    return await server.get_hld_doc(id, with_tree=True)


@router.get("/sync_hld_from_sds", summary="从详细设计读取接口与库表", response_model=Resp[Any])
@try_log(perm=Perms.hld_doc_view)
async def sync_hld_from_sds(product_id: int, version: str):
    op_user = CtxUser.get()
    return await server.sync_hld_from_sds(op_user, product_id=product_id, version=version)


@router.post("/add_doc_file", summary="添加文档图片", response_model=Resp[str])
@try_log(perm=Perms.hld_doc_edit)
async def add_doc_file(
    doc_id: int = Form(...),
    ref_type: str = Form(default=None),
    file: UploadFile = File(default=None),
):
    return await server.add_doc_file(doc_id, file, ref_type=ref_type)


@router.post("/import_hld_doc_word", summary="导入HLD Word", response_model=Resp[HldDocForm])
@try_log(perm=Perms.hld_doc_edit)
async def import_hld_doc_word(
    product_id: int = Form(...),
    version: str = Form(...),
    change_log: str = Form(default=""),
    file: UploadFile = File(...),
):
    return await server.import_hld_doc_word(
        product_id=product_id,
        version=version,
        change_log=change_log,
        file=file,
    )


@router.get("/export_hld_doc", summary="导出HLD_DOC")
@try_log(perm=Perms.hld_doc_view)
async def export_hld_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_hld_doc(output, id)
    output.seek(0)
    timestamp = datetime.now().strftime("%y%m%d.%H%M%S")
    suffix = uuid4().hex[:8]
    raw_name = f"hld_doc_{timestamp}_{suffix}.docx"
    filename = urllib.parse.quote(raw_name)
    return StreamingResponse(
        content=output,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename={filename}; filename*=UTF-8''{filename}",
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
        },
    )


@router.post("/export_hld_doc_snapshot", summary="按当前编辑快照导出HLD_DOC")
@try_log(perm=Perms.hld_doc_view)
async def export_hld_doc_snapshot(form: HldDocForm):
    output = io.BytesIO()
    await server.export_hld_doc(output, form.id or 0, snapshot=form)
    output.seek(0)
    timestamp = datetime.now().strftime("%y%m%d.%H%M%S")
    suffix = uuid4().hex[:8]
    raw_name = f"hld_doc_{timestamp}_{suffix}.docx"
    filename = urllib.parse.quote(raw_name)
    return StreamingResponse(
        content=output,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename={filename}; filename*=UTF-8''{filename}",
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
        },
    )
