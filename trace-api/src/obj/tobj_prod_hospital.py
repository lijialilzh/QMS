#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field


class ProdHospitalForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    prod_id: Optional[int] = Field(title="产品ID")
    contract_no: Optional[str] = Field(title="合同编号")
    org_name: Optional[str] = Field(title="医院名称")
    hospital_no: Optional[str] = Field(title="医院编号")
    region: Optional[str] = Field(title="区域划分")
    province: Optional[str] = Field(title="省份")
    city: Optional[str] = Field(title="城市信息")
    sort_order: Optional[int] = Field(title="排序")
