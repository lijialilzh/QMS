#!/usr/bin/env python
# encoding: utf-8

# 单元/集成/系统测试记录：一份主文档 content(JSON) 存表头与按 Case 的结果；
# 用例正文导出时从 test_case 现取。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class DevTestRecordDoc(Model):
    __tablename__ = "dev_test_record_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    stage = Column(String(32), nullable=False, comment="单元测试/集成测试/系统测试")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="表头+results")

    __table_args__ = (
        UniqueConstraint("product_id", "stage", "version"),
    )
