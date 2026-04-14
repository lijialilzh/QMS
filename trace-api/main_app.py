#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

import os
import argparse
import uvicorn
from logging.config import dictConfig
from dynaconf import Dynaconf
from src import create_app

os.makedirs('logs', exist_ok=True)
dictConfig(Dynaconf(settings_files=["src/logging.yml"]).logging)
app = create_app()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('-p', type=int, required=False, default=80, help='port')
    args = parser.parse_args()
    uvicorn.run("main_app:app", host='0.0.0.0', port=args.p, access_log=False, workers=4, limit_concurrency=1000)
