#!/usr/bin/env python
# encoding: utf-8


from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..obj import Resp
from ..serv.serv_ai_support import Server
from . import try_log

router = APIRouter()
server = Server()


class AskForm(BaseModel):
    question: str = Field(default="", description="用户提问")


@router.post("/ask", summary="AI客服问答", response_model=Resp[Any])
@try_log()
async def ask(form: AskForm):
    return await server.ask(form.question)
