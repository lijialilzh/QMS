#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Boolean, Column, Integer, String, UniqueConstraint
from . import Model

class SdsTrace(Model):
    __tablename__ = "sds_trace"
    req_id = Column(Integer, nullable=False, comment="需求ID")
    doc_id = Column(Integer, nullable=False, comment="文档ID")
    sds_code = Column(String(256), comment="设计编号")
    chapter = Column(String(256), comment="章节")
    location = Column(String(256), comment="位置")
    # 设计编号已手改：刷新/打开/导出一律保留库里的值，只有「获取SRS追溯」才清标记重取。
    design_manual = Column(Boolean, default=False, comment="设计编号已手改")

    __table_args__ = (
        UniqueConstraint("doc_id", "req_id"),
    )
