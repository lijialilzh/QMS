#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import List, Optional
from pydantic import BaseModel, Field


class SrsReqForm(BaseModel):
    id: Optional[int] = Field(title="需求ID")
    doc_id: Optional[int] = Field(title="需求文档ID")
    code: Optional[str] = Field(title="需求编号")
    module: Optional[str] = Field(title="模块")
    function: Optional[str] = Field(title="功能")
    sub_function: Optional[str] = Field(title="子功能")

    location: Optional[str] = Field(title="位置")
    type_code: Optional[str] = Field(title="需求类型")

    rcm_ids: Optional[List[int]] = Field(title="RCM")
    