#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import logging
from fastapi import Request, Response
from starlette import status
from starlette.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from . import CtxRequest, CtxUser, CtxPerm, SESSION_KEY
from ..obj import Resp, c_auth_error
from ..utils.i18n import ts, CtxLang, DEF_LANG
from ..serv.serv_user import Server
server = Server()

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, *args, whitelist=None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.whitelist = whitelist

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        def __in_whitelist(url: str, whitelist):
            for white in whitelist:
                is_in = url.startswith(white)
                if is_in:
                    return True

        uid = request.session.get(SESSION_KEY) if request.session else None
        user = (await server.get_user(uid)).data if uid else None
        CtxRequest.init(request)
        CtxUser.init(user)
        CtxPerm.init(user)
        CtxLang.init(request.headers.get("x-lang") or DEF_LANG)
        if self.whitelist and not __in_whitelist(request.url.path, self.whitelist):
            if not user:
                logger.warning("whitelist: %s %s", request.url.path, request.headers)
                content = Resp.resp(c_auth_error, msg=ts("msg_unlogin")).dict()
                return JSONResponse(status_code=status.HTTP_200_OK, content=content)
        return await call_next(request)
