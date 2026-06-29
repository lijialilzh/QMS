#!/usr/bin/env python
# encoding: utf-8

# 自研软件研究报告（独立文档模块）数据模型。
# 单表 research_doc：整份文档（封面/各章节文本/表格/图片/自动获取标记）以 content(JSON) 存储。
# 自动获取章节通过 content 节点的 ref_type / img_category 标记，在 get/export 时由服务层注入产品数据，不落库覆盖手工章节。

from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint
from . import Model


class ResearchDoc(Model):
    __tablename__ = "research_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )
