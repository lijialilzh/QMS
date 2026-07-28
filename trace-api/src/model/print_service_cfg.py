#!/usr/bin/env python
# encoding: utf-8

# 打印服务配置（全局单条记录）：配置公司内部打印机的 IPP 连接信息。

from sqlalchemy import Column, Integer, String
from . import Model


class PrintServiceCfg(Model):
    __tablename__ = "print_service_cfg"
    # IPP 打印机连接：ipp://ip:port/ipp/print/printer_name
    printer_host = Column(String(128), comment="打印机IP/主机名")
    printer_port = Column(Integer, comment="打印机IPP端口，默认631")
    printer_name = Column(String(128), comment="打印机名称（IPP queue name）")
    printer_uri = Column(String(256), comment="打印机完整URI，如 ipp://192.168.1.50:631/ipp/print/HP_LaserJet")
    protocol = Column(String(32), default="ipp", comment="协议：ipp（目前仅支持ipp）")
    is_default = Column(Integer, default=1, comment="是否默认打印机：1是0否")
    remark = Column(String(256), comment="备注")