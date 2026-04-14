from contextvars import ContextVar
from typing import Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

_Session: Optional[sessionmaker] = None
_session: ContextVar[Optional[AsyncSession]] = ContextVar("_session", default=None)


def init(engine, **session_args):
    global _Session
    _Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, **session_args)


class MissingSessionError(Exception):
    def __init__(self):
        super().__init__("MissingSessionError")


class SessionNotInitialisedError(Exception):
    def __init__(self):
        super().__init__("SessionNotInitialisedError")


class DBSessionMeta(type):
    # using this metaclass means that we can access db.session as a property at a class level,
    # rather than db().session
    @property
    def session(self) -> AsyncSession:
        """Return an instance of Session local to the current async context."""
        if _Session is None:
            raise SessionNotInitialisedError

        session = _session.get()
        if session is None:
            raise MissingSessionError

        return session


class DBSession(metaclass=DBSessionMeta):
    def __init__(self, session_args: Dict = None, commit_on_exit: bool = False):
        self.token = None
        self.session_args = session_args or {}
        self.commit_on_exit = commit_on_exit

    async def _init_session(self):
        self.token = _session.set(_Session(**self.session_args))

    async def __aenter__(self):
        if not isinstance(_Session, sessionmaker):
            raise SessionNotInitialisedError

        await self._init_session()
        return type(self)

    async def __aexit__(self, exc_type, exc_value, traceback):
        session = _session.get()
        if exc_type is not None:
            await session.rollback()

        if self.commit_on_exit:
            await session.commit()

        await session.close()
        _session.reset(self.token)


db: DBSessionMeta = DBSession
