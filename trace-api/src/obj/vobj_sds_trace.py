#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import Field
from .tobj_sds_trace import SdsTraceForm


class SdsTraceObj(SdsTraceForm):
    doc_id: Optional[int] = Field(title="SDS文档ID")
    srs_code: Optional[str] = Field(title="需求编号")
    name: Optional[str] = Field(title="需求名称")

    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    srsdoc_version: Optional[str] = Field(title="SRS文档版本")
    sdsdoc_version: Optional[str] = Field(title="SDS文档版本")

    type_code: Optional[str] = Field(title="需求类型")
    type_name: Optional[str] = Field(title="需求类型名称")

    module: Optional[str] = Field(title="模块")
    function: Optional[str] = Field(title="功能")
    sub_function: Optional[str] = Field(title="子功能")
    