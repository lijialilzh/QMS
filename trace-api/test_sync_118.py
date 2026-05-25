import asyncio
from sqlalchemy import create_engine
from src import env
from src.utils import sql_ctx
from src.serv.serv_sds_doc import Server


async def main():
    engine = create_engine(env.DB_URL)
    sql_ctx.init(engine)
    with sql_ctx.db():
        r = await Server().sync_srs_trace(118)
        print("code", r.code)


if __name__ == "__main__":
    asyncio.run(main())
