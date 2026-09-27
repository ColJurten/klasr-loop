from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session


def make_engine(url):
    engine = create_engine(
        url, **({"connect_args": {"check_same_thread": False}} if url.startswith("sqlite:") else {})
    )
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _record):
            connection.isolation_level = None
            connection.execute("PRAGMA foreign_keys=ON")

        @event.listens_for(engine, "begin")
        def begin(connection):
            connection.exec_driver_sql("BEGIN")

    return engine


def get_session(request: Request):
    if not hasattr(request.app.state, "engine"):
        request.app.state.engine = make_engine(request.app.state.settings.database_url)
    with Session(request.app.state.engine, expire_on_commit=False) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
