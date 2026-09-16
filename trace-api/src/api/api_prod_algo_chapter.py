#!/usr/bin/env python
# encoding: utf-8


from typing import Any
from fastapi import APIRouter
from ..obj.tobj_prod_algo_chapter import ProdAlgoChapterForm
from ..obj.vobj_prod_algo_chapter import ProdAlgoChapterObj
from ..obj.tobj_role import Perms
from ..obj import Resp, Page
from ..serv.serv_prod_algo_chapter import Server
from . import try_log

router = APIRouter()
server = Server()


@router.post("/add_prod_algo_chapter", summary="添加章节模块", response_model=Resp[Any])
@try_log(perm=Perms.prod_algo_chapter_edit)
async def add_prod_algo_chapter(form: ProdAlgoChapterForm):
    return await server.add_prod_algo_chapter(form)


@router.post("/update_prod_algo_chapter", summary="更新章节模块", response_model=Resp[Any])
@try_log(perm=Perms.prod_algo_chapter_edit)
async def update_prod_algo_chapter(form: ProdAlgoChapterForm):
    return await server.update_prod_algo_chapter(form)


@router.delete("/delete_prod_algo_chapters", summary="删除章节模块", response_model=Resp[Any])
@try_log(perm=Perms.prod_algo_chapter_edit)
async def delete_prod_algo_chapters(id: str):
    return await server.delete_prod_algo_chapters((id or "").split(","))


@router.get("/list_prod_algo_chapter", summary="查询章节模块列表", response_model=Resp[Page[ProdAlgoChapterObj]])
@try_log(perm=Perms.prod_algo_chapter_view)
async def list_prod_algo_chapter(prod_id: int = None, page_index: int = 0, page_size: int = 100):
    return await server.list_prod_algo_chapter(prod_id, page_index, page_size)