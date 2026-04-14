from pydantic import Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_test_case import TestCaseForm


class TestCaseObj(TestCaseForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    stage: Optional[str] = Field(title="测试阶段")
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    