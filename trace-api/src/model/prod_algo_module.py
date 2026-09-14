#!/usr/bin/env python
# encoding: utf-8


from sqlalchemy import Column, Integer, String
from . import Model


class ProdAlgoModule(Model):
    __tablename__ = "prod_algo_module"
    prod_id = Column(Integer, nullable=False, index=True, comment="产品ID")
    name = Column(String(128), comment="模块名称")
    sort_order = Column(Integer, default=0, comment="排序")
