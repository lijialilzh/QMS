#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import Field
from .tobj_prod_haz import ProdHazForm


class ProdHazObj(ProdHazForm):
    prod_id: Optional[int] = Field(title="产品ID")
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    