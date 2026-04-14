#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, TEXT
from . import Model

class SrsReqd(Model):
    __tablename__ = "srs_reqd"
    name = Column(String(256), comment="需求名称")
    req_id = Column(Integer, nullable=False, unique=True, comment="需求ID")
    overview = Column(TEXT, comment="需求概述")
    participant = Column(String(256), comment="参与人")
    pre_condition = Column(TEXT, comment="前置条件")
    trigger = Column(TEXT, comment="触发条件")
    work_flow = Column(TEXT, comment="工作流程")
    post_condition = Column(TEXT, comment="后置条件")
    exception = Column(TEXT, comment="异常情况")
    constraint = Column(TEXT, comment="约束")
