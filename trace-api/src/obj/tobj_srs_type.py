#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field


class SrsTypeForm(BaseModel):
    id: Optional[int] = Field(title="需求ID")
    doc_id: Optional[int] = Field(title="需求文档ID")
    type_code: Optional[str] = Field(title="类型编号")
    type_name: Optional[str] = Field(title="类型名称")
    