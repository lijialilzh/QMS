#!/usr/bin/env python
# encoding: utf-8

# 测试环境维护记录（独立文档模块，测试文件，编号形如 TX-TF-RUS-SD-XXX）。
# 单表 tem_doc：说明正文/资产表/各资产周检查表 以 content(JSON) 存储。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class TemDoc(Model):
    __tablename__ = "tem_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )