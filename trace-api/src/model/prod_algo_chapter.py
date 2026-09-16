#!/usr/bin/env python
# encoding: utf-8

# 章节模块管理（按产品）。结构与算法模块(prod_algo_module)一致，独立表。

from sqlalchemy import Column, Integer, String
from . import Model


class ProdAlgoChapter(Model):
    __tablename__ = "prod_algo_chapter"
    prod_id = Column(Integer, nullable=False, index=True, comment="产品ID")
    name = Column(String(128), comment="模块名称")
    sort_order = Column(Integer, default=0, comment="排序")