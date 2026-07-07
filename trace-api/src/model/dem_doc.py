#!/usr/bin/env python
# encoding: utf-8

# 开发环境维护说明（独立文档模块，开发文件，编号形如 TX-TF-RUS-SD-006）。
# 单表 dem_doc：说明正文/资产表/各资产周检查表 以 content(JSON) 存储。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class DemDoc(Model):
    __tablename__ = "dem_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
