#!/usr/bin/env python
# encoding: utf-8


from typing import Optional, Any
from pydantic import BaseModel, Field


class VersionRuleForm(BaseModel):
    content: Optional[Any] = Field(title="版本命名规则内容")
