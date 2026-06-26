#!/usr/bin/env python
# encoding: utf-8

# 版本命名规则接口层（全局单条配置），详见 docs/function_docs/55_版本命名规则.md。

from typing import Any
from fastapi import APIRouter

from ..obj import Resp
from ..obj.tobj_role import Perms
from ..obj.tobj_version_rule import VersionRuleForm
from ..serv.serv_version_rule import Server
from . import try_log

router = APIRouter()
server = Server()


@router.get("/get_version_rule", summary="查询版本命名规则", response_model=Resp[VersionRuleForm])
@try_log()
async def get_version_rule():
    return await server.get_version_rule()


@router.post("/save_version_rule", summary="保存版本命名规则", response_model=Resp[VersionRuleForm])
@try_log(perm=Perms.version_rule_edit)
async def save_version_rule(form: VersionRuleForm):
    return await server.save_version_rule(form)
