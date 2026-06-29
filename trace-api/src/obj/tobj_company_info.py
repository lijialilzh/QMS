#!/usr/bin/env python
# encoding: utf-8

from typing import Optional
from pydantic import BaseModel, Field


class CompanyInfoForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    registrant: Optional[str] = Field(title="注册人")
    address: Optional[str] = Field(title="住所")
    manufacturer: Optional[str] = Field(title="受托生产企业")
    production_address: Optional[str] = Field(title="生产地址")
    production_license_no: Optional[str] = Field(title="生产许可证编号")
    contact_phone: Optional[str] = Field(title="联系电话")
    representative: Optional[str] = Field(title="代表人/职位")
