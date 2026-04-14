#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field
from .tobj_cst import CstForm


class ProdCstsForm(BaseModel):
    prod_id: Optional[int] = Field(title="产品ID")
    cst_ids: Optional[list[int]] = Field(title="CST ID列表")


class ProdCstForm(CstForm):
    prod_id: Optional[int] = Field(title="产品ID")

    prev_score: Optional[float] = Field(title="前一分数")
    prev_severity: Optional[float] = Field(title="前一严重性")
    prev_level: Optional[float] = Field(title="前一等级")
    prev_accept: Optional[str] = Field(title="前一接受度")
    
    cur_score: Optional[float] = Field(title="当前分数")
    cur_severity: Optional[float] = Field(title="当前严重性")
    cur_level: Optional[float] = Field(title="当前等级")
    cur_accept: Optional[str] = Field(title="当前接受度")

    rcm_codes: Optional[str] = Field(title="建议操作")
