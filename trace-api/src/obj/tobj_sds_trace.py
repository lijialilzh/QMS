#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field


class SdsTraceForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    req_id: Optional[int] = Field(title="需求ID")
    doc_id: Optional[int] = Field(title="文档ID")
    sds_code: Optional[str] = Field(title="设计编号")
    chapter: Optional[str] = Field(title="章节")
    location: Optional[str] = Field(title="位置")
    