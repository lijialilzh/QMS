from datetime import datetime
from typing import Optional
from pydantic import Field
from .tobj_qa_doc import QaDocForm


class QaDocObj(QaDocForm):
    kind_name: Optional[str] = Field(title="文档名称")
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_full_version: Optional[str] = Field(title="完整版本")
    product_type_code: Optional[str] = Field(title="产品型号")
    create_time: Optional[datetime] = Field(title="创建时间")
