#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, UniqueConstraint
from . import Model

class SrsType(Model):
    __tablename__ = "srs_type"
    doc_id = Column(Integer, nullable=False, comment="需求文档ID")
    type_code = Column(String(64), nullable=False, comment="类型编号")
    type_name = Column(String(64), nullable=False, comment="类型名称")

    __table_args__ = (
        UniqueConstraint("doc_id", "type_code"),
    )
    