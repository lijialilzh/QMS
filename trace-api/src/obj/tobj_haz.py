#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field


class HazForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    code: Optional[str] = Field(title="编号")
    source: Optional[str] = Field(title="来源")
    event: Optional[str] = Field(title="事件")
    situation: Optional[str] = Field(title="情况")
    damage: Optional[str] = Field(title="伤害")

    init_rate: Optional[int] = Field(title="初始风险等级")
    init_degree: Optional[str] = Field(title="初始危害等级")
    init_level: Optional[str] = Field(title="初始风险水平")

    deal: Optional[str] = Field(title="处置")
    rcms: Optional[str] = Field(title="RCMS")
    evidence: Optional[str] = Field(title="证据")

    cur_rate: Optional[int] = Field(title="剩余风险等级")
    cur_degree: Optional[str] = Field(title="剩余危害等级")
    cur_level: Optional[str] = Field(title="剩余风险水平")

    benefit_flag: Optional[int] = Field(title="效益标志")
    category: Optional[str] = Field(title="分类")
    