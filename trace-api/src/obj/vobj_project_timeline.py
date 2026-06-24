from pydantic import Field
from typing import Optional
from .tobj_project_timeline import TimelineRowForm


class TimelineRowObj(TimelineRowForm):
    # 部门 -> 输出结果 的映射（透视后的单元格）
    cells: Optional[dict] = Field(default_factory=dict, title="部门单元格")
