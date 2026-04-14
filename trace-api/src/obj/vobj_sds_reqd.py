#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import List, Optional
from pydantic import Field
from .tobj_sds_reqd import LogicForm, SdsReqdForm

class SdsReqdObj(SdsReqdForm):
    doc_id: Optional[int] = Field(title="SDS文档ID")
    srs_code: Optional[str] = Field(title="需求编号")
    name: Optional[str] = Field(title="需求名称")

    module: Optional[str] = Field(title="模块")
    function: Optional[str] = Field(title="功能")
    sub_function: Optional[str] = Field(title="子功能")
    
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    srsdoc_version: Optional[str] = Field(title="SRS文档版本")
    sdsdoc_version: Optional[str] = Field(title="SDS文档版本")
    logics: Optional[List[LogicForm]] = Field(title="逻辑图")
    