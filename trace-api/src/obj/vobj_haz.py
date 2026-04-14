from pydantic import Field
from datetime import datetime
from typing import Optional
from .tobj_haz import HazForm


class HazObj(HazForm):
    create_time: Optional[datetime] = Field(title="创建时间")
