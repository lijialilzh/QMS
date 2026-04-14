from pydantic import Field
from typing import Optional
from datetime import datetime
from .tobj_project import ProjectForm

class ProjectObj(ProjectForm):
    product_count: Optional[int] = Field(title="关联产品数")
    create_time: Optional[datetime] = Field(title="创建时间")
