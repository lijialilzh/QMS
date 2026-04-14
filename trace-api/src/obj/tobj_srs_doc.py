#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from .node import Node

class TabHeader(BaseModel):
    code: str = Field(title="列名编码")
    name: Optional[str] = Field(title="列名")


class TableCell(BaseModel):
    value: Optional[str] = Field(title="单元格内容")
    row_span: Optional[int] = Field(title="行合并跨度", default=1)
    col_span: Optional[int] = Field(title="列合并跨度", default=1)
    h_align: Optional[str] = Field(title="水平对齐", default="left")
    v_align: Optional[str] = Field(title="垂直对齐", default="top")


class Table(BaseModel):
    name: Optional[str] = Field(title="表格名称")
    show_header: Optional[int] = Field(title="是否显示表头", default=1)
    headers: Optional[List[TabHeader]] = Field(title="表头")
    rows: Optional[List[Dict[str, Any]]] = Field(title="表格行数据")
    cells: Optional[List[List[TableCell]]] = Field(title="二维单元格（含合并信息）")
    

class SrsNodeForm(Node):
    label: Optional[str] = Field(title="节点小标题")
    rcm_codes: Optional[List[str]] = Field(title="RCM ID")
    srs_code: Optional[str] = Field(title="需求编号")
    ref_type: Optional[str] = Field(title="引用类型: img_struct, img_flow, img_topo, srs_reqs_1, srs_reqs_2, srs_reqds")
    img_url: Optional[str] = Field(title="图片URL")
    text: Optional[str] = Field(title="节点文本")
    table: Optional[Table] = Field(title="表格")
    children: Optional[List[SrsNodeForm]] = Field(title="子节点")


class SrsDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    version: Optional[str] = Field(title="版本号")
    folder_name: Optional[str] = Field(title="文件夹名称")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="版本变更说明")
    content: Optional[List[SrsNodeForm]] = Field(title="文档树")
    n_id: Optional[int] = Field(title="最大节点ID")
