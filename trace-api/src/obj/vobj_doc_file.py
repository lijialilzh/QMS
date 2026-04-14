from pydantic import Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_doc_file import DocFileForm


class DocFileObj(DocFileForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    product_id: Optional[int] = Field(title="产品ID")
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_type_code: Optional[str] = Field(title="产品类型编码")

    srsdoc_version: Optional[str] = Field(title="需求文档版本")
    