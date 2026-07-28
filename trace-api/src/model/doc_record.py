#!/usr/bin/env python
# encoding: utf-8

# 文档导出/打印记录：记录每次整合导出和一键打印的操作日志。

from sqlalchemy import Column, Integer, String
from . import Model


class DocExportRecord(Model):
    __tablename__ = "doc_export_record"
    product_id = Column(Integer, comment="产品ID")
    product_name = Column(String(128), comment="产品名称")
    full_version = Column(String(64), comment="完整版本")
    doc_count = Column(Integer, comment="文档数量")
    success_count = Column(Integer, comment="成功数")
    fail_count = Column(Integer, comment="失败数")
    filename = Column(String(256), comment="导出文件名")
    doc_names = Column(String(2048), comment="导出的文件名列表，逗号分隔")
    operator = Column(String(64), comment="操作人")


class DocPrintRecord(Model):
    __tablename__ = "doc_print_record"
    product_id = Column(Integer, comment="产品ID")
    product_name = Column(String(128), comment="产品名称")
    full_version = Column(String(64), comment="完整版本")
    doc_count = Column(Integer, comment="文档数量")
    success_count = Column(Integer, comment="成功数")
    fail_count = Column(Integer, comment="失败数")
    printer_name = Column(String(128), comment="打印机名称")
    doc_names = Column(String(2048), comment="打印的文件名列表，逗号分隔")
    operator = Column(String(64), comment="操作人")