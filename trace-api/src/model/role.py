#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, UniqueConstraint, Integer
from . import Model


class Perm(Model):
    __tablename__ = "perm"
    code = Column(String(64), nullable=False, unique=True, comment="权限编码")
    p_code = Column(String(64), nullable=False, default="", comment="父权限编码")
    priority = Column(Integer, default=0, comment="权限优先级")
    name = Column(String(64), comment="权限名")


class Role(Model):
    __tablename__ = "role"
    code = Column(String(64), nullable=False, unique=True, comment="角色编码")
    name = Column(String(128), nullable=False, unique=True, comment="角色名称")


class RolePerm(Model):
    __tablename__ = "role_perm"
    role_code = Column(String(64), nullable=False, comment="角色编码")
    perm_code = Column(String(64), nullable=False, comment="权限编码")

    __table_args__ = (
        UniqueConstraint("role_code", "perm_code"),
    )
