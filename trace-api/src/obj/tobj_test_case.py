#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field


class TestCaseForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    set_id: Optional[int] = Field(title="测试集ID")
    code: Optional[str] = Field(title="用例编号")
    srs_code: Optional[str] = Field(title="需求编号")
    test_type: Optional[str] = Field(title="测试类型")
    function: Optional[str] = Field(title="功能点")
    description: Optional[str] = Field(title="描述")
    precondition: Optional[str] = Field(title="前置条件")
    test_step: Optional[str] = Field(title="测试步骤")
    expect: Optional[str] = Field(title="预期结果")
    note: Optional[str] = Field(title="备注")
