from pydantic import Field, BaseModel
from datetime import datetime
from typing import List, Optional
from .tobj_product import ProductForm


class TraceObj(BaseModel):
    srsdoc_version: Optional[str] = Field(title="SRS文档版本")
    sdsdoc_version: Optional[str] = Field(title="SDS文档版本")


class ProductObj(ProductForm):
    create_time: Optional[datetime] = Field(title="创建时间")

    country: Optional[str] = Field(title="国家")

    traces: Optional[List[TraceObj]] = Field(title="文档版本")
    srs_versions: Optional[List[str]] = Field(title="SRS版本")
    sds_versions: Optional[List[str]] = Field(title="SDS版本")
