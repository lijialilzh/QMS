#!/usr/bin/env python
# encoding: utf-8

from typing import Any, Optional
from pydantic import BaseModel, Field


class RiskMgmtDocForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    product_id: Optional[int] = Field(title="产品ID")
    version: Optional[str] = Field(title="文档版本")
    file_no: Optional[str] = Field(title="文件编号")
    change_log: Optional[str] = Field(title="版本变更说明")
    content: Optional[dict[str, Any]] = Field(title="文档内容")


class RiskParticipantForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    role: Optional[str] = Field(title="项目角色")
    name: Optional[str] = Field(title="姓名")


class RiskAnalysisForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    doc_id: Optional[int] = Field(title="风险管理报告ID")
    product_id: Optional[int] = Field(title="产品ID")
    haz_code: Optional[str] = Field(title="HAZ编号")
    source: Optional[str] = Field(title="危险源")
    event_sequence: Optional[str] = Field(title="事件序列")
    hazard_situation: Optional[str] = Field(title="危险情况")
    harm: Optional[str] = Field(title="伤害")
    init_rate: Optional[int] = Field(title="初始风险概率")
    init_degree: Optional[str] = Field(title="初始危害程度")
    init_level: Optional[str] = Field(title="初始风险水平")
    control_measures: Optional[str] = Field(title="风险控制措施")
    rcm_codes: Optional[str] = Field(title="RCM ID")
    verification_evidence: Optional[str] = Field(title="验证证据")
    residual_rate: Optional[int] = Field(title="剩余风险概率")
    residual_degree: Optional[str] = Field(title="剩余危害程度")
    residual_level: Optional[str] = Field(title="剩余风险水平")
    benefit_flag: Optional[int] = Field(title="收益是否大于风险")
    category: Optional[str] = Field(title="分类")


class RiskControlForm(BaseModel):
    id: Optional[int] = Field(title="ID")
    doc_id: Optional[int] = Field(title="风险管理报告ID")
    product_id: Optional[int] = Field(title="产品ID")
    rcm_code: Optional[str] = Field(title="RCM编号")
    description: Optional[str] = Field(title="控制措施描述")
    hazard_codes: Optional[str] = Field(title="关联HAZ编号")
    verification_evidence: Optional[str] = Field(title="验证证据")
    new_risk_flag: Optional[int] = Field(title="是否引入新风险")
    note: Optional[str] = Field(title="备注")
