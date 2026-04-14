#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import List, Optional
from pydantic import BaseModel, Field
from .tobj_rcm import RcmForm


class ProdRcmsForm(BaseModel):
    prod_id: Optional[int] = Field(title="产品ID")
    rcm_ids: Optional[List[int]] = Field(title="RCM ID列表")


class ProdRcmForm(RcmForm):
    rcm_id: Optional[int] = Field(title="RCM ID")
    