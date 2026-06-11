#!/usr/bin/env python
# encoding: utf-8

# 网络安全管理（独立模块）数据模型，详见 docs/function_docs/47_网络安全管理.md 第 5 节。
# 共 5 张表：cybersec_doc + cybersec_threat + cybersec_control_internal/_sbom/_scan
# 三张 control 表暂时结构同构，独立持久化与独立 CRUD，便于未来按各自来源独立扩展字段
# （SBOM 可加 component_name/cve_id；扫描可加 scanner_name/scan_date 等），现阶段先零差异。

from sqlalchemy import Column, Integer, String, JSON, SmallInteger, TEXT, UniqueConstraint
from . import Model


class CybersecDoc(Model):
    __tablename__ = "cybersec_doc"
    product_id = Column(Integer, nullable=False, comment="产品ID")
    version = Column(String(64), nullable=False, comment="文档版本")
    file_no = Column(String(128), comment="文件编号")
    change_log = Column(String(512), comment="版本变更说明")
    content = Column(JSON, comment="文档内容")

    __table_args__ = (
        UniqueConstraint("product_id", "version"),
    )


class CybersecThreat(Model):
    __tablename__ = "cybersec_threat"
    doc_id = Column(Integer, nullable=False, comment="网络安全报告ID")
    product_id = Column(Integer, nullable=False, comment="产品ID")
    threat_code = Column(String(64), nullable=False, comment="威胁编号（doc 内唯一）")
    view_type = Column(String(64), comment="子视图：全局/多患者/用例/可更新性/STRIDE")
    stride_category = Column(String(64), comment="STRIDE 类别（仅 view_type=STRIDE 时填）")
    asset = Column(String(256), comment="资产/对象")
    description = Column(TEXT, comment="威胁描述")
    attack_path = Column(TEXT, comment="攻击路径")
    impact = Column(TEXT, comment="影响")
    likelihood = Column(SmallInteger, comment="可能性 1-5")
    severity = Column(String(64), comment="严重度 A-E 或 1-5")
    risk_level = Column(String(64), comment="风险水平：不可接受/可控/可接受")
    control_measures = Column(TEXT, comment="控制措施")
    rcm_codes = Column(String(1024), comment="关联 RCM 编号串（跨三张 control 表）")
    residual_likelihood = Column(SmallInteger, comment="剩余可能性")
    residual_severity = Column(String(64), comment="剩余严重度")
    residual_level = Column(String(64), comment="剩余风险水平")

    __table_args__ = (
        UniqueConstraint("doc_id", "threat_code"),
    )


class CybersecControlInternal(Model):
    __tablename__ = "cybersec_control_internal"
    doc_id = Column(Integer, nullable=False, comment="网络安全报告ID")
    product_id = Column(Integer, nullable=False, comment="产品ID")
    rcm_code = Column(String(64), nullable=False, comment="内部 RCM 编号（doc 内唯一）")
    description = Column(TEXT, comment="控制措施描述")
    threat_codes = Column(String(1024), comment="关联威胁编号串")
    verification_evidence = Column(TEXT, comment="验证证据")
    new_risk_flag = Column(SmallInteger, comment="是否引入新风险 0/1")
    note = Column(TEXT, comment="备注")

    __table_args__ = (
        UniqueConstraint("doc_id", "rcm_code"),
    )


class CybersecControlSbom(Model):
    __tablename__ = "cybersec_control_sbom"
    doc_id = Column(Integer, nullable=False, comment="网络安全报告ID")
    product_id = Column(Integer, nullable=False, comment="产品ID")
    rcm_code = Column(String(64), nullable=False, comment="SBOM RCM 编号（doc 内唯一）")
    description = Column(TEXT, comment="控制措施描述")
    threat_codes = Column(String(1024), comment="关联威胁编号串")
    verification_evidence = Column(TEXT, comment="验证证据")
    new_risk_flag = Column(SmallInteger, comment="是否引入新风险 0/1")
    note = Column(TEXT, comment="备注")

    __table_args__ = (
        UniqueConstraint("doc_id", "rcm_code"),
    )


class CybersecControlScan(Model):
    __tablename__ = "cybersec_control_scan"
    doc_id = Column(Integer, nullable=False, comment="网络安全报告ID")
    product_id = Column(Integer, nullable=False, comment="产品ID")
    rcm_code = Column(String(64), nullable=False, comment="网络安全扫描 RCM 编号（doc 内唯一）")
    description = Column(TEXT, comment="控制措施描述")
    threat_codes = Column(String(1024), comment="关联威胁编号串")
    verification_evidence = Column(TEXT, comment="验证证据")
    new_risk_flag = Column(SmallInteger, comment="是否引入新风险 0/1")
    note = Column(TEXT, comment="备注")

    __table_args__ = (
        UniqueConstraint("doc_id", "rcm_code"),
    )
