#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, Integer
from . import Model


class DocFile(Model):
    __tablename__ = "doc_file"
    product_id = Column(Integer, comment="产品ID")
    category = Column(String(64), comment="类型")

    file_name = Column(String(256), comment="文件名")
    file_size = Column(Integer, comment="文件大小")
    file_url = Column(String(256), comment="文件URL")
    