#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import Field
from .tobj_prod_dhf import ProdDhfForm


class ProdDhfObj(ProdDhfForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    