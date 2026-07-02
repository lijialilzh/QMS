#!/usr/bin/env python
# encoding: utf-8

# 风险管理计划（独立文档模块）数据模型。
# 单表 rmp_doc：整份文档以 content(JSON) 的「章节树」存储；产品信息自动获取，其余模板化。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class RmpDoc(Model):
    __tablename__ = "rmp_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
