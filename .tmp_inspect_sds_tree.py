import os
import asyncio
from sqlalchemy import create_engine, select

from trace-api.src.utils import sql_ctx
from trace-api.src.utils.sql_ctx import db
from trace-api.src.model.sds_doc import SdsDoc
from trace-api.src.serv.serv_sds_doc import Server


def main():
    engine = create_engine(os.getenv("DB_URL"), echo=False, pool_recycle=3600)
    sql_ctx.init(engine)

    with db():
        doc_id = db.session.execute(select(SdsDoc.id).order_by(SdsDoc.id.desc())).first()[0]

    async def _run():
        with db():
            resp = await Server().get_sds_doc(id=doc_id, with_tree=True)
        roots = (resp.data.content or []) if resp and resp.data else []
        keys = ["Postgresql", "alembic", "库2数据库", "database"]

        def walk(nodes, depth=0):
            for n in nodes or []:
                title = str(getattr(n, "title", "") or "")
                label = str(getattr(n, "label", "") or "")
                text = str(getattr(n, "text", "") or "")
                has_table = bool(getattr(n, "table", None) and getattr(getattr(n, "table", None), "headers", None))
                children = getattr(n, "children", []) or []
                blob = (title + "\n" + label + "\n" + text).lower()
                hit = any(k.lower() in blob for k in keys)
                if hit:
                    print(f"DEPTH={depth} TABLE={has_table} CHILD={len(children)}")
                    print("TITLE=", title[:120])
                    print("LABEL=", label[:120])
                    if text:
                        print("TEXT=", text[:260])
                    print("---")
                walk(children, depth + 1)

        walk(roots)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
