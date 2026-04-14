#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

import json
import logging
from sqlalchemy import func, select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from typing import Optional, Any
from starlette_session.interfaces import ISessionBackend
from ..utils import DefaultEncoder
from ..model import SessionData
from ..utils.sql_ctx import db
from . import SESSION_KEY

logger = logging.getLogger(__name__)



class DbBackend(ISessionBackend):

    async def get(self, key: str, *args, **kwargs: dict) -> Optional[dict]:
        sql = select(SessionData).where(SessionData.key == key)
        session_data: SessionData = db.session.execute(sql).scalars().first()
        return json.loads(session_data.value) if session_data else {}

    async def set(self, key: str, value: dict, exp: Optional[int], *args, **kwargs: dict) -> Optional[str]:
        uid = value.get(SESSION_KEY) or 0
        sql = select(func.count(SessionData.key)).where(SessionData.key == key)
        session_num: int = db.session.execute(sql).scalars().first()
        jvalue = json.dumps(value, cls=DefaultEncoder, ensure_ascii=False)
        logger.info("session: %s %s", session_num, jvalue)

        sql = pg_insert(SessionData).values(dict(key=key, value=jvalue, exp=exp, uid=uid))
        update_dict = dict(value=jvalue, uid=uid) if uid else dict(value=jvalue)
        sql = sql.on_conflict_do_update(set_=update_dict, index_elements=["key"])
        db.session.execute(sql)
        db.session.commit()

    async def delete(self, key: str, *args, **kwargs: dict) -> Any:
        sql = delete(SessionData).where(SessionData.key == key)
        db.session.execute(sql)
        db.session.commit()
