#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field

class LoginForm(BaseModel):
    name: Optional[str] = Field(title="账号")
    pwd: Optional[str] = Field(title="密码")

class UserForm(BaseModel):
    id: Optional[int] = Field(title="用户ID")
    name: Optional[str] = Field(title="账号")
    pwd: Optional[str] = Field(title="密码")
    nick_name: Optional[str] = Field(title="用户姓名")
    role_code: Optional[str] = Field(title="角色编码")
    pwd_new1: Optional[str] = Field(title="新密码")
    pwd_new2: Optional[str] = Field(title="新密码")

class PwdForm(BaseModel):
    pwd: Optional[str] = Field(title="密码")
    pwd_new1: Optional[str] = Field(title="新密码1")
    pwd_new2: Optional[str] = Field(title="新密码2")
