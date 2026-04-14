#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, SmallInteger, UniqueConstraint
from . import Model

class ProdDhf(Model):
    __tablename__ = "prod_dhf"
    prod_id = Column(Integer, nullable=False, comment="产品ID")
    code = Column(String(64), nullable=False, comment="编号")
    name = Column(String(255), comment="名称")

    __table_args__ = (
        UniqueConstraint("prod_id", "code"),
    )
