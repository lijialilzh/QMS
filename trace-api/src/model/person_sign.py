#!/usr/bin/env python
# encoding: utf-8

# 人员签名管理（基础数据）：人名章记录表。
# 记录人员姓名、职务、预留印鉴、人员签字（印鉴/签字均以 base64 图片存储）、状态。

from sqlalchemy import Column, Integer, String, TEXT
from . import Model


class PersonSign(Model):
    __tablename__ = "person_sign"
    name = Column(String(64), nullable=False, comment="人员姓名")
    position = Column(String(256), comment="人员职务")
    seal_img = Column(TEXT, comment="预留印鉴(base64图片)")
    sign_img = Column(TEXT, comment="人员签字(base64图片)")
    status = Column(String(64), comment="状态")
    sort_order = Column(Integer, default=0, comment="排序")
