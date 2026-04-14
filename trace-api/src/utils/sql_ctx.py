from contextvars import ContextVar
from typing import Dict, Optional
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm import Session

_Session: Optional[sessionmaker] = None
_session: ContextVar[Optional[Session]] = ContextVar("_session", default=None)


def init(engine, **session_args):
    global _Session
    _Session = sessionmaker(engine, class_=Session, expire_on_commit=False, **session_args)


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
    def session(self) -> Session:
        """Return an instance of Session local to the current context."""
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

    def _init_session(self):
        self.token = _session.set(_Session(**self.session_args))

    def __enter__(self):
        if not isinstance(_Session, sessionmaker):
            raise SessionNotInitialisedError

        self._init_session()
        return type(self)

    def __exit__(self, exc_type, exc_value, traceback):
        session = _session.get()
        if exc_type is not None:
            session.rollback()

        if self.commit_on_exit:
            session.commit()

        session.close()
        _session.reset(self.token)


db: DBSessionMeta = DBSession
