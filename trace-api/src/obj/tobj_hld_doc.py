#!/usr/bin/env python
# encoding: utf-8

from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field
from .node import Node
from .tobj_srs_doc import Table


class HldNodeForm(Node):
    ref_type: Optional[str] = Field(title="引用类型: img_struct, img_flow, img_topo")
    label: Optional[str] = Field(title="节点小标题")
    img_url: Optional[str] = Field(title="图片URL")
    text: Optional[str] = Field(title="节点文本")
    table: Optional[Table] = Field(title="表格")
    children: Optional[List[HldNodeForm]] = Field(title="子节点")


class HldDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    version: Optional[str] = Field(title="版本号")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="版本变更说明")
    content: Optional[List[HldNodeForm]] = Field(title="文档树")
    n_id: Optional[int] = Field(title="最大节点ID")
