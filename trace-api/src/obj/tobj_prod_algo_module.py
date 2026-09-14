#!/usr/bin/env python
# encoding: utf-8


from typing import Optional
from pydantic import BaseModel, Field


class ProdAlgoModuleForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    prod_id: Optional[int] = Field(title="产品ID")
    name: Optional[str] = Field(title="模块名称")
    sort_order: Optional[int] = Field(title="排序")
