from pydantic import Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_cst import CstForm


class CstObj(CstForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    