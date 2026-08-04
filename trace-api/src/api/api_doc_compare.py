#!/usr/bin/env python
# encoding: utf-8

# 通用文档内容比对接口层。支持所有 content(JSON) 存储的文档类型。

import json
from typing import Any, List
from fastapi import APIRouter

from ..obj import Resp
from ..obj.tobj_role import Perms
from ..obj.vobj_sds_doc import CompareObj
from ..serv.serv_doc_compare import Server
from . import try_log

router = APIRouter()
server = Server()


@router.get("/list_compare_doc_types", summary="查询可比对的文档类型列表")
@try_log(perm=Perms.srs_doc_view)
async def list_compare_doc_types():
    return await server.list_compare_doc_types()


@router.get("/list_compare_doc_versions", summary="查询文档版本列表")
@try_log(perm=Perms.srs_doc_view)
async def list_compare_doc_versions(doc_type: str, product_id: int):
    return await server.list_compare_doc_versions(doc_type, product_id)


@router.get("/compare_doc", summary="通用文档内容比对")
@try_log(perm=Perms.srs_doc_view)
async def compare_doc(doc_type: str, id0: int, id1: int):
    return await server.compare_doc(doc_type, id0, id1)
