#!/usr/bin/env python
# encoding: utf-8

# 网络安全维护计划出参 Obj。

from datetime import datetime
from typing import Optional
from pydantic import Field
from .tobj_nsmp_doc import NsmpDocForm


class NsmpDocObj(NsmpDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_full_version: Optional[str] = Field(title="完整版本")
    product_type_code: Optional[str] = Field(title="产品型号")
    create_time: Optional[datetime] = Field(title="创建时间")
