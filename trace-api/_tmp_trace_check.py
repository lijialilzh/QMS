import asyncio
from sqlalchemy import create_engine
from src import env
from src.utils import sql_ctx
from src.serv.serv_srs_doc import Server

async def main():
    sql_ctx.init(create_engine(env.DB_URL, echo=False))
    with sql_ctx.db():
        resp = await Server().list_doc_trace(344)
        rows = getattr(resp, "data", None) or []
        for r in rows:
            code = str(r.get("srs_code") or "")
            if "308-" not in code and "305-00" not in code:
                continue
            print(r.get("type_code"), code, "I", r.get("tests_integ"), "U", r.get("tests_unit"), flush=True)

asyncio.run(main())
