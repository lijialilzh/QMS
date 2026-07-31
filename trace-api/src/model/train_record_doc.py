#!/usr/bin/env python
# encoding: utf-8

# 培训记录表数据模型（测试文件）。
# 单表 train_record_doc：整份文档以 content(JSON) 存储（一张大表格）。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class TrainRecordDoc(Model):
    __tablename__ = "train_record_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )