from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_cst import CstForm


class CstRcmBrief(BaseModel):
    id: Optional[int] = Field(default=None, title="RCM ID")
    code: Optional[str] = Field(default=None, title="RCM编号")
    description: Optional[str] = Field(default=None, title="RCM描述")


class CstObj(CstForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    rcm_ids: Optional[list[int]] = Field(default=None, title="关联RCM ID列表")
    rcms: Optional[list[CstRcmBrief]] = Field(default=None, title="关联RCM明细")
