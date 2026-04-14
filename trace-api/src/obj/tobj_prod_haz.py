#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field
from .tobj_haz import HazForm


class ProdHazsForm(BaseModel):
    prod_id: Optional[int] = Field(title="产品ID")
    haz_ids: Optional[list[int]] = Field(title="HAZ ID列表")


class ProdHazForm(HazForm):
    pass
    