#!/usr/bin/env python
# encoding: utf-8

from sqlalchemy import Column, Integer, String, JSON, SmallInteger, TEXT, UniqueConstraint
from . import Model


class RiskMgmtDoc(Model):
    __tablename__ = "risk_mgmt_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )


class RiskAnalysis(Model):
    __tablename__ = "risk_analysis"
    doc_id = Column(Integer, nullable=False, comment="风险管理报告ID")
    product_id = Column(Integer, nullable=False, comment="产品ID")
    haz_code = Column(String(64), nullable=False, comment="HAZ编号")
    source = Column(String(256), comment="危险源")
    event_sequence = Column(TEXT, comment="事件序列")
    hazard_situation = Column(TEXT, comment="危险情况")
    harm = Column(TEXT, comment="伤害")
    init_rate = Column(SmallInteger, comment="初始风险概率")
    init_degree = Column(String(64), comment="初始危害程度")
    init_level = Column(String(64), comment="初始风险水平")
    control_measures = Column(TEXT, comment="风险控制措施")
    rcm_codes = Column(String(1024), comment="RCM ID")
    verification_evidence = Column(TEXT, comment="验证证据")
    residual_rate = Column(SmallInteger, comment="剩余风险概率")
    residual_degree = Column(String(64), comment="剩余危害程度")
    residual_level = Column(String(64), comment="剩余风险水平")
    benefit_flag = Column(SmallInteger, comment="收益是否大于风险")
    category = Column(String(128), comment="分类")

    __table_args__ = (
        UniqueConstraint("doc_id", "haz_code"),
    )


class RiskControl(Model):
    __tablename__ = "risk_control"
    doc_id = Column(Integer, nullable=False, comment="风险管理报告ID")
    product_id = Column(Integer, nullable=False, comment="产品ID")
    rcm_code = Column(String(64), nullable=False, comment="RCM编号")
    description = Column(TEXT, comment="控制措施描述")
    hazard_codes = Column(String(1024), comment="关联HAZ编号")
    verification_evidence = Column(TEXT, comment="验证证据")
    new_risk_flag = Column(SmallInteger, comment="是否引入新风险")
    note = Column(TEXT, comment="备注")

    __table_args__ = (
        UniqueConstraint("doc_id", "rcm_code"),
    )
