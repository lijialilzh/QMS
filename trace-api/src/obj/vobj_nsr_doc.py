#!/usr/bin/env python
# encoding: utf-8

# 自研软件网络安全研究报告出参 Obj。

from datetime import datetime
from typing import Optional
from pydantic import Field
from .tobj_nsr_doc import NsrDocForm


class NsrDocObj(NsrDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_full_version: Optional[str] = Field(title="完整版本")
    product_type_code: Optional[str] = Field(title="产品型号")
    create_time: Optional[datetime] = Field(title="创建时间")
