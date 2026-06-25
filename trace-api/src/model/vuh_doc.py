#!/usr/bin/env python
# encoding: utf-8

# 版本更新历史（独立文档模块）数据模型，详见 docs/function_docs/54_版本更新历史.md。
# 单表 vuh_doc：整份文档（封面/修订记录/各章节文本/更新历史表）以 content(JSON) 存储。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class VuhDoc(Model):
    __tablename__ = "vuh_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
