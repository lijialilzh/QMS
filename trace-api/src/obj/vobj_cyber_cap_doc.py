from datetime import datetime
from typing import Optional, Any
from pydantic import Field
from .tobj_cyber_cap_doc import CyberCapDocForm


class CyberCapDocObj(CyberCapDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_full_version: Optional[str] = Field(title="完整版本")
    product_type_code: Optional[str] = Field(title="产品型号")
    auto: Optional[Any] = Field(title="自动获取内容")
    create_time: Optional[datetime] = Field(title="创建时间")
