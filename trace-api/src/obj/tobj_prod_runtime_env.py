#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from typing import Optional
from pydantic import BaseModel, Field


class ProdRuntimeEnvForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    prod_id: Optional[int] = Field(title="产品ID")
    arch: Optional[str] = Field(title="架构说明")
    srv_cpu: Optional[str] = Field(title="服务器CPU")
    srv_memory: Optional[str] = Field(title="服务器内存")
    srv_gpu: Optional[str] = Field(title="服务器GPU")
    srv_disk: Optional[str] = Field(title="服务器硬盘")
    srv_nic: Optional[str] = Field(title="服务器网卡")
    srv_os: Optional[str] = Field(title="服务器操作系统")
    srv_cuda: Optional[str] = Field(title="CUDA")
    cli_cpu: Optional[str] = Field(title="用户端CPU")
    cli_memory: Optional[str] = Field(title="用户端内存")
    cli_resolution: Optional[str] = Field(title="显示器分辨率")
    cli_os: Optional[str] = Field(title="用户端操作系统")
    cli_browser: Optional[str] = Field(title="浏览器")
    net_lan: Optional[str] = Field(title="局域网带宽")
    net_wan: Optional[str] = Field(title="广域网带宽")
