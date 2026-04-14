import time
import logging
from sqlalchemy.sql import expression
from sqlalchemy import create_engine
from sqlalchemy_utils import database_exists, create_database
from sqlalchemy.dialects.postgresql import insert as pg_insert
from src import env
from src.utils import sql_ctx
from src.model import Base, user, role
from src.obj.tobj_role import Roles, Perms, get_default_role_perm_codes
from src.serv.serv_user import pwd_sign


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s [%(filename)s.%(lineno)s]: %(message)s")

def create_tables():
    ok = False
    while not ok:
        try:
            time.sleep(1)
            if not database_exists(env.DB_URL):
                create_database(env.DB_URL)

            engine = create_engine(env.DB_URL, echo=True)
            sql_ctx.init(engine)
            with sql_ctx.db():
                sql = expression.text("drop table if exists alembic_version")
                sql_ctx.db.session.execute(sql)
                # Lightweight schema migration for local deployment.
                sql_ctx.db.session.execute(expression.text("ALTER TABLE IF EXISTS product ADD COLUMN IF NOT EXISTS product_code VARCHAR(256)"))
                sql_ctx.db.session.execute(expression.text("ALTER TABLE IF EXISTS product ADD COLUMN IF NOT EXISTS create_user_id INTEGER"))
                sql_ctx.db.session.execute(expression.text("ALTER TABLE IF EXISTS srs_node ALTER COLUMN img_url TYPE TEXT"))
                sql_ctx.db.session.execute(expression.text("ALTER TABLE IF EXISTS srs_doc ADD COLUMN IF NOT EXISTS folder_name VARCHAR(128)"))
                sql_ctx.db.session.commit()
            Base.metadata.create_all(bind=engine)

            ok = True
        except Exception:
            logger.exception("")

def init_data():
    pwd_hash, pwd_sk = pwd_sign(env.ADMIN_PWD)
    default_role_perms = get_default_role_perm_codes()
    role_rows = [item.value.dict(exclude_none=True) for item in Roles]
    role_perm_rows = []
    for role_code, perm_codes in default_role_perms.items():
        for perm_code in perm_codes:
            role_perm_rows.append(dict(role_code=role_code, perm_code=perm_code))
    data = [
        (role.Role, role_rows),
        (role.Perm, [dict(**perm.value.dict(exclude_none=True), priority=idx) for idx, perm in enumerate(Perms)]),
        (role.RolePerm, role_perm_rows),
        (user.User, [dict(name=env.ADMIN_NAME, nick_name=env.ADMIN_NAME, pwd=pwd_hash, pwd_sk=pwd_sk, role_code=Roles.root.value.code)]),
    ]
    engine = create_engine(env.DB_URL, echo=True)
    sql_ctx.init(engine)
    with sql_ctx.db():
        for table, rows in data:
            for row in rows:
                logger.info("init: %s row: %s", table.__tablename__, row)
                if table == role.Perm:
                    sql = pg_insert(table).values(row).on_conflict_do_update(
                        index_elements=[table.code],
                        set_=dict(name=row["name"]),
                    )
                if table == role.Perm:
                    sql = pg_insert(table).values(row).on_conflict_do_update(
                        index_elements=[table.code],
                        set_=dict(priority=row["priority"]),
                    )
                else:
                    sql = pg_insert(table).values(row).on_conflict_do_nothing()
                sql_ctx.db.session.execute(sql)
            sql_ctx.db.session.commit()

if __name__ == "__main__":
    create_tables()
    init_data()
