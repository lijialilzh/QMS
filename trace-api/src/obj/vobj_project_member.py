from pydantic import Field
from typing import Optional
from datetime import datetime
from .tobj_project_member import ProjectMemberForm


class ProjectMemberObj(ProjectMemberForm):
    create_time: Optional[datetime] = Field(title="创建时间")
