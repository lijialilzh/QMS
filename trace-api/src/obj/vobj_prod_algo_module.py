from pydantic import Field
from typing import Optional
from datetime import datetime
from .tobj_prod_algo_module import ProdAlgoModuleForm


class ProdAlgoModuleObj(ProdAlgoModuleForm):
    create_time: Optional[datetime] = Field(title="创建时间")
