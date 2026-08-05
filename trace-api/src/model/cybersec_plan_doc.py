#!/usr/bin/env python
# encoding: utf-8

# 网络安全风险管理计划数据模型，单表存储（content JSON）。
# 与网络安全风险管理报告（cybersec_doc）独立并行——本模块是计划阶段文档。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class CybersecPlanDoc(Model):
    __tablename__ = "cybersec_plan_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
