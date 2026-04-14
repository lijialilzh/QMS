#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import List, Optional
from datetime import datetime
from pydantic import Field
from .tobj_prod_rcm import ProdRcmForm


class ProdRcmObj(ProdRcmForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    srs_codes: Optional[List[str]] = Field(title="需求编号列表")
    srs_flag: Optional[int] = Field(title="需求状态")

    test_codes: Optional[List[str]] = Field(title="测试用例编号列表")

    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
