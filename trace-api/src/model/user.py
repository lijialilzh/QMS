#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String
from . import Model


class User(Model):
    __tablename__ = "usr"
    name = Column(String(64), unique=True, comment="用户账户")
    pwd = Column(String(64), comment="密码")
    pwd_sk = Column(String(64), comment="密码盐")
    nick_name = Column(String(64), comment="姓名")
    role_code = Column(String(64), comment="角色编码")
