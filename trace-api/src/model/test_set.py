#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, Integer, UniqueConstraint
from . import Model


class TestSet(Model):
    __tablename__ = "test_set"
    product_id = Column(Integer, comment="产品ID")
    stage = Column(String(64), comment="阶段")

    __table_args__ = (
        UniqueConstraint("product_id", "stage"),
    )
