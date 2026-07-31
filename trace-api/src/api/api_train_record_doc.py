#!/usr/bin/env python
# encoding: utf-8

# 培训记录表接口层（测试文件）。

import io
import urllib.parse
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..obj import Page, Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_train_record_doc import TrainRecordDocForm
from ..obj.vobj_train_record_doc import TrainRecordDocObj
from ..serv.serv_train_record_doc import Server
from . import CtxUser, try_log

router = APIRouter()
server = Server()


@router.post("/add_train_record_doc", summary="添加培训记录表", response_model=Resp[TrainRecordDocForm])
@try_log(perm=Perms.ftr_record_doc_edit)
async def add_train_record_doc(form: TrainRecordDocForm):
    return await server.add_train_record_doc(form)


@router.get("/duplicate_train_record_doc", summary="复制培训记录表", response_model=Resp[TrainRecordDocForm])
@try_log(perm=Perms.ftr_record_doc_edit)
async def duplicate_train_record_doc(id: int, product_id: int = None):
    return await server.duplicate_train_record_doc(id, product_id)


@router.post("/update_train_record_doc", summary="更新培训记录表", response_model=Resp[Any])
@try_log(perm=Perms.ftr_record_doc_edit)
async def update_train_record_doc(form: TrainRecordDocForm):
    return await server.update_train_record_doc(form)


@router.get("/rebind_product", summary="切换产品并重新获取产品信息", response_model=Resp[TrainRecordDocObj])
@try_log(perm=Perms.ftr_record_doc_edit)
async def rebind_product(id: int, product_id: int):
    return await server.rebind_product(id, product_id)


@router.delete("/delete_train_record_doc", summary="删除培训记录表", response_model=Resp[Any])
@try_log(perm=Perms.ftr_record_doc_edit)
async def delete_train_record_doc(id: int):
    return await server.delete_train_record_doc(id)


@router.get("/list_train_record_doc", summary="查询培训记录表列表", response_model=Resp[Page[TrainRecordDocObj]])
@try_log(perm=Perms.ftr_record_doc_view)
async def list_train_record_doc(product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    return await server.list_train_record_doc(op_user=op_user, product_id=product_id, version=version, page_index=page_index, page_size=page_size)


@router.get("/get_train_record_doc", summary="查询培训记录表详情", response_model=Resp[TrainRecordDocObj])
@try_log(perm=Perms.ftr_record_doc_view)
async def get_train_record_doc(id: int):
    return await server.get_train_record_doc(id)


@router.get("/export_train_record_doc", summary="导出培训记录表")
@try_log(perm=Perms.ftr_record_doc_view)
async def export_train_record_doc(id: int = 0):
    output = io.BytesIO()
    await server.export_train_record_doc(output, id)
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    filename = urllib.parse.quote(f"培训记录表-{timestamp}.docx")
    return StreamingResponse(content=output, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})