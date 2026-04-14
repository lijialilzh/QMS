#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, Float, String, UniqueConstraint
from . import Model


class ProdCst(Model):
    __tablename__ = "prod_cst"
    prod_id = Column(Integer, comment="产品ID")
    cst_id = Column(Integer, comment="危害ID")

    prev_score = Column(Float, comment="分数")
    prev_severity = Column(Float, comment="严重性")
    prev_level = Column(Float, comment="等级")
    prev_accept = Column(String, comment="接受度")

    cur_score = Column(Float, comment="分数")
    cur_severity = Column(Float, comment="严重性")
    cur_level = Column(Float, comment="等级")
    cur_accept = Column(String, comment="接受度")

    rcm_codes = Column(String, comment="建议操作")

    __table_args__ = (
        UniqueConstraint("prod_id", "cst_id"),
    )
