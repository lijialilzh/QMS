#!/usr/bin/env python
# encoding: utf-8

# 公司基本信息（基础数据）。详见 docs/function_docs/57_公司基本信息.md。

from sqlalchemy import Column, String
from . import Model


class CompanyInfo(Model):
    __tablename__ = "company_info"
    registrant = Column(String(128), nullable=False, comment="注册人")
    address = Column(String(256), comment="住所")
    manufacturer = Column(String(128), comment="受托生产企业")
    production_address = Column(String(256), comment="生产地址")
    production_license_no = Column(String(128), comment="生产许可证编号")
    contact_phone = Column(String(64), comment="联系电话")
