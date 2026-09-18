#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String
from . import Model


class ProdHospital(Model):
    __tablename__ = "prod_hospital"
    prod_id = Column(Integer, nullable=False, index=True, comment="产品ID")
    contract_no = Column(String(64), comment="合同编号")
    org_name = Column(String(256), comment="医院名称")
    hospital_no = Column(String(64), comment="医院编号")
    region = Column(String(32), comment="区域划分")
    province = Column(String(64), comment="省份")
    city = Column(String(128), comment="城市信息")
    sort_order = Column(Integer, default=0, comment="排序")
