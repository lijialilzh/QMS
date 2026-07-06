from pydantic import Field
from datetime import datetime
from typing import Optional
from ..obj.tobj_person_sign import PersonSignForm


class PersonSignObj(PersonSignForm):
    create_time: Optional[datetime] = Field(title="创建时间")
