#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String
from . import Model


class ProdHospital(Model):
    __tablename__ = "prod_hospital"
    prod_id = Column(Integer, nullable=False, index=True, comment="产品ID")
    contract_no = Column(String(64), comment="合同编号")
    org_name = Column(String(256), comment="对方单位名称")
    hospital_no = Column(String(64), comment="医院编号")
    region = Column(String(32), comment="区域")
    sort_order = Column(Integer, default=0, comment="排序")
