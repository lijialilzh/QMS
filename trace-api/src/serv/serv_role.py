import logging
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from ..obj.tobj_role import RoleForm, get_fixed_role_codes, get_default_role_perm_codes
from ..obj.vobj_role import PermObj, RoleObj
from ..utils.sql_ctx import db
from ..utils import get_uuid
from ..utils.i18n import ts
from ..model.user import User
from ..model.role import Perm, Role, RolePerm
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):
    fixed_role_codes = set(get_fixed_role_codes())
    fixed_default_perm_codes = get_default_role_perm_codes()

    async def add_role(self, form: RoleForm):
        try:
            sql = select(func.count(Role.id)).where(Role.name == form.name)
            count = db.session.execute(sql).scalar()
            if count > 0:
                return Resp.resp_err(msg=ts("msg_role_exist"))
        
            role = Role(
                name=form.name,
                code=get_uuid(),
            )
            db.session.add(role)
            for perm_code in form.role_perms or []:
                db.session.add(RolePerm(role_code=role.code, perm_code=perm_code))
            db.session.commit()

            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_role(self, code: str):
        if code in self.fixed_role_codes:
            return Resp.resp_err(msg="固定角色不允许删除")
        sql = select(func.count(User.id)).where(User.role_code == code)
        count = db.session.execute(sql).scalar()
        if count > 0:
            return Resp.resp_err(msg=ts("msg_role_in_use"))
        db.session.execute(delete(Role).where(Role.code == code))
        db.session.execute(delete(RolePerm).where(RolePerm.role_code == code))
        db.session.commit()
        return Resp.resp_ok()
   
    async def update_role(self, form: RoleForm):
        try:
            sql = select(Role).where(Role.code == form.code)
            role = db.session.execute(sql).scalars().first()
            if not role:
                return Resp.resp_err(msg=ts("msg_role_null"))
            if role.code not in self.fixed_role_codes:
                role.name = form.name
            role_perms = set(form.role_perms or [])
            # Fixed roles keep their baseline permissions and only allow incremental additions.
            if role.code in self.fixed_role_codes:
                base_perms = set(self.fixed_default_perm_codes.get(role.code, []))
                role_perms = base_perms.union(role_perms)

            db.session.execute(delete(RolePerm).where(RolePerm.role_code == role.code))
            for perm_code in sorted(role_perms):
                db.session.add(RolePerm(role_code=role.code, perm_code=perm_code))
            db.session.commit()

            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def get_role(self, code:str):
        sql = select(Role).where(Role.code == code)
        role = db.session.execute(sql).scalars().first()
        if not role:
            return Resp.resp_err(msg=ts("msg_role_null"))
        
        role_perms = db.session.execute(select(RolePerm).where(RolePerm.role_code == code)).scalars().all()
        role_perms = [perm.perm_code for perm in role_perms]
        fixed_base_perms = self.fixed_default_perm_codes.get(code, [])

        all_perms = db.session.execute(select(Perm).order_by(Perm.priority)).scalars().all()
        all_perms = [PermObj(**perm.dict(), children=[]) for perm in all_perms]
        perms_dic = {perm.code: perm for perm in all_perms}
        perm_tree =[]
        for perm in all_perms:
            p_perm = perms_dic.get(perm.p_code)
            if p_perm:
                p_perm.children.append(perm)
            elif not perm.p_code:
                perm_tree.append(perm)
            else:
                logger.warning("p_code: %s", perm.p_code)

        return Resp.resp_ok(data=RoleObj(**role.dict(),
            role_perms=role_perms,
            perm_tree=perm_tree,
            all_perms=[perm.code for perm in all_perms],
            fixed_base_perms=fixed_base_perms,
        ))

    async def list_role(self, name: str = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
    
        sql = select(Role)
        if name:
            sql = sql.where(Role.name.like(f"%{name}%"))
        
        sql_count = select(func.count()).select_from(sql)
        total = db.session.execute(sql_count).scalars().first()

        sql = sql.offset(page_size * page_index).limit(page_size).order_by(desc(Role.create_time))
        rows: list[Role] = db.session.execute(sql).scalars().all()
        role_codes = [row.code for row in rows]
        user_count_dict = {}
        if role_codes:
            sql_count_by_role = (
                select(User.role_code, func.count(User.id))
                .where(User.role_code.in_(role_codes))
                .group_by(User.role_code)
            )
            user_count_dict = {code: cnt for code, cnt in db.session.execute(sql_count_by_role).all()}

        objs = []
        for row in rows:
            obj = RoleObj(**row.dict(), user_count=user_count_dict.get(row.code, 0))
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
      