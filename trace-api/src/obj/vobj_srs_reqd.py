#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import List, Optional
from pydantic import BaseModel, Field
from .tobj_srs_reqd import SrsReqdForm


class SrsReqdObj(SrsReqdForm):
    rcm_codes: Optional[List[str]] = Field(title="RCM编号")

    module: Optional[str] = Field(title="模块")
    function: Optional[str] = Field(title="功能")
    sub_function: Optional[str] = Field(title="子功能")

    type_code: Optional[str] = Field(title="类型")
    