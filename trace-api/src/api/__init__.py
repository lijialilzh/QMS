#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import logging
import math
import time
from typing import List, Union
from fastapi import Request
from contextvars import ContextVar
from functools import wraps

from ..obj.tobj_role import Perms
from ..obj.vobj_user import UserObj
from ..obj import Resp
from ..utils.i18n import ts

logger = logging.getLogger(__name__)

SESSION_KEY = "user"


# 写操作角色。root 与用户 id=1 在校验里始终放行。
ROLES_BASE_WRITE = ["root", "dqa"]
ROLES_ALGO_WRITE = ["root", "dqa", "model_staff", "data_staff"]
ROLES_VERSION_WRITE = ["root", "dqa", "product_manager"]
ROLES_RISK_WRITE = ["root", "dqa", "product_manager"]
ROLES_THREAT_WRITE = ["root", "dqa"]


def try_log(error_resp=Resp.resp_fatal(), perm: Union[Perms, List[Perms]] = None, roles: List[str] = None):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            timer = time.time()
            request: Request = CtxRequest.get()
            try:
                user = CtxUser.get()
                role = str(getattr(user, "role_code", "") or "")
                uid = getattr(user, "id", None) if user else None
                if roles is not None and uid != 1 and role not in set(roles):
                    resp = Resp.resp_err(msg=f"{ts('msg_no_perm')}")
                elif roles is None and perm and isinstance(perm, Perms) and perm.value.code not in CtxPerm.get():
                    resp = Resp.resp_err(msg=f"{ts('msg_no_perm')}")
                elif roles is None and perm and isinstance(perm, List) and not any(p.value.code in CtxPerm.get() for p in perm):
                    resp = Resp.resp_err(msg=f"{ts('msg_no_perm')}")
                else:
                    resp = await func(*args, **kwargs)
            except Exception:
                resp = error_resp
                logger.exception("")
                try:
                    db.session.rollback()
                except Exception:
                    pass
            finally:
                is_resp = isinstance(resp, Resp)
                code = resp.code if is_resp else None
                msg = resp.msg if is_resp else None
                logger.info("#timer:%s #code:%s #url:%s #msg:%s", math.ceil((time.time() - timer) * 1000), code, request.url, msg)
            return resp

        return wrapper

    return decorator


class CtxUser(object):
    var: ContextVar = ContextVar(__name__, default=None)

    @classmethod
    def init(cls, user: UserObj):
        cls.var.set(user)

    @classmethod
    def get(cls):
        return cls.var.get()


class CtxPerm(object):
    var: ContextVar = ContextVar(__name__, default=())

    @classmethod
    def init(cls, user: UserObj):
        role_perms = user.role_perms if user else []
        cls.var.set(set(role_perms))

    @classmethod
    def get(cls):
        return cls.var.get()


class CtxRequest:
    var: ContextVar = ContextVar(__name__, default=None)

    @classmethod
    def init(cls, request: Request):
        cls.var.set(request)

    @classmethod
    def get(cls):
        return cls.var.get()
