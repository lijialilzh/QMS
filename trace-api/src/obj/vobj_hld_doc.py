from datetime import datetime
from typing import Optional
from pydantic import Field
from .tobj_hld_doc import HldDocForm


class HldDocObj(HldDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    create_time: Optional[datetime] = Field(title="创建时间")
