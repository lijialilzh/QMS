#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field


class TimelineRowForm(BaseModel):
    id: Optional[int] = Field(title="行ID")
    prod_id: Optional[int] = Field(title="产品ID")
    year: Optional[str] = Field(title="年")
    month: Optional[str] = Field(title="月")
    day: Optional[str] = Field(title="日")
    row_type: Optional[str] = Field(title="行类型")
    milestone_text: Optional[str] = Field(title="里程碑/年份说明")
    sort_order: Optional[int] = Field(title="排序")


class TimelineCellForm(BaseModel):
    row_id: Optional[int] = Field(title="行ID")
    dept: Optional[str] = Field(title="部门")
    output_result: Optional[str] = Field(title="输出结果")
