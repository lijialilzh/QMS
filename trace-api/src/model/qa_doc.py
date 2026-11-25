#!/usr/bin/env python
# encoding: utf-8

# 质量文件。详见 docs/function_docs/105_质量文件管理.md。
# 四个菜单共用本表，kind 区分文档类型。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class QaDoc(Model):
    __tablename__ = "qa_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    kind = Column(String(32), nullable=False, comment="文档类型")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "kind", "version"),
    )
