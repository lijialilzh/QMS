#!/usr/bin/env python
# encoding: utf-8

# 网络安全能力分析（MDS2，独立文档模块）数据模型。
# 单表 cyber_cap_doc：可编辑的问答/备注以 content(JSON: {"cells": {坐标: 值}}) 存储；
# 产品相关字段（公司信息/预期用途/运行环境/型号/版本/文件号/日期）导出时自动填充至 xlsx 模板。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class CyberCapDoc(Model):
    __tablename__ = "cyber_cap_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容(单元格覆盖)")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
