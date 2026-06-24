from pydantic import Field
from typing import Optional
from datetime import datetime
from .tobj_prod_runtime_env import ProdRuntimeEnvForm


class ProdRuntimeEnvObj(ProdRuntimeEnvForm):
    create_time: Optional[datetime] = Field(title="创建时间")
    update_time: Optional[datetime] = Field(title="更新时间")
