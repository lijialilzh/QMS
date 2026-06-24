#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String
from . import Model


class ProjectMember(Model):
    __tablename__ = "project_member"
    prod_id = Column(Integer, nullable=False, index=True, comment="产品ID")
    role = Column(String(64), nullable=False, comment="职能")
    name = Column(String(64), nullable=False, comment="姓名")
    sort_order = Column(Integer, default=0, comment="排序")
    note = Column(String(256), comment="备注")
