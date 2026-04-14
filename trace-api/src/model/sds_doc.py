#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, JSON, UniqueConstraint, TEXT
from . import Model

class SdsDoc(Model):
    __tablename__ = "sds_doc"
    srsdoc_id = Column(Integer, nullable=False, default=0, comment="SRS_DOC_ID")
    version = Column(String(64), nullable=False, comment="版本号")
    file_no = Column(String(64), comment="文件编号")
    change_log = Column(String(256), comment="版本变更说明")
    n_id = Column(Integer, nullable=False, default=0, comment="最大节点ID")

    __table_args__ = (
        UniqueConstraint("srsdoc_id", "version"),
    )

class SdsNode(Model):
    __tablename__ = "sds_node"
    doc_id = Column(Integer, nullable=False, comment="文档ID")
    n_id = Column(Integer, nullable=False, comment="节点ID")
    p_id = Column(Integer, nullable=False, comment="父节点ID")
    priority = Column(Integer, nullable=False, comment="节点顺序")

    sds_code = Column(String(256), comment="设计编号")
    ref_type = Column(String(64), comment="引用类型")

    title = Column(String(256), comment="节点标题")
    label = Column(TEXT, comment="节点标签")
    img_url = Column(String(256), comment="图片URL")
    text = Column(TEXT, comment="节点文本")
    table = Column(JSON, comment="表格")
    
    __table_args__ = (
        UniqueConstraint("doc_id", "n_id"),
    )
    