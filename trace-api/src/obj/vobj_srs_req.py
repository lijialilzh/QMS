#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import List, Optional
from pydantic import BaseModel, Field
from .tobj_srs_req import SrsReqForm


class SrsReqObj(SrsReqForm):
    rcm_codes: Optional[List[str]] = Field(title="RCM编号")
    