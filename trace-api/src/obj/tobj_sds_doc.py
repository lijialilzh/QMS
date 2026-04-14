#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from __future__ import annotations
from typing import List, Optional
from .tobj_srs_doc import Table
from pydantic import BaseModel, Field
from .node import Node


class SdsNodeForm(Node):
    sds_code: Optional[str] = Field(title="设计编号")
    ref_type: Optional[str] = Field(title="引用类型: img_struct, img_flow, img_topo, sds_traces")
    label: Optional[str] = Field(title="节点小标题")
    img_url: Optional[str] = Field(title="图片URL")
    text: Optional[str] = Field(title="节点文本")
    table: Optional[Table] = Field(title="表格")
    children: Optional[List[SdsNodeForm]] = Field(title="子节点")


class SdsDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    srsdoc_id: Optional[int] = Field(title="SRS文档ID")
    version: Optional[str] = Field(title="版本号")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="版本变更说明")
    content: Optional[List[SdsNodeForm]] = Field(title="文档树")
    n_id: Optional[int] = Field(title="最大节点ID")
