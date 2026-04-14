#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String
from . import Model


class Project(Model):
    __tablename__ = "project"
    name = Column(String(64), unique=True, comment="用户账户")
    country = Column(String(64), comment="国家")
    note = Column(String(256), comment="备注")
