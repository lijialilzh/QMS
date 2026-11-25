#!/usr/bin/env python
# encoding: utf-8


from typing import Optional
from pydantic import BaseModel, Field


class EcrForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    ecr_no: Optional[str] = Field(title="ECR编号")
    product_name: Optional[str] = Field(title="变更后产品名称")
    version: Optional[str] = Field(title="变更后版本号")
    apply_date: Optional[str] = Field(title="编号申请日期")
    applicant: Optional[str] = Field(title="申请人")
    content: Optional[str] = Field(title="变更申请内容")
    note: Optional[str] = Field(title="备注")
    sort_order: Optional[int] = Field(title="排序")
