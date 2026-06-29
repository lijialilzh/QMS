#!/usr/bin/env python
# encoding: utf-8


from typing import Optional, Any
from pydantic import BaseModel, Field


class PhaDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    version: Optional[str] = Field(title="文档版本")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="变更说明")
    content: Optional[Any] = Field(title="文档内容")
