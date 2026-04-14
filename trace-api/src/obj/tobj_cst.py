#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field


class CstForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    code: Optional[str] = Field(title="编号")
    category: Optional[str] = Field(title="分类")
    module: Optional[str] = Field(title="模块")
    connection: Optional[str] = Field(title="通信方式")
    description: Optional[str] = Field(title="描述")
    harm: Optional[str] = Field(title="危害后果")
