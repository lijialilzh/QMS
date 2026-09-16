#!/usr/bin/env python
# encoding: utf-8


from pydantic import Field
from typing import Optional
from datetime import datetime
from .tobj_prod_algo_chapter import ProdAlgoChapterForm


class ProdAlgoChapterObj(ProdAlgoChapterForm):
    create_time: Optional[datetime] = Field(title="创建时间")