#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, SmallInteger
from . import Model


class Rcm(Model):
    __tablename__ = "rcm"
    code = Column(String(64), nullable=False, unique=True, comment="编号")
    description = Column(String(256), comment="描述")
    proof = Column(String(256), comment="体现证据")
    note = Column(String(256), comment="备注")
