#!/usr/bin/env python
# encoding: utf-8

# 产品开发计划（独立模块）数据模型，详见 docs/function_docs/52_产品开发计划.md。
# 单表 pdp_doc：整份文档（封面/修订记录/各章节文本/人员-设备-里程碑三张表）以 content(JSON) 存储。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class PdpDoc(Model):
    __tablename__ = "pdp_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
