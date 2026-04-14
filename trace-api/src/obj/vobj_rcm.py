from pydantic import Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_rcm import RcmForm


class RcmObj(RcmForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    