#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, SmallInteger, UniqueConstraint
from . import Model

class SrsReq(Model):
    __tablename__ = "srs_req"
    doc_id = Column(Integer, nullable=False, comment="需求文档ID")
    code = Column(String(64), nullable=False, comment="需求编号")
    module = Column(String(256), comment="模块")
    function = Column(String(256), comment="功能")
    sub_function = Column(String(256), comment="子功能")

    location = Column(String(256), comment="位置")
    type_code = Column(String(64), nullable=False, default="1", comment="需求类型")

    __table_args__ = (
        UniqueConstraint("doc_id", "type_code", "code"),
    )


class ReqRcm(Model):
    __tablename__ = "req_rcm"
    req_id = Column(Integer, nullable=False, comment="需求ID")
    rcm_id = Column(Integer, nullable=False, comment="RCMID")
    __table_args__ = (
        UniqueConstraint("req_id", "rcm_id"),
    )
    