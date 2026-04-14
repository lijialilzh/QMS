from __future__ import annotations
from pydantic import Field
from typing import Optional
from datetime import datetime
from .tobj_role import PermForm, RoleForm

class PermObj(PermForm):
    children: Optional[list[PermObj]] = Field(title="子权限")

class RoleObj(RoleForm):
    perm_tree: Optional[list[PermObj]] = Field(title="权限树")
    all_perms: Optional[list[str]] = Field(title="权限列表")
    fixed_base_perms: Optional[list[str]] = Field(title="固定基线权限")
    user_count: Optional[int] = Field(title="关联用户数")
    create_time: Optional[datetime] = Field(title="创建时间")
