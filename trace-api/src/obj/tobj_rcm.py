#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field


class RcmForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    code: Optional[str] = Field(title="编号")
    description: Optional[str] = Field(title="描述")
    proof: Optional[str] = Field(title="体现证据")
    note: Optional[str] = Field(title="备注")
