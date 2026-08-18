#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import urllib.parse
from typing import Any, List
from fastapi import APIRouter, Form, File, UploadFile
from fastapi.responses import StreamingResponse
from ..obj.vobj_sds_doc import CompareObj, SdsDocObj
from ..obj.tobj_sds_doc import SdsDocForm, SdsNodeForm
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_sds_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


def _sds_export_filename(file_no: str) -> str:
    # 与导入解析互逆：{文件编号}软件详细设计.docx，中间不加分隔符
    name = f"{(file_no or '').strip()}软件详细设计.docx"
    for ch in '/\\:*?"<>|':
        name = name.replace(ch, "_")
    return name


@router.post("/add_sds_doc", summary="添加SDS_DOC", response_model=Resp[SdsDocForm])
@try_log(perm=Perms.sds_doc_edit)
async def add_sds_doc(form: SdsDocForm):
    return await server.add_sds_doc(form)

@router.post("/import_sds_doc_word", summary="导入Word并创建SDS_DOC", response_model=Resp[SdsDocForm])
@try_log(perm=Perms.sds_doc_edit)
async def import_sds_doc_word(
    product_id: int = Form(...),
    srsdoc_id: int = Form(0),
    version: str = Form(...),
    change_log: str = Form(""),
    file: UploadFile = File(...)
):
    return await server.import_sds_doc_word(
        product_id=product_id,
        srsdoc_id=srsdoc_id,
        version=version,
        change_log=change_log,
        file=file,
    )


@router.get("/duplicate_sds_doc", summary="复制SDS_DOC", response_model=Resp[SdsDocForm])
@try_log(perm=Perms.sds_doc_edit)
async def duplicate_sds_doc(id: int, product_id: int = None):
    return await server.duplicate_sds_doc(id, product_id)


@router.post("/add_doc_file", summary="添加文档文件", response_model=Resp[str])
@try_log(perm=Perms.sds_doc_edit)
async def add_doc_file(
    doc_id: int = Form(...),
    ref_type: str = Form(default=None),
    file: UploadFile = File(default=None),
):
    return await server.add_doc_file(doc_id, file, ref_type=ref_type)


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


@router.post("/update_sds_doc_file_no", summary="更新SDS文件编号", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def update_sds_doc_file_no(id: int = Form(...), file_no: str = Form("")):
    return await server.update_sds_doc_file_no(id=id, file_no=file_no)


@router.post("/sync_srs_trace", summary="从SRS获取追溯并同步章节", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def sync_srs_trace(doc_id: int = Form(...)):
    return await server.sync_srs_trace(doc_id)


@router.post("/sync_design_text_only", summary="页面加载：仅补空章节功能设计内容", response_model=Resp[Any])
@try_log(perm=Perms.sds_doc_edit)
async def sync_design_text_only(doc_id: int = Form(...)):
    return await server.sync_design_text_only(doc_id)


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
    resp = await server.get_sds_doc(id, with_tree=False)
    doc = resp.data or SdsDocObj()
    output = io.BytesIO()
    await server.export_sds_doc(output, id)
    raw_name = _sds_export_filename(doc.file_no)
    filename = urllib.parse.quote(raw_name)
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename={filename}; filename*=UTF-8''{filename}",
        }
    )

@router.get("/compare_sds_doc", summary="对比SDS_DOC", response_model=Resp[List[CompareObj]])
@try_log(perm=Perms.sds_doc_view)
async def compare_sds_doc(id0: int, id1: int):
    return await server.compare_sds_doc(id0, id1)
