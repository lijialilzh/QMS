#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, UniqueConstraint
from . import Model


class ProdRcm(Model):
    __tablename__ = "prod_rcm"
    prod_id = Column(Integer, comment="产品ID")
    rcm_id = Column(Integer, comment="危害ID")
    __table_args__ = (
        UniqueConstraint("prod_id", "rcm_id"),
    )
