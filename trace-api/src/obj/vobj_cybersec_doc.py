from datetime import datetime
from typing import Optional
from pydantic import Field
from .tobj_cybersec_doc import (
    CybersecControlInternalForm,
    CybersecControlSbomForm,
    CybersecControlScanForm,
    CybersecDocForm,
    CybersecThreatForm,
)


class CybersecDocObj(CybersecDocForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_version: Optional[str] = Field(title="产品版本")
    product_full_version: Optional[str] = Field(title="完整版本")
    product_type_code: Optional[str] = Field(title="产品型号")
    create_time: Optional[datetime] = Field(title="创建时间")


class CybersecThreatObj(CybersecThreatForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_full_version: Optional[str] = Field(title="完整版本")
    doc_version: Optional[str] = Field(title="网络安全报告版本")
    create_time: Optional[datetime] = Field(title="创建时间")


class CybersecControlInternalObj(CybersecControlInternalForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_full_version: Optional[str] = Field(title="完整版本")
    doc_version: Optional[str] = Field(title="网络安全报告版本")
    create_time: Optional[datetime] = Field(title="创建时间")


class CybersecControlSbomObj(CybersecControlSbomForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_full_version: Optional[str] = Field(title="完整版本")
    doc_version: Optional[str] = Field(title="网络安全报告版本")
    create_time: Optional[datetime] = Field(title="创建时间")


class CybersecControlScanObj(CybersecControlScanForm):
    product_name: Optional[str] = Field(title="产品名称")
    product_full_version: Optional[str] = Field(title="完整版本")
    doc_version: Optional[str] = Field(title="网络安全报告版本")
    create_time: Optional[datetime] = Field(title="创建时间")
