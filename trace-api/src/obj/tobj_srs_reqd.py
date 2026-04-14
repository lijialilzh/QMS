#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import List, Optional
from pydantic import BaseModel, Field


class SrsReqdForm(BaseModel):
    req_id: Optional[int] = Field(title="需求ID")

    doc_id: Optional[int] = Field(title="文档ID")
    code: Optional[str] = Field(title="需求编号")
    name: Optional[str] = Field(title="需求名称")

    overview: Optional[str] = Field(title="需求概述")
    participant: Optional[str] = Field(title="参与人")
    pre_condition: Optional[str] = Field(title="前置条件")
    trigger: Optional[str] = Field(title="触发条件")
    work_flow: Optional[str] = Field(title="工作流程")
    post_condition: Optional[str] = Field(title="后置条件")
    exception: Optional[str] = Field(title="异常情况")
    constraint: Optional[str] = Field(title="约束")
    rcm_ids: Optional[List[int]] = Field(title="RCM")
