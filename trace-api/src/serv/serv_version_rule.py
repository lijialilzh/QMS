#!/usr/bin/env python
# encoding: utf-8

# 版本命名规则服务层（全局单条配置），详见 docs/function_docs/55_版本命名规则.md。

import logging
from sqlalchemy import select
from ..model.version_rule import VersionRule
from ..obj import Resp
from ..obj.tobj_version_rule import VersionRuleForm
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db

logger = logging.getLogger(__name__)

# 全局固定单行
ROW_ID = 1

# 默认内容（与原静态页一致，新建时回落）
DEFAULT_VERSION_RULE = {
    "release_format": "VX",
    "full_format": "VX.Y.Z.B",
    "note_top": "注：V 代表 vision，是版本标识符号，其余每一位字母代表一位数字，X 从 1 开始计数，Y、Z、B 从 0 开始计数。",
    "items": [
        {"code": "X", "title": "主版本号 X", "desc": "重构增强类软件更新和重大网络安全更新，比如增加核心功能模块、整体架构发生变化、网络环境改变、数据接口改变、核心算法重大改变。主版本 X 的范围为 1~9。"},
        {"code": "Y", "title": "次版本号 Y", "desc": "轻微增强类软件更新和轻微网络安全更新，比如功能模块局部增强、加密方式改变、训练数据增加算法性能未发生显著性改变、数据通信效率优化、操作系统的安全更新。次版本号 Y 的范围为 0~9。"},
        {"code": "Z", "title": "修订版本号 Z", "desc": "纠正类软件更新和纠正类网络安全更新，修正软件中缺陷和潜在未知缺陷。修订版本号 Z 的范围为 0~9。"},
        {"code": "B", "title": "上市后软件升级数字 B", "desc": "上市后的软件升级迭代次数，0 代表软件第一次发布。上市后软件升级数字 B 的范围为 0~999。"},
    ],
    "note_bottom": "注：版本号中可不含 V（version）。",
}


class Server(object):

    @staticmethod
    def __normalize(content):
        if not isinstance(content, dict):
            return dict(DEFAULT_VERSION_RULE)
        result = {
            "release_format": str(content.get("release_format") or ""),
            "full_format": str(content.get("full_format") or ""),
            "note_top": str(content.get("note_top") or ""),
            "note_bottom": str(content.get("note_bottom") or ""),
        }
        items = content.get("items")
        norm_items = []
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict):
                    norm_items.append({
                        "code": str(it.get("code") or ""),
                        "title": str(it.get("title") or ""),
                        "desc": str(it.get("desc") or ""),
                    })
        result["items"] = norm_items
        return result

    async def get_version_rule(self):
        row: VersionRule = db.session.execute(select(VersionRule).where(VersionRule.id == ROW_ID)).scalars().first()
        content = self.__normalize(row.content) if row and isinstance(row.content, dict) else dict(DEFAULT_VERSION_RULE)
        return Resp.resp_ok(data=VersionRuleForm(content=content))

    async def save_version_rule(self, form: VersionRuleForm):
        try:
            content = self.__normalize(form.content)
            row: VersionRule = db.session.execute(select(VersionRule).where(VersionRule.id == ROW_ID)).scalars().first()
            if row:
                row.content = content
            else:
                row = VersionRule(id=ROW_ID, content=content)
                db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=VersionRuleForm(content=content))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
