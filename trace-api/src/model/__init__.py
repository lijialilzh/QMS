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
