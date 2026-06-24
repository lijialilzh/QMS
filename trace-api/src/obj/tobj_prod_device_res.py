#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional, Any
from pydantic import BaseModel, Field


class ProdDeviceResForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    prod_id: Optional[int] = Field(title="产品ID")
    items: Optional[list[Any]] = Field(title="设备资源条目")
