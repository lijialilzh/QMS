#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import io
import re
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from ..obj.tobj_prod_rcm import ProdRcmsForm
from ..obj.vobj_prod_rcm import ProdRcmObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_rcm import Server
from ..serv.serv_product import Server as ProductServer
from . import CtxUser, try_log, ROLES_RISK_WRITE
from ..utils.i18n import ts
from ..utils import download_name

router = APIRouter()
server = Server()


def _safe_name(text) -> str:
    """文件名里剔除非法字符，避免下载时被浏览器或系统截断。"""
    value = str(text or "").strip()
    return re.sub(r'[\\/:*?"<>|\r\n\t]', "_", value)


async def _prod_name_version(prod_id) -> list:
    """按产品 id 取「产品名称 / 完整版本」，用于导出文件名；查不到时返回空列表。"""
    try:
        resp = await ProductServer().get_product(prod_id)
    except Exception:
        return []
    prod = getattr(resp, "data", None)
    if not prod:
        return []
    return [x for x in (_safe_name(getattr(prod, "name", None)), _safe_name(getattr(prod, "full_version", None))) if x]


@router.post("/add_prod_rcms", summary="添加RCM", response_model=Resp[Any])
@try_log(perm=Perms.prod_rcm_edit, roles=ROLES_RISK_WRITE)
async def add_prod_rcms(form: ProdRcmsForm):
    return await server.add_prod_rcms(form) 


@router.delete("/delete_prod_rcms", summary="删除RCM", response_model=Resp[Any])
@try_log(perm=Perms.prod_rcm_edit, roles=ROLES_RISK_WRITE)
async def delete_prod_rcms(id: str):
    return await server.delete_prod_rcms((id or "").split(","))  


@router.get("/list_prod_rcm", summary="查询RCM列表", response_model=Resp[Page[ProdRcmObj]])
@try_log(perm=Perms.prod_rcm_view)
async def list_prod_rcm(prod_id: int = None, page_index: int = 0, page_size: int = 10, brief: int = 0):
    op_user = CtxUser.get()
    return await server.list_prod_rcm(op_user, prod_id=prod_id, page_index=page_index, page_size=page_size, brief=bool(brief))


@router.get("/export_prod_rcms", summary="导出RCM列表", response_model=Resp[Any])
@try_log(perm=Perms.prod_rcm_view)
async def export_prod_rcms(prod_id: int = None, page_index: int = 0, page_size: int = 10):
    op_user = CtxUser.get()
    output = io.BytesIO()
    await server.export_prod_rcms(op_user, output, prod_id=prod_id, page_index=page_index, page_size=page_size)
    # 按产品版本导出时文件名带上产品名称与完整版本，多版本下载后便于区分
    parts = [ts('file_prod_rcm')]
    if prod_id:
        parts.extend(await _prod_name_version(prod_id))
    filename = download_name.quoted("", "-".join(parts), "xlsx")
    return StreamingResponse(content=output, 
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
