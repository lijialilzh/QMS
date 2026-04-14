#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field

class LogicForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    txt: Optional[str] = Field(title="逻辑文本")
    filename: Optional[str] = Field(title="逻辑图文件名")
    img_url: Optional[str] = Field(title="逻辑图")

    
class SdsReqdForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    req_id: Optional[int] = Field(title="需求ID")
    doc_id: Optional[int] = Field(title="设计文档ID")
    overview: Optional[str] = Field(title="需求概述")
    func_detail: Optional[str] = Field(title="功能")
    logic_txt: Optional[str] = Field(title="逻辑文本")
    intput: Optional[str] = Field(title="输入")
    output: Optional[str] = Field(title="输出")
    interface: Optional[str] = Field(title="接口")
    