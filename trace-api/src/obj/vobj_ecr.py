from typing import Optional
from datetime import datetime
from pydantic import Field
from .tobj_ecr import EcrForm


class EcrObj(EcrForm):
    create_time: Optional[datetime] = Field(title="创建时间")
