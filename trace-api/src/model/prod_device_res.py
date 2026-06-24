#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, TEXT
from . import Model


class ProdDeviceRes(Model):
    __tablename__ = "prod_device_res"
    prod_id = Column(Integer, nullable=False, unique=True, index=True, comment="产品ID")
    # 设备资源表，JSON 数组：[{"use":设备及用途, "name":设备名称, "qty":数量}]
    items = Column(TEXT, comment="设备资源条目(JSON)")
