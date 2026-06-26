#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from datetime import datetime
from sqlalchemy import orm, Column, DateTime, Integer, String, TEXT

Base = orm.declarative_base()


class Model(Base):
    __abstract__ = True
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    create_time = Column(DateTime, default=datetime.now)
    update_time = Column(DateTime, default=datetime.now)

    def dict(self, include_keys: set= None, exclude_null=True):
        result = dict()
        for col in self.__table__.columns:
            if include_keys and col.name not in include_keys:
                continue
            value = getattr(self, col.name)
            if value is None and exclude_null:
                continue
            result[col.name] = value
        return result


class SessionData(Base):
    __tablename__ = "session"
    key = Column(String(64), unique=True, primary_key=True)
    value = Column(TEXT)
    exp = Column(Integer)
    create_time = Column(DateTime, default=datetime.now)

    uid = Column(Integer, index=True)


# 2.0 独立模块：风险管理。显式导入让 Alembic autogenerate 能发现新表。
from .risk_mgmt_doc import RiskAnalysis, RiskControl, RiskMgmtDoc, RiskParticipant  # noqa: E402,F401

# 2.1 独立模块：网络安全管理。详见 docs/function_docs/47_网络安全管理.md。
from .cybersec_doc import (  # noqa: E402,F401
    CybersecDoc,
    CybersecThreat,
    CybersecControlInternal,
    CybersecControlSbom,
    CybersecControlScan,
)

# CST(总表) 与 RCM(总表) 多对多关联。详见 docs/function_docs/41_网络安全威胁CST管理.md。
from .cst_rcm import CstRcm  # noqa: E402,F401

# 项目人员管理。详见 docs/function_docs/48_项目人员管理.md。
from .project_member import ProjectMember  # noqa: E402,F401

# 项目时间逻辑线。详见 docs/function_docs/49_项目时间逻辑线.md。
from .project_timeline import ProjectTimelineRow, ProjectTimelineCell  # noqa: E402,F401

# 运行环境（按产品）。详见 docs/function_docs/50_运行环境.md。
from .prod_runtime_env import ProdRuntimeEnv  # noqa: E402,F401

# 设备资源（按产品）。详见 docs/function_docs/51_设备资源.md。
from .prod_device_res import ProdDeviceRes  # noqa: E402,F401

# 产品开发计划（独立文档模块）。详见 docs/function_docs/52_产品开发计划.md。
from .pdp_doc import PdpDoc  # noqa: E402,F401

# 产品立项报告（独立文档模块）。详见 docs/function_docs/53_产品立项报告.md。
from .pir_doc import PirDoc  # noqa: E402,F401

# 版本更新历史（独立文档模块）。详见 docs/function_docs/54_版本更新历史.md。
from .vuh_doc import VuhDoc  # noqa: E402,F401

# 版本命名规则（基础数据，全局单条配置）。详见 docs/function_docs/55_版本命名规则.md。
from .version_rule import VersionRule  # noqa: E402,F401

# 产品技术要求（独立文档模块）。详见 docs/function_docs/56_产品技术要求.md。
from .ptr_doc import PtrDoc  # noqa: E402,F401

# 公司基本信息（基础数据）。详见 docs/function_docs/57_公司基本信息.md。
from .company_info import CompanyInfo  # noqa: E402,F401
