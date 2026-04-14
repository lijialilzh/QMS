from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field

class Node(BaseModel):
    doc_id: Optional[int] = Field(title="文档ID")
    n_id: Optional[int] = Field(title="节点ID")
    p_id: Optional[int] = Field(title="父节点ID")

    ref_id: Optional[int] = Field(title="引用ID")

    level: Optional[int] = Field(title="节点层级")
    priority: Optional[str] = Field(title="优先级")

    title: Optional[str] = Field(title="节点标题")
    with_chapter: Optional[int] = Field(title="是否包含章节号")
    children: Optional[List[Node]] = Field(title="子节点")
