from datetime import datetime
from typing import Optional
from pydantic import Field
from .tobj_risk_mgmt_doc import RiskAnalysisForm, RiskControlForm, RiskMgmtDocForm


class RiskMgmtDocObj(RiskMgmtDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_full_version: Optional[str] = Field(title="完整版本")
    product_type_code: Optional[str] = Field(title="产品型号")
    create_time: Optional[datetime] = Field(title="创建时间")


class RiskAnalysisObj(RiskAnalysisForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_full_version: Optional[str] = Field(title="完整版本")
    doc_version: Optional[str] = Field(title="风险管理报告版本")
    create_time: Optional[datetime] = Field(title="创建时间")


class RiskControlObj(RiskControlForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_full_version: Optional[str] = Field(title="完整版本")
    doc_version: Optional[str] = Field(title="风险管理报告版本")
    create_time: Optional[datetime] = Field(title="创建时间")
