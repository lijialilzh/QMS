from pydantic import Field
from datetime import datetime
from typing import Optional
from .tobj_srs_doc import SrsDocForm


class SrsDocObj(SrsDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    sds_versions: Optional[list] = Field(default_factory=list, title="已绑定的详细设计版本")
    create_time: Optional[datetime] = Field(title="创建时间")
    