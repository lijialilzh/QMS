#!/usr/bin/env python
# encoding: utf-8

# 网络安全管理入参 Form，字段严格对应 docs/function_docs/47_网络安全管理.md 第 5 节。
# 三张 control 表结构同构，故三个 Form 字段一致，仅来源（内部/SBOM/扫描）不同。

from typing import Any, Optional
from pydantic import BaseModel, Field


class CybersecDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    version: Optional[str] = Field(title="文档版本")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="版本变更说明")
    content: Optional[dict[str, Any]] = Field(title="文档内容")


class CybersecThreatForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    doc_id: Optional[int] = Field(title="网络安全报告ID")
    product_id: Optional[int] = Field(title="产品ID")
    threat_code: Optional[str] = Field(title="威胁编号")
    view_type: Optional[str] = Field(title="子视图（全局/多患者/用例/可更新性/STRIDE）")
    stride_category: Optional[str] = Field(title="STRIDE类别")
    asset: Optional[str] = Field(title="资产/对象")
    description: Optional[str] = Field(title="威胁描述")
    attack_path: Optional[str] = Field(title="攻击路径")
    impact: Optional[str] = Field(title="影响")
    likelihood: Optional[int] = Field(title="可能性")
    severity: Optional[str] = Field(title="严重度")
    risk_level: Optional[str] = Field(title="风险水平")
    control_measures: Optional[str] = Field(title="控制措施")
    rcm_codes: Optional[str] = Field(title="关联RCM编号串")
    residual_likelihood: Optional[int] = Field(title="剩余可能性")
    residual_severity: Optional[str] = Field(title="剩余严重度")
    residual_level: Optional[str] = Field(title="剩余风险水平")


class CybersecControlInternalForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    doc_id: Optional[int] = Field(title="网络安全报告ID")
    product_id: Optional[int] = Field(title="产品ID")
    rcm_code: Optional[str] = Field(title="内部RCM编号")
    description: Optional[str] = Field(title="控制措施描述")
    threat_codes: Optional[str] = Field(title="关联威胁编号串")
    verification_evidence: Optional[str] = Field(title="验证证据")
    new_risk_flag: Optional[int] = Field(title="是否引入新风险")
    note: Optional[str] = Field(title="备注")


class CybersecControlSbomForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    doc_id: Optional[int] = Field(title="网络安全报告ID")
    product_id: Optional[int] = Field(title="产品ID")
    rcm_code: Optional[str] = Field(title="SBOM RCM编号")
    description: Optional[str] = Field(title="控制措施描述")
    threat_codes: Optional[str] = Field(title="关联威胁编号串")
    verification_evidence: Optional[str] = Field(title="验证证据")
    new_risk_flag: Optional[int] = Field(title="是否引入新风险")
    note: Optional[str] = Field(title="备注")


class CybersecControlScanForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    doc_id: Optional[int] = Field(title="网络安全报告ID")
    product_id: Optional[int] = Field(title="产品ID")
    rcm_code: Optional[str] = Field(title="网络安全扫描RCM编号")
    description: Optional[str] = Field(title="控制措施描述")
    threat_codes: Optional[str] = Field(title="关联威胁编号串")
    verification_evidence: Optional[str] = Field(title="验证证据")
    new_risk_flag: Optional[int] = Field(title="是否引入新风险")
    note: Optional[str] = Field(title="备注")
