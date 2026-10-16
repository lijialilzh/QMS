#!/usr/bin/env python
# encoding: utf-8

from datetime import datetime
from typing import Optional, List
from pydantic import Field
from .tobj_utp_record_doc import UtpRecordDocForm


class UtpRecordDocObj(UtpRecordDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_full_version: Optional[str] = Field(title="完整版本")
    product_type_code: Optional[str] = Field(title="产品型号")
    create_time: Optional[datetime] = Field(title="创建时间")
    # 导出展开预览：型号列表、用户测试人员
    model_names: Optional[List[str]] = Field(default=None, title="用例型号(sheet)")
    tester_names: Optional[List[str]] = Field(default=None, title="用户测试人员")
