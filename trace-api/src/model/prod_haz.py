#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, SmallInteger, String, UniqueConstraint, TEXT
from . import Model


class ProdHaz(Model):
    __tablename__ = "prod_haz"
    prod_id = Column(Integer, comment="产品ID")
    haz_id = Column(Integer, comment="危害ID")

    situation = Column(String(256), comment="发生情况")
    damage = Column(String(256), comment="伤害")
    deal = Column(TEXT, comment="处置")

    init_rate = Column(SmallInteger, comment="初始风险概率")
    init_degree = Column(String(64), comment="初始危害程度")
    init_level = Column(String(64), comment="初始风险水平")

    cur_rate = Column(SmallInteger, comment="初始风险概率")
    cur_degree = Column(String(64), comment="初始危害程度")
    cur_level = Column(String(64), comment="初始风险水平")

    rcms = Column(String(1024), comment="RCMS")
    evidence = Column(String(256), comment="证据")

    __table_args__ = (
        UniqueConstraint("prod_id", "haz_id"),
    )
