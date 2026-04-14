#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field


class ProjectForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    name: Optional[str] = Field(title="名称")
    country: Optional[str] = Field(title="国家")
    note: Optional[str] = Field(title="备注")
