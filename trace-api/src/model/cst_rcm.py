#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, UniqueConstraint
from . import Model


class CstRcm(Model):
    __tablename__ = "cst_rcm"
    cst_id = Column(Integer, index=True, comment="CST ID")
    rcm_id = Column(Integer, index=True, comment="RCM ID")

    __table_args__ = (
        UniqueConstraint("cst_id", "rcm_id"),
    )
