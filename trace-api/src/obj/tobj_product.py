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
    registrant: Optional[str] = Field(title="注册人")
    scope: Optional[str] = Field(title="试用范围")
    component: Optional[str] = Field(title="产品组成")
    overall_desc: Optional[str] = Field(title="总体描述")
    note: Optional[str] = Field(title="备注")

    user_ids: Optional[List[int]] = Field(title="用户ID列表")

    dhf_count: Optional[int] = Field(title="复制DHF条数")
    doc_count: Optional[int] = Field(title="复制文档数")
    test_set_count: Optional[int] = Field(title="复制测试集数")
    doc_file_count: Optional[int] = Field(title="复制图表文件数")
    runtime_env_copied: Optional[int] = Field(title="是否已复制运行环境(1=是)")