#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional, List
from pydantic import BaseModel, Field


class ProdDhfForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    prod_id: Optional[int] = Field(title="产品ID")
    code: Optional[str] = Field(title="编号")
    name: Optional[str] = Field(title="名称")


class ProdDhfBatchDeleteForm(BaseModel):
    ids: Optional[List[int]] = Field(title="批量删除ID")


class ProdDhfCopyForm(BaseModel):
    source_prod_id: int = Field(title="源产品ID")
    target_product_id: int = Field(title="目标产品ID")


class ProdDhfProdDeleteForm(BaseModel):
    prod_id: int = Field(title="产品ID")
    