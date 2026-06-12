#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field


class CstForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    code: Optional[str] = Field(title="编号")
    category: Optional[str] = Field(title="分类")
    module: Optional[str] = Field(title="模块")
    connection: Optional[str] = Field(title="通信方式")
    description: Optional[str] = Field(title="描述")
    harm: Optional[str] = Field(title="危害后果")


# CST 总表保存表单：携带关联 RCM 主表的 id 列表（独立于 CstForm，避免影响 prod_cst 等继承方）
class CstSaveForm(CstForm):
    rcm_ids: Optional[list[int]] = Field(default=None, title="关联RCM ID列表")
