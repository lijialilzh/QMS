#!/usr/bin/env python
# encoding: utf-8

# Bug管理及回归测试接口层（测试文件，上传只读存档）。

import io
import urllib.parse
from typing import Any
from fastapi import APIRouter, Form, File, UploadFile
from fastapi.responses import StreamingResponse, FileResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_bug_doc import BugDocForm
from ..obj.vobj_bug_doc import BugDocObj
from ..serv.serv_bug_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_bug_doc", summary="上传Bug管理及回归测试", response_model=Resp[BugDocForm])
@try_log(perm=Perms.bug_doc_edit)
async def add_bug_doc(product_id: int = Form(...), version: str = Form(...),
                      file_no: str = Form(default=None), change_log: str = Form(default=None),
                      file: UploadFile = File(default=None)):
    form = BugDocForm(product_id=product_id, version=version, file_no=file_no, change_log=change_log)
    return await server.add_bug_doc(form, file)


@router.post("/update_bug_doc", summary="更新Bug管理及回归测试", response_model=Resp[Any])
@try_log(perm=Perms.bug_doc_edit)
async def update_bug_doc(id: int = Form(...), product_id: int = Form(default=None), version: str = Form(default=None),
                         file_no: str = Form(default=None), change_log: str = Form(default=None),
                         file: UploadFile = File(default=None)):
    form = BugDocForm(id=id, product_id=product_id, version=version, file_no=file_no, change_log=change_log)
    return await server.update_bug_doc(form, file)


@router.delete("/delete_bug_doc", summary="删除Bug管理及回归测试", response_model=Resp[Any])
@try_log(perm=Perms.bug_doc_edit)
async def delete_bug_doc(id: int):
    return await server.delete_bug_doc(id)


@router.get("/list_bug_doc", summary="查询Bug管理及回归测试列表", response_model=Resp[Page[BugDocObj]])
@try_log(perm=Perms.bug_doc_view)
async def list_bug_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_bug_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_bug_doc", summary="查询Bug管理及回归测试详情", response_model=Resp[BugDocObj])
@try_log(perm=Perms.bug_doc_view)
async def get_bug_doc(id: int):
    return await server.get_bug_doc(id)


@router.get("/preview_bug_doc", summary="在线预览Bug管理及回归测试", response_model=Resp[Any])
@try_log(perm=Perms.bug_doc_view)
async def preview_bug_doc(id: int):
    return await server.preview_bug_doc(id)


@router.get("/download_bug_template", summary="下载Bug管理及回归测试模版")
@try_log(perm=Perms.bug_doc_view)
async def download_bug_template():
    data = server.template_bytes()
    if data is None:
        return Resp.resp_err(msg="模版不存在")
    quoted = urllib.parse.quote("Bug管理及回归测试模版.xlsx")
    return StreamingResponse(
        content=io.BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={quoted}"},
    )


@router.get("/download_bug_doc", summary="下载Bug管理及回归测试原始文件")
@try_log(perm=Perms.bug_doc_view)
async def download_bug_doc(id: int = 0):
    filename, path = await server.download_bug_doc(id)
    if path is None:
        return Resp.resp_err(msg="文件不存在")
    quoted = urllib.parse.quote(filename)
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )
