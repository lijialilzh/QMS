#!/usr/bin/env python
# encoding: utf-8

# 用户测试记录数据模型（测试文件 PD-010-QR-02）。
# 单表 utp_record_doc：整份主文档以 content(JSON) 存储（一张大表格）；
# 导出时按 型号×用户测试人员 展开为多份 docx 打 zip。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class UtpRecordDoc(Model):
    __tablename__ = "utp_record_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
