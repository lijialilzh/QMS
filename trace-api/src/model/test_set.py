#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, Integer, UniqueConstraint
from . import Model


class TestSet(Model):
    __tablename__ = "test_set"
    product_id = Column(Integer, comment="产品ID")
    stage = Column(String(64), comment="阶段")
    file_no = Column(String(256), nullable=False, default="", comment="文件编号（从上传文件名解析）")
    file_name = Column(String(256), nullable=False, default="", comment="文件名称（从上传文件名解析）")

    __table_args__ = (
        UniqueConstraint("product_id", "file_no", "file_name", name="uq_test_set_product_file"),
    )
