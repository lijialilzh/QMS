#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, UniqueConstraint, TEXT
from . import Model

class Logic(Model):
    __tablename__ = "logic"
    reqd_id = Column(Integer, nullable=False, comment="需求ID")
    txt = Column(TEXT, comment="逻辑文本")
    filename = Column(String(256), comment="逻辑图文件名")
    img_url = Column(String(256), comment="逻辑图")

class SdsReqd(Model):
    __tablename__ = "sds_reqd"
    req_id = Column(Integer, nullable=False, comment="需求ID")
    doc_id = Column(Integer, nullable=False, comment="文档ID")
    overview = Column(TEXT, comment="需求概述")
    func_detail = Column(TEXT, comment="功能")
    logic_txt = Column(TEXT, comment="逻辑文本")
    intput = Column(TEXT, comment="输入")
    output = Column(TEXT, comment="输出")
    interface = Column(TEXT, comment="接口")

    __table_args__ = (
        UniqueConstraint("doc_id", "req_id"),
    )