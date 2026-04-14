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
    