#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String
from . import Model


class Cst(Model):
    __tablename__ = "cst"
    code = Column(String(64), nullable=False, unique=True, comment="编号")
    category = Column(String(64), comment="分类")
    module = Column(String(256), comment="模块")
    connection = Column(String(256), comment="通信方式")
    description = Column(String(256), comment="描述")
    harm = Column(String(256), comment="危害后果")
