#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from os import getenv
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(), override=True, verbose=True)

ADMIN_NAME = getenv("ADMIN_NAME", "master")
ADMIN_PWD = getenv("ADMIN_PWD", "test")

DB_URL = getenv("DB_URL", "postgresql://trace:test@127.0.0.1:5432/trace")
