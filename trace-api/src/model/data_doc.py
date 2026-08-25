#!/usr/bin/env python
# encoding: utf-8

# 数据文件（独立文档模块）数据模型，详见 docs/function_docs/100_数据文件管理.md。
# 单表 data_doc：以 doc_type 区分 Word/Excel；整份文档以 content(JSON) 目录树存储。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class DataDoc(Model):
    __tablename__ = "data_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    doc_type = Column(String(32), nullable=False, comment="文档类型")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "doc_type", "version"),
    )
