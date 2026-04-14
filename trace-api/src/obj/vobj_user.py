#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from datetime import datetime
from typing import Optional, List
from pydantic import Field
from .tobj_user import UserForm

class UserObj(UserForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    role_code: Optional[str] = Field(title="角色编码")
    role_name: Optional[str] = Field(title="角色名称")
    role_perms: Optional[List[str]] = Field(title="权限列表")
