#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field


class ProjectMemberForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    prod_id: Optional[int] = Field(title="产品ID")
    role: Optional[str] = Field(title="职能")
    name: Optional[str] = Field(title="姓名")
    sort_order: Optional[int] = Field(title="排序")
    note: Optional[str] = Field(title="备注")
