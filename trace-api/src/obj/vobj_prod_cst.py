#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import List, Optional
from datetime import datetime
from pydantic import Field
from .tobj_prod_cst import ProdCstForm


class ProdCstObj(ProdCstForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
