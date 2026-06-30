#!/usr/bin/env python
# encoding: utf-8

# 自研软件网络安全研究报告入参 Form。

from typing import Any, Optional
from pydantic import BaseModel, Field


class NsrDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    version: Optional[str] = Field(title="文档版本")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="版本变更说明")
    content: Optional[dict[str, Any]] = Field(title="文档内容")
