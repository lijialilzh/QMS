#!/usr/bin/env python
# encoding: utf-8

from typing import Optional
from pydantic import BaseModel, Field


class PersonSignForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    name: Optional[str] = Field(title="人员姓名")
    position: Optional[str] = Field(title="人员职务")
    seal_img: Optional[str] = Field(title="预留印鉴")
    sign_img: Optional[str] = Field(title="人员签字")
    status: Optional[str] = Field(title="状态")
    sort_order: Optional[int] = Field(title="排序")
