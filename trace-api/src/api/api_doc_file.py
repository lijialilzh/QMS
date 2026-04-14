#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import logging
from typing import List
from fastapi import APIRouter, File, UploadFile
from ..obj.tobj_srs_doc import Table
from ..obj import Resp
from . import try_log
from ..serv.serv_utils import excel_util

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/read_excel", summary="读取Excel文件", response_model=Resp[List[Table]])
@try_log()
async def read_excel(file: UploadFile = File(default=None)):
    tables = await excel_util.read_excel(file, stream=True)
    return Resp.resp_ok(data=tables)
