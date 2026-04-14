#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

import os
import json
import logging
from logging import basicConfig
from contextvars import ContextVar

logger = logging.getLogger(__name__)
LANGS = dict()
DEF_LANG = None


def init_add(lang:str, kvs:dict):
    LANGS[lang] = kvs


def init(i18n_dir, def_lang="en-US"):
    global DEF_LANG
    DEF_LANG = def_lang
    for file in os.listdir(i18n_dir):
        path = os.path.join(i18n_dir, file)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fp:
            try:
                kvs = json.load(fp)
                lang = os.path.splitext(os.path.basename(path))[0]
                init_add(lang, kvs)
                logger.info(path)
            except:
                logger.warning(path)


basicConfig(level=logging.INFO)
init("src-res/i18n/lang", def_lang="zh-CN")


class CtxLang(object):
    var: ContextVar = ContextVar(__name__, default=None)

    @classmethod
    def init(cls, lang: str):
        cls.var.set(lang)

    @classmethod
    def get(cls) -> str:
        return cls.var.get()


def lng():
    return CtxLang.get()


def ts(src:str, lang=None):
    if not src:
        logger.warning("src_null")
        return src
    lang = lang or CtxLang.get() or DEF_LANG
    kvs = LANGS.get(lang)
    if not kvs:
        logger.warning("kvs_null: %s %s", lang, src)
        return src
    node = kvs
    keys = src.split(".")
    for idx, key in enumerate(keys):
        value = node.get(key)
        if value is None:
            logger.warning("value_null: %s %s", lang, src)
            return src
        if idx + 1 == len(keys):
            if isinstance(value, str):
                return value
            else:
                logger.warning("value_err: %s %s", lang, src)
                return src
        else:
            if isinstance(value, dict):
                node = value
            else:
                logger.warning("value_err: %s %s", lang, src)
                return src
    logger.warning("keys_err: %s %s", lang, src)
    return src


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    init_add("zh-CN", {"name":"Name", "obj":{"name":"Object Name"}})

    CtxLang.init("zh-CN")

    logger.info(ts("name"))
    logger.info(ts("obj.name"))
    logger.info(ts(None))
    logger.info(ts(""))
    logger.info(ts("obj"))
    logger.info(ts("obj.xx"))
    logger.info(ts("tbis"))
    logger.info(ts("tbis.yy"))
