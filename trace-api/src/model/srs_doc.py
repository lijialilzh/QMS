#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, JSON, TEXT, UniqueConstraint
from . import Model

class SrsDoc(Model):
    __tablename__ = "srs_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="版本号")
    folder_name = Column(String(128), comment="文件夹名称")
    file_no = Column(String(64), comment="文件编号")
    change_log = Column(String(256), comment="版本变更说明")
    n_id = Column(Integer, nullable=False, default=0, comment="最大节点ID")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )

class SrsNode(Model):
    __tablename__ = "srs_node"
    doc_id = Column(Integer, nullable=False, comment="文档ID")
    n_id = Column(Integer, nullable=False, comment="节点ID")
    p_id = Column(Integer, nullable=False, comment="父节点ID")
    priority = Column(Integer, nullable=False, default=0, comment="节点顺序")

    title = Column(String(256), comment="节点标题")
    label = Column(TEXT, comment="节点标签")
    srs_code = Column(String(64), comment="需求编号")
    rcm_codes = Column(String(1024), comment="RCM编码")
    text = Column(TEXT, comment="节点文本")

    ref_type = Column(String(64), comment="引用类型")

    img_url = Column(TEXT, comment="图片URL")
    table = Column(JSON, comment="表格")
    
    __table_args__ = (
        UniqueConstraint("doc_id", "n_id"),
    )
    