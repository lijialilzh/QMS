#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, Integer, TEXT
from . import Model


class TestCase(Model):
    __tablename__ = "test_case"
    set_id = Column(Integer, comment="测试集ID")

    code = Column(String(64), comment="用例编号")
    srs_code = Column(String(64), comment="需求编号")
    test_type = Column(String(64), comment="测试类型")
    function = Column(TEXT, comment="功能点")
    description = Column(TEXT, comment="描述")
    precondition = Column(TEXT, comment="前置条件")
    test_step = Column(TEXT, comment="测试步骤")
    expect = Column(TEXT, comment="预期结果")
    note = Column(TEXT, comment="备注")
