from typing import List, Optional
from pydantic import BaseModel, Field

class ProductForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    name: Optional[str] = Field(title="名称")
    project_id: Optional[int] = Field(title="项目ID")
    category: Optional[str] = Field(title="类别")
    type_code: Optional[str] = Field(title="类型")
    full_version: Optional[str] = Field(title="完整版本")
    release_version: Optional[str] = Field(title="发布版本")
    udi: Optional[str] = Field(title="UDI")
    product_code: Optional[str] = Field(title="产品代码")
    scope: Optional[str] = Field(title="试用范围")
    component: Optional[str] = Field(title="产品组成")
    note: Optional[str] = Field(title="备注")

    user_ids: Optional[List[int]] = Field(title="用户ID列表")
    