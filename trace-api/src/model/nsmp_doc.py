#!/usr/bin/env python
# encoding: utf-8

# 网络安全维护计划（独立文档模块）数据模型。
# 单表 nsmp_doc：整份文档以 content(JSON) 的「章节树」存储。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class NsmpDoc(Model):
    __tablename__ = "nsmp_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
