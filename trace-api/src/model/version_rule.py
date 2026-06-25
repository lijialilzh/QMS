#!/usr/bin/env python
# encoding: utf-8

# 版本命名规则（基础数据，全局单条配置）数据模型，详见 docs/function_docs/55_版本命名规则.md。
# 全局共享，固定单行（id=1），可编辑文字内容以 content(JSON) 存储。

from sqlalchemy import Column, JSON
from . import Model


class VersionRule(Model):
    __tablename__ = "version_rule"
    content = Column(JSON, comment="版本命名规则内容")
