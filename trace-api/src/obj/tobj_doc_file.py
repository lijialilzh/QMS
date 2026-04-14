#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field


class DocFileForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    category: Optional[str] = Field(title="类型")

    file_name: Optional[str] = Field(title="文件名")
    file_size: Optional[int] = Field(title="文件大小")
    file_url: Optional[str] = Field(title="文件URL")
    