import logging
from hashlib import md5
from os import getenv
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from datetime import datetime
from ..utils.sql_ctx import db
from ..model.role import Role, RolePerm
from ..model.user import User
from ..obj import Page, Resp
from ..obj.tobj_user import LoginForm, PwdForm, UserForm
from ..obj.vobj_user import UserObj
from ..utils.i18n import ts
from .. import env
from .import msg_err_db

logger = logging.getLogger(__name__)
DEF_PWD = getenv("DEF_PWD", "test")


def pwd2sign(raw_pwd: str, pwd_sk: str):
    return md5((raw_pwd + pwd_sk).encode('utf-8')).hexdigest()

def pwd_sign(raw_pwd: str):
    pwd_sk = datetime.now().strftime("#%Y%m%d.%H%M%S")
    return pwd2sign(raw_pwd, pwd_sk), pwd_sk

class Server(object):
    async def login(self, form: LoginForm):
        sql = select(User).where(User.name == form.name)
        row: User = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_user_null"))
        raw_pwd = form.pwd or ""
        pwd_hash = pwd2sign(raw_pwd, row.pwd_sk)
        if pwd_hash != row.pwd:
            logger.error("raw_pwd: %s, pwd_sk: %s, pwd_hash: %s, row.pwd: %s", raw_pwd, row.pwd_sk, pwd_hash, row.pwd)
            return Resp.resp_err(msg=ts("msg_err_pwd"))
        return Resp.resp_ok(data=UserObj(
            id=row.id,
            name=row.name,
            nick_name=row.nick_name
        ))
    
    async def get_user(self, user_id: int):
        sql = select(User).where(User.id == user_id)
        row: User = db.session.execute(sql).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_user_null"))
        row_role: Role = db.session.execute(select(Role).where(Role.code == row.role_code)).scalars().first()
        role_perms = []
        if row_role:
            role_perms = db.session.execute(select(RolePerm).where(RolePerm.role_code == row_role.code)).scalars().all()
            role_perms = [perm.perm_code for perm in role_perms]
        return Resp.resp_ok(data=UserObj(**row.dict(),
            role_name=row_role.name if row_role else None,
            role_perms=role_perms
        ))
    
    async def update_pwd(self, op_user:UserObj, form: PwdForm):
        try:
            sql = select(User).where(User.id == op_user.id)
            row: User = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_user_null"))
            raw_pwd = form.pwd or ""
            pwd_hash = pwd2sign(raw_pwd, row.pwd_sk)
            if not pwd_hash == row.pwd:
                logger.warning("%s %s %s %s", form.pwd, row.pwd_sk, pwd_hash, row.pwd)
                return Resp.resp_err(msg=ts("msg_err_pwd"))
            if not form.pwd_new1 or not form.pwd_new2:
                return Resp.resp_err(msg=ts("msg_newpwd_unset"))
            if form.pwd_new1 != form.pwd_new2:
                return Resp.resp_err(msg=ts("msg_newpwd_diff"))
            pwd_new, pwd_sk = pwd_sign(form.pwd_new1)
            row.pwd = pwd_new
            row.pwd_sk = pwd_sk
            db.session.commit()
        except:
            logger.exception("")
            db.session.rollback()
            return Resp.resp_err(msg=ts(msg_err_db))
        return Resp.resp_ok()

    async def add_user(self, form: UserForm):
        try:
            sql = select(func.count(User.id)).where(User.name == form.name)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_user_exist"))
            
            pwd_hash, pwd_sk = pwd_sign(DEF_PWD)
            user = User(
                name=form.name,
                nick_name=form.nick_name,
                pwd=pwd_hash,
                pwd_sk=pwd_sk,
                role_code=form.role_code,
            )
            db.session.add(user)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_user(self, op_uid:int, id: int):
        if op_uid == id:
            return Resp.resp_err(msg=ts("msg_err_del_self"))
        db.session.execute(delete(User).where(User.id == id))
        db.session.commit()
        return Resp.resp_ok()
    
    async def reset_pwd(self, id: int):
        pwd_hash, pwd_sk = pwd_sign(DEF_PWD)
        try:
            sql = select(User).where(User.id == id)
            row: User = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_user_null"))
            if row.name == env.ADMIN_NAME:
                return Resp.resp_err(msg=ts("msg_err_reset_admin"))
            row.pwd = pwd_hash
            row.pwd_sk = pwd_sk
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def update_user(self, form: UserForm):
        try:
            sql = select(User).where(User.id == form.id)
            row: User = db.session.execute(sql).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_user_null"))
            for key, value in form.dict().items():
                if key == "id" or key == "name":
                    continue
                setattr(row, key, value)
            if form.pwd:
                pwd_hash, pwd_sk = pwd_sign(form.pwd)
                row.pwd = pwd_hash
                row.pwd_sk = pwd_sk
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def list_user(self, name: str = None, nick_name: str = None, role_code: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(User, Role).outerjoin(Role, User.role_code == Role.code)
        if role_code:
            sql = sql.where(User.role_code == role_code)
        if name:
            sql = sql.where(User.name.like(f"%{name}%"))
        if nick_name:
            sql = sql.where(User.nick_name.like(f"%{nick_name}%"))
        
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(User.create_time))
        rows: list[User] = db.session.execute(sql).all()

        objs = []
        for row_user, row_role in rows:
            obj = UserObj(
                **row_user.dict(),
                role_name=row_role.name if row_role else None,
            )
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
      