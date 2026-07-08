#!/usr/bin/env python
# encoding: utf-8

# Bug管理及回归测试（测试文件）：上传原始 xlsx 只读存档 + 解析缺陷统计。
# 原始文件存 file_data(二进制)，缺陷统计存 stats(JSON)，供软件测试报告缺陷统计分析引用。

from sqlalchemy import Column, Integer, String, JSON, LargeBinary, UniqueConstraint
from . import Model


class BugDoc(Model):
    __tablename__ = "bug_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    file_name = Column(String(256), comment="原始文件名")
    file_path = Column(String(512), comment="原始文件磁盘路径")
    file_data = Column(LargeBinary, comment="原始文件二进制(旧数据兼容)")
    stats = Column(JSON, comment="缺陷统计")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
