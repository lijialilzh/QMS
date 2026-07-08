#!/usr/bin/env python
# encoding: utf-8


from typing import Optional, Any
from pydantic import BaseModel, Field


class BugDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    version: Optional[str] = Field(title="文档版本")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="变更说明")
    file_name: Optional[str] = Field(title="原始文件名")
    stats: Optional[Any] = Field(title="缺陷统计")
