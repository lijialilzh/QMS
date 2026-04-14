from pydantic import Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_test_set import TestSetForm


class TestSetObj(TestSetForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")