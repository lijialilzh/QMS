#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, String, UniqueConstraint, Integer, TEXT
from . import Model


class Product(Model):
    __tablename__ = "product"
    project_id = Column(Integer, comment="项目ID")
    name = Column(String(256), comment="名称")
    category = Column(String(256), comment="类别")
    type_code = Column(String(256), comment="型号")
    full_version = Column(String(256), nullable=False, comment="完整版本")
    release_version = Column(String(256), nullable=False, comment="发布版本")
    udi = Column(String(256), comment="UDI")
    product_code = Column(String(256), comment="产品代码")
    scope = Column(TEXT, comment="试用范围")
    component = Column(TEXT, comment="产品组成")
    note = Column(TEXT, comment="备注")
    create_user_id = Column(Integer, comment="创建人ID")

    __table_args__ = (
        UniqueConstraint("name", "full_version"),
    )

class UserProd(Model):
    __tablename__ = "prod_user"
    user_id = Column(Integer, comment="用户ID")
    product_id = Column(Integer, comment="产品ID")
    
    __table_args__ = (
        UniqueConstraint("user_id", "product_id"),
    )
