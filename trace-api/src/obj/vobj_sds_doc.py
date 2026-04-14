from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional, Any
from .tobj_sds_doc import SdsDocForm


class SdsDocObj(SdsDocForm):
    product_id: Optional[int] = Field(title="产品ID")
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    create_time: Optional[datetime] = Field(title="创建时间")

    srs_version: Optional[str] = Field(title="需求规格版本")

class CompareObj(BaseModel):
    column_code: str = Field(title="列名CODE")
    column_name: str = Field(title="列名")
    same_flag: int = Field(title="是否相同")
    values: List[Any] = Field(title="值列表")
    