#!/usr/bin/env python
# encoding: utf-8


from sqlalchemy import Column, Integer, String, Text
from . import Model


class Ecr(Model):
    __tablename__ = "ecr"
    ecr_no = Column(String(32), nullable=False, default="", comment="ECR编号")
    product_name = Column(Text, nullable=False, default="", comment="变更后产品名称")
    version = Column(String(64), nullable=False, default="", comment="变更后版本号")
    apply_date = Column(String(32), nullable=False, default="", comment="编号申请日期")
    applicant = Column(String(64), nullable=False, default="", comment="申请人")
    content = Column(Text, nullable=False, default="", comment="变更申请内容")
    note = Column(Text, nullable=False, default="", comment="备注")
    sort_order = Column(Integer, default=0, comment="排序")
