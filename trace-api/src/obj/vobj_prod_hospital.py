from pydantic import Field
from typing import Optional
from datetime import datetime
from .tobj_prod_hospital import ProdHospitalForm


class ProdHospitalObj(ProdHospitalForm):
    create_time: Optional[datetime] = Field(title="创建时间")
