#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Any
from fastapi import APIRouter
from ..obj import Page, Resp
from ..obj.tobj_user import LoginForm, PwdForm, UserForm
from ..obj.vobj_user import UserObj
from ..serv.serv_user import Server
from ..obj.tobj_role import Perms
from . import try_log, CtxUser, CtxRequest, SESSION_KEY

router = APIRouter()
server = Server()


@router.post("/login", summary="登录", response_model=Resp[UserObj])
@try_log()
async def login(form: LoginForm):
    resp = await server.login(form)
    if resp.code == 1:
        CtxRequest.get().session.update({SESSION_KEY: resp.data.id})
    return Resp.resp(resp.code, msg=resp.msg)


@router.get("/logout", summary="退出", response_model=Resp[Any])
@try_log()
async def logout():
    CtxRequest.get().session.clear()
    return Resp.resp_ok()


@router.get("/current_user", summary="查询当前登录用户信息", response_model=Resp[UserObj])
@try_log()
async def current_user():
    op_user: UserObj = CtxUser.get()
    return await server.get_user(op_user.id)


@router.post("/update_pwd", summary="修改密码", response_model=Resp[Any])
@try_log()
async def update_pwd(form: PwdForm):
    op_user: UserObj = CtxUser.get()
    return await server.update_pwd(op_user, form)


@router.post("/add_user", summary="添加用户", response_model=Resp[Any])
@try_log(perm=Perms.user_edit)
async def add_user(form: UserForm):
    return await server.add_user(form) 


@router.delete("/delete_user", summary="删除用户", response_model=Resp[Any])
@try_log(perm=Perms.user_edit)
async def delete_user(id: int):
    op_user: UserObj = CtxUser.get()
    return await server.delete_user(op_user.id, id)  


@router.post("/update_user", summary="更新用户", response_model=Resp[Any])
@try_log(perm=Perms.user_edit)
async def update_user(form: UserForm):
    return await server.update_user(form) 


@router.get("/reset_pwd", summary="重置密码", response_model=Resp[Any])
@try_log(perm=Perms.user_edit)
async def reset_pwd(id: int):
    return await server.reset_pwd(id)


@router.get("/list_user", summary="查询用户列表", response_model=Resp[Page[UserObj]])
@try_log(perm=[Perms.user_view, Perms.product_edit])
async def list_user(name: str = None, nick_name: str = None, role_code: str = None, page_index: int = 0, page_size: int = 10):
    return await server.list_user(name, nick_name, role_code, page_index, page_size)


@router.get("/get_user", summary="查询用户详情", response_model=Resp[UserObj])
@try_log(perm=Perms.user_view)
async def get_user(id: str):
    return await server.get_user(id)
