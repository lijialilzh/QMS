#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import uuid
import os
import json
from datetime import date, datetime


def get_uuid(spacer='-'):
    spacer = spacer if spacer else ''
    temp = spacer.join(['%s', '%s', '%s', '%s', '%s'])
    _id = uuid.uuid1()
    hex = '%032x' % _id.int
    return temp % (hex[20:], hex[16:20], hex[12:16], hex[8:12], hex[:8])


def read_line(path, default=None):
    if os.path.exists(path):
        with open(path, "r") as fp:
            return fp.readline().strip()
    return default


class DefaultEncoder(json.JSONEncoder):
    F_CN_TIME = '%Y-%m-%d %H:%M:%S'
    F_CN_DATE = '%Y-%m-%d'

    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.strftime(self.F_CN_TIME)
        elif isinstance(obj, date):
            return obj.strftime(self.F_CN_DATE)
        elif obj:
            return json.JSONEncoder.default(self, obj)
        else:
            return None
