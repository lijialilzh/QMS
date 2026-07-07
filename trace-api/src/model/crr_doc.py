#!/usr/bin/env python
# encoding: utf-8

# 代码审查记录（独立文档模块，开发文件，编号形如 TX-TF-RUS-SD-007）。
# 单表 crr_doc：整份文档（代码地址/检查日期/被审核人/审核人/审核依据/检查表/结论/审核签字）以 content(JSON) 存储。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class CrrDoc(Model):
    __tablename__ = "crr_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
