#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, SmallInteger, TEXT
from . import Model


class Haz(Model):
    __tablename__ = "haz"
    code = Column(String(64), nullable=False, unique=True, comment="编号")
    source = Column(String(256), comment="来源")
    event = Column(String(256), comment="事件")
    situation = Column(String(256), comment="情况")
    damage = Column(String(256), comment="伤害")

    init_rate = Column(SmallInteger, comment="初始风险概率")
    init_degree = Column(String(64), comment="初始危害程度")
    init_level = Column(String(64), comment="初始风险水平")

    deal = Column(TEXT, comment="处置")
    rcms = Column(String(1024), comment="RCMS")
    evidence = Column(String(256), comment="证据")

    cur_rate = Column(SmallInteger, comment="剩余风险概率")
    cur_degree = Column(String(64), comment="剩余危害程度")
    cur_level = Column(String(64), comment="剩余风险水平")

    benefit_flag = Column(SmallInteger, comment="效益标志")
    category = Column(String(64), comment="分类")
    