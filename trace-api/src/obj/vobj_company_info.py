from pydantic import Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_company_info import CompanyInfoForm


class CompanyInfoObj(CompanyInfoForm):
    create_time: Optional[datetime] = Field(title="创建时间")
