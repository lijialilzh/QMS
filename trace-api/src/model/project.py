#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, UniqueConstraint
from . import Model


class Project(Model):
    __tablename__ = "project"
    __table_args__ = (UniqueConstraint("name", "country", name="project_name_country_key"),)
    name = Column(String(64), comment="用户账户")
    country = Column(String(64), comment="国家")
    note = Column(String(256), comment="备注")
