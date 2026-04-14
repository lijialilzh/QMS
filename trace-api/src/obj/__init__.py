#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from datetime import datetime
from typing import Generic, List, Optional, TypeVar
from pydantic import Field
from pydantic.generics import GenericModel
from pydantic.json import ENCODERS_BY_TYPE
from ..utils.i18n import ts

ENCODERS_BY_TYPE[datetime] = lambda v: v.strftime("%Y-%m-%d %H:%M:%S")

c_ok = 1  # 请求成功
c_error = 0  # 已知错误
c_fatal = -1  # 未知错误
c_auth_error = -2  # 未登录

TypeT = TypeVar("TypeT")


class Resp(GenericModel, Generic[TypeT]):
    """
    所有请求返回如下Json结构：
    {
        "code": 1,
        "msg": "请求成功！",
        "data": T
    }

    字段解释：
    code: 1:请求成功 0:普通错误 -1:未知错误 -2:未登录
    data: # 泛型，不同的请求返回不同内容。
    """
    code: int = Field(default=c_ok, description="Code码")
    msg: str = Field(default="请求成功!", description="文本消息")
    data: Optional[TypeT] = Field(default=None, description="数据内容")

    @staticmethod
    def resp_ok(msg=None, data=None):
        return Resp.resp(c_ok, msg=msg or ts("msg_ok"), data=data)

    @staticmethod
    def resp_err(msg=None, data=None):
        return Resp.resp(c_error, msg=msg or ts("msg_err"), data=data)

    @staticmethod
    def resp_fatal(msg=None, data=None):
        return Resp.resp(c_fatal, msg=msg or ts("msg_fatal"), data=data)

    @staticmethod
    def resp(code, msg=None, data=None):
        resp = Resp()
        resp.code = code
        resp.msg = msg
        resp.data = data
        return resp


class Page(GenericModel, Generic[TypeT]):
    total: Optional[int] = Field(default=0, description="总条数")
    pages: Optional[int] = Field(default=0, description="总页数")
    rows: Optional[List[TypeT]] = Field(description="数据列表")

    page_index: Optional[int] = Field(default=0, description="当前页码")
    page_size: Optional[int] = Field(default=10, description="页面大小")

    def __init__(self, *args, **kwargs):
        total = kwargs.get("total")
        page_size = kwargs.get("page_size")

        if total and page_size:
            pages = total // page_size
            kwargs["pages"] = pages + 1 if total % page_size else pages
        super().__init__(*args, **kwargs)
