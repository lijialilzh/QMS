from typing import Dict, Optional, Union
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import URL
from sqlalchemy import create_engine
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.types import ASGIApp
from . import sql_ctx


class SQLAlchemyMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        db_url: Optional[Union[str, URL]] = None,
        custom_engine: Optional[Engine] = None,
        engine_args: Dict = None,
        session_args: Dict = None,
        commit_on_exit: bool = False,
    ):
        super().__init__(app)
        self.commit_on_exit = commit_on_exit
        engine_args = engine_args or {}
        session_args = session_args or {}

        if not custom_engine and not db_url:
            raise ValueError("You need to pass a db_url or a custom_engine parameter.")
        if not custom_engine:
            engine = create_engine(db_url, **engine_args)
        else:
            engine = custom_engine
        sql_ctx.init(engine, **session_args)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint):
        with sql_ctx.db(commit_on_exit=self.commit_on_exit):
            return await call_next(request)
            