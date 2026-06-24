#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, TEXT
from . import Model


class ProdRuntimeEnv(Model):
    __tablename__ = "prod_runtime_env"
    prod_id = Column(Integer, nullable=False, unique=True, index=True, comment="产品ID")
    arch = Column(String(256), comment="架构说明")
    # 表1 服务器硬件
    srv_cpu = Column(TEXT, comment="服务器CPU")
    srv_memory = Column(TEXT, comment="服务器内存")
    srv_gpu = Column(TEXT, comment="服务器GPU")
    srv_disk = Column(TEXT, comment="服务器硬盘")
    srv_nic = Column(TEXT, comment="服务器网卡")
    # 表2 服务器软件
    srv_os = Column(TEXT, comment="服务器操作系统")
    srv_cuda = Column(TEXT, comment="CUDA")
    # 表3 用户端
    cli_cpu = Column(TEXT, comment="用户端CPU")
    cli_memory = Column(TEXT, comment="用户端内存")
    cli_resolution = Column(TEXT, comment="显示器分辨率")
    cli_os = Column(TEXT, comment="用户端操作系统")
    cli_browser = Column(TEXT, comment="浏览器")
    # 表4 网络
    net_lan = Column(TEXT, comment="局域网带宽")
    net_wan = Column(TEXT, comment="广域网带宽")
