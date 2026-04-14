from pydantic import Field
from datetime import datetime
from typing import Optional
from .tobj_srs_doc import SrsDocForm


class SrsDocObj(SrsDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    create_time: Optional[datetime] = Field(title="创建时间")
    