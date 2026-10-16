#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field


class TestSetForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    stage: Optional[str] = Field(title="阶段")
    file_no: Optional[str] = Field(default="", title="文件编号")
    file_name: Optional[str] = Field(default="", title="文件名称")
