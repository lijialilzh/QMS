#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import logging
import math
import time
import io
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


# 各文档模块的单文档导出接口（列表页/编辑页「导出」按钮）。这些接口默认不带签名：
# 单独导出不要签名；一键导出/打印走各自接口与开关，不受影响。
# 需要带签名时可显式传 with_sign=1。
_SINGLE_DOC_SUFFIXES = ("_doc", "_doc_snapshot")
_SINGLE_DOC_NAMES = ("export_release_note",)
# 整合导出页自己的接口：带 with_sign 参数由前端开关决定，不参与这里的默认规则
_SIGN_SWITCH_EXPORTS = ("export_single_doc", "export_srs_doc_trace", "export_doc_trace")


def _export_sign_requested(func_name: str, request: Request):
    """单文档导出接口是否要求带签名。打开、保存、列表不处理，避免把封面签名章清掉。"""
    if func_name in _SIGN_SWITCH_EXPORTS:
        return None
    # 只认导出接口。get/list/update 也以 _doc 结尾，不能算导出。
    is_single_export = func_name in _SINGLE_DOC_NAMES or (
        func_name.startswith("export_") and func_name.endswith(_SINGLE_DOC_SUFFIXES)
    )
    if not is_single_export:
        return None
    raw = request.query_params.get("with_sign") if request else None
    if raw is None or str(raw).strip() == "":
        return False  # 单独导出默认不带签名
    return str(raw).strip().lower() not in ("0", "false", "no", "off")


async def _strip_sign_from_response(resp, blank_cover_names=True):
    """导出出口剥离签名图（各模块自定义封面结构不一，逐模块修补会漏）。
    流式响应需读完后重建，返回新的响应对象。
    成品检验规程封面编审批要保留姓名，不留白。"""
    try:
        from ..serv.serv_utils.docx_util import strip_signature_images

        body = getattr(resp, "body", None)
        if isinstance(body, (bytes, bytearray)):
            if bytes(body)[:2] == b"PK":
                buf = io.BytesIO(bytes(body))
                if strip_signature_images(buf, blank_cover_names=blank_cover_names):
                    resp.body = buf.getvalue()
            return resp
        it = getattr(resp, "body_iterator", None)
        if it is None:
            return resp
        chunks = []
        async for chunk in it:
            chunks.append(chunk.encode("utf-8") if isinstance(chunk, str) else chunk)
        raw = b"".join(chunks)
        if raw[:2] != b"PK":
            return _rebuild(resp, raw)
        buf = io.BytesIO(raw)
        if strip_signature_images(buf, blank_cover_names=blank_cover_names):
            raw = buf.getvalue()
        return _rebuild(resp, raw)
    except Exception:
        logger.exception("strip sign from export response failed")
        return resp


def _rebuild(resp, raw: bytes):
    from starlette.responses import Response
    headers = {k: v for k, v in dict(getattr(resp, "headers", {}) or {}).items()
               if k.lower() != "content-length"}
    return Response(content=raw, status_code=getattr(resp, "status_code", 200),
                    headers=headers, media_type=getattr(resp, "media_type", None))


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
            # 单文档导出默认不带签名；一键导出/打印由各自接口显式设置
            with_sign = _export_sign_requested(func.__name__, request)
            sign_token = None
            if with_sign is not None:
                from ..serv.serv_review_util import set_export_sign_mode
                sign_token = set_export_sign_mode(with_sign)
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
                    # 不带签名导出：在出口统一剥离签名图，覆盖各模块自定义封面。
                    # 质量文件封面编审批姓名要导出，不能清成空白。
                    if with_sign is False:
                        resp = await _strip_sign_from_response(
                            resp, blank_cover_names=func.__name__ != "export_qa_doc",
                        )
            except Exception:
                resp = error_resp
                logger.exception("")
                try:
                    db.session.rollback()
                except Exception:
                    pass
            finally:
                if sign_token is not None:
                    try:
                        from ..serv.serv_review_util import restore_export_sign_mode
                        restore_export_sign_mode(sign_token)
                    except Exception:
                        pass
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
