#!/usr/bin/env python
# encoding: utf-8

# 产品版本复制时，按勾选的 DHF 联动复制各模块文档、测试集、图表文件。
# 规则对齐 docs/function_docs/14_产品管理.md §6.3 与 serv_review_util.COVER_KEYWORDS。

import copy
import importlib
import logging
import os
import re
from typing import Dict, List, Set, Tuple

from sqlalchemy import func, or_, select

from ..model.acc_doc import AccDoc
from ..model.bug_doc import BugDoc
from ..model.crr_doc import CrrDoc
from ..model.cyber_cap_doc import CyberCapDoc
from ..model.cybersec_doc import CybersecDoc
from ..model.cybersec_plan_doc import CybersecPlanDoc
from ..model.dat_doc import DatDoc
from ..model.deq_doc import DeqDoc
from ..model.dem_doc import DemDoc
from ..model.doc_file import DocFile
from ..model.ftr_doc import FtrDoc
from ..model.ftr_record_doc import FtrRecordDoc
from ..model.hld_doc import HldDoc
from ..model.imm_doc import ImmDoc
from ..model.label_doc import LabelDoc
from ..model.nsmp_doc import NsmpDoc
from ..model.nsr_doc import NsrDoc
from ..model.pdp_doc import PdpDoc
from ..model.pha_doc import PhaDoc
from ..model.pir_doc import PirDoc
from ..model.ptr_doc import PtrDoc
from ..model.release_note import ReleaseNote
from ..model.research_doc import ResearchDoc
from ..model.risk_mgmt_doc import RiskMgmtDoc
from ..model.rmp_doc import RmpDoc
from ..model.scm_doc import ScmDoc
from ..model.scs_doc import ScsDoc
from ..model.sd_doc import SdDoc
from ..model.sds_doc import SdsDoc
from ..model.srs_doc import SrsDoc
from ..model.str_doc import StrDoc
from ..model.stp_doc import StpDoc
from ..model.tem_doc import TemDoc
from ..model.teq_doc import TeqDoc
from ..model.test_case import TestCase
from ..model.test_set import TestSet
from ..model.train_record_doc import TrainRecordDoc
from ..model.utp_doc import UtpDoc
from ..model.utr_doc import UtrDoc
from ..model.vuh_doc import VuhDoc
from ..model.prod_dhf import ProdDhf
from ..model.product import Product
from ..obj import Resp, c_ok
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from .serv_review_util import COVER_KEYWORDS, _normalize_dhf_code, resolve_doc_file_no
from .serv_utils import new_version, sync_file_no_version

logger = logging.getLogger(__name__)

TARGET_DOC_VERSION = "A0"
# 与 serv_srs_doc.DELETED_SRS_VERSION_PREFIX 保持一致：软删 SRS 不参与版本复制
DELETED_SRS_VERSION_PREFIX = "__deleted_srs__"


def compact_full_version_suffix(full_version: str) -> str:
    """完整版本 2.0.0.1 → 2001（各段数字去前导零后拼接）。"""
    txt = str(full_version or "").strip()
    if not txt:
        return ""
    nums = []
    for part in txt.split("."):
        matched = re.search(r"\d+", part or "")
        if matched:
            nums.append(str(int(matched.group())))
    if nums:
        return "".join(nums)
    digits = re.sub(r"\D", "", txt)
    return digits


def apply_product_version_token(code: str, target_full_version: str) -> str:
    """同产品小版本复制：TX-TF 代号段追加 V+完整版本 compact，如 RUS → RUSV2001。"""
    raw = str(code or "").strip()
    if not raw or not target_full_version:
        return raw
    suffix = compact_full_version_suffix(target_full_version)
    if not suffix:
        return raw
    ver_tag = f"V{suffix}"
    parts = raw.split("-")
    if len(parts) >= 3 and parts[0].upper() == "TX" and parts[1].upper() == "TF":
        token = parts[2]
        base = re.sub(r"V\d+$", "", token, flags=re.I)
        if not base:
            return raw
        parts[2] = f"{base}{ver_tag}"
        return "-".join(parts)
    return raw

TEST_DOC_KEYS = {"stp", "str", "utp", "utr", "bug", "teq"}
CHART_TRIGGER_KEYS = {"srs", "sds", "hld"}

DOC_REGISTRY: List[Tuple[str, object, str, str, str]] = [
    ("srs", SrsDoc, "serv_srs_doc", "Server", "duplicate_srs_doc"),
    ("sds", SdsDoc, "serv_sds_doc", "Server", "duplicate_sds_doc"),
    ("sd", SdDoc, "serv_sd_doc", "Server", "duplicate_sd_doc"),
    ("crr", CrrDoc, "serv_crr_doc", "Server", "duplicate_crr_doc"),
    ("scm", ScmDoc, "serv_scm_doc", "Server", "duplicate_scm_doc"),
    ("scs", ScsDoc, "serv_scs_doc", "Server", "duplicate_scs_doc"),
    ("pdp", PdpDoc, "serv_pdp_doc", "Server", "duplicate_pdp_doc"),
    ("cybersec", CybersecDoc, "serv_cybersec_doc", "Server", "duplicate_cybersec_doc"),
    ("cybersec_plan", CybersecPlanDoc, "serv_cybersec_plan_doc", "Server", "duplicate_cybersec_plan_doc"),
    ("risk", RiskMgmtDoc, "serv_risk_mgmt_doc", "Server", "duplicate_risk_mgmt_doc"),
    ("rmp", RmpDoc, "serv_rmp_doc", "Server", "duplicate_rmp_doc"),
    ("pha", PhaDoc, "serv_pha_doc", "Server", "duplicate_pha_doc"),
    ("hld", HldDoc, "serv_hld_doc", "Server", "duplicate_hld_doc"),
    ("pir", PirDoc, "serv_pir_doc", "Server", "duplicate_pir_doc"),
    ("label", LabelDoc, "serv_label_doc", "Server", "duplicate_label_doc"),
    ("vuh", VuhDoc, "serv_vuh_doc", "Server", "duplicate_vuh_doc"),
    ("nsmp", NsmpDoc, "serv_nsmp_doc", "Server", "duplicate_nsmp_doc"),
    ("release_note", ReleaseNote, "serv_release_note", "Server", "duplicate_release_note"),
    ("nsr", NsrDoc, "serv_nsr_doc", "Server", "duplicate_nsr_doc"),
    ("research", ResearchDoc, "serv_research_doc", "Server", "duplicate_research_doc"),
    ("stp", StpDoc, "serv_stp_doc", "Server", "duplicate_stp_doc"),
    ("utp", UtpDoc, "serv_utp_doc", "Server", "duplicate_utp_doc"),
    ("utr", UtrDoc, "serv_utr_doc", "Server", "duplicate_utr_doc"),
    ("str", StrDoc, "serv_str_doc", "Server", "duplicate_str_doc"),
    ("imm", ImmDoc, "serv_imm_doc", "Server", "duplicate_imm_doc"),
    ("ftr", FtrDoc, "serv_ftr_doc", "Server", "duplicate_ftr_doc"),
    ("dem", DemDoc, "serv_dem_doc", "Server", "duplicate_dem_doc"),
    ("deq", DeqDoc, "serv_deq_doc", "Server", "duplicate_deq_doc"),
    ("acc", AccDoc, "serv_acc_doc", "Server", "duplicate_acc_doc"),
    ("dat", DatDoc, "serv_dat_doc", "Server", "duplicate_dat_doc"),
    ("teq", TeqDoc, "serv_teq_doc", "Server", "duplicate_teq_doc"),
    ("tem", TemDoc, "serv_tem_doc", "Server", "duplicate_tem_doc"),
    ("ptr", PtrDoc, "serv_ptr_doc", "Server", "duplicate_ptr_doc"),
    ("cyber_cap", CyberCapDoc, "serv_cyber_cap_doc", "Server", "duplicate_cyber_cap_doc"),
    ("train_record", TrainRecordDoc, "serv_train_record_doc", "Server", "duplicate_train_record_doc"),
    ("ftr_record", FtrRecordDoc, "serv_ftr_record_doc", "Server", "duplicate_ftr_record_doc"),
    ("bug", BugDoc, "serv_bug_doc", "Server", "duplicate_bug_doc"),
]


def _normalize_name(value) -> str:
    return re.sub(r"\s+", "", str(value or "").strip())


def _file_no_matches(dhf_code: str, doc_file_no: str) -> bool:
    base_dhf = _normalize_dhf_code(dhf_code)
    if not base_dhf:
        return False
    base_doc = _normalize_dhf_code(doc_file_no)
    if not base_doc:
        return False
    if base_doc == base_dhf:
        return True
    return base_doc.startswith(base_dhf)


def _dhf_name_doc_keys(dhf_name: str) -> Set[str]:
    name = _normalize_name(dhf_name)
    if not name:
        return set()
    keys = set()
    for doc_key, keywords in COVER_KEYWORDS.items():
        for kw in sorted(keywords, key=len, reverse=True):
            if _normalize_name(kw) and _normalize_name(kw) in name:
                keys.add(doc_key)
                break
    return keys


def _docs_for_dhf_in_module(dhf: ProdDhf, doc_key: str, module_docs: list):
    """名称确定模块；编号能匹配则只取匹配文档，否则取该模块全部文档，再由上层选最新一条。"""
    if doc_key not in _dhf_name_doc_keys(dhf.name):
        return []
    code_matched = [
        doc for doc in module_docs
        if _file_no_matches(dhf.code, getattr(doc, "file_no", "") or "")
    ]
    if code_matched:
        return code_matched
    return list(module_docs or [])


def _registry_by_key() -> Dict[str, Tuple[object, str, str, str]]:
    return {item[0]: item[1:] for item in DOC_REGISTRY}


def _version_seq(value) -> int:
    text = str(value or "")
    if text.startswith(DELETED_SRS_VERSION_PREFIX):
        return -1
    matched = re.search(r"(\d+)(?!.*\d)", text)
    return int(matched.group(1)) if matched else -1


def _pick_latest_doc(docs: list):
    if not docs:
        return None
    return max(
        docs,
        key=lambda doc: (_version_seq(getattr(doc, "version", "")), getattr(doc, "id", 0) or 0),
    )


def _model_by_doc_key(doc_key: str):
    for key, model, *_rest in DOC_REGISTRY:
        if key == doc_key:
            return model
    return None


def _extract_new_doc_id(resp) -> int:
    data = getattr(resp, "data", None)
    if data is None:
        return 0
    if isinstance(data, dict):
        return int(data.get("id") or 0)
    return int(getattr(data, "id", 0) or 0)


def _apply_target_version_a1(
    doc_key: str,
    doc_id: int,
    target_pid: int,
    same_name: bool = False,
    target_full_version: str = "",
):
    model = _model_by_doc_key(doc_key)
    if not model or not doc_id:
        return
    row = db.session.execute(select(model).where(model.id == doc_id)).scalars().first()
    if not row:
        return
    row.version = TARGET_DOC_VERSION
    base_no = getattr(row, "file_no", "") or ""
    if same_name and target_full_version:
        base_no = apply_product_version_token(base_no, target_full_version)
    resolved = resolve_doc_file_no(target_pid, base_no, TARGET_DOC_VERSION, doc_key)
    if resolved:
        row.file_no = resolved
    else:
        synced = sync_file_no_version(base_no, TARGET_DOC_VERSION)
        if synced:
            row.file_no = synced
    try:
        db.session.commit()
    except Exception:
        logger.exception("apply target version A0 failed key=%s id=%s", doc_key, doc_id)
        db.session.rollback()


def _list_docs(model, source_prod_id: int):
    if model is SdsDoc:
        srs_ids = select(SrsDoc.id).where(
            SrsDoc.product_id == source_prod_id,
            ~SrsDoc.version.like(f"{DELETED_SRS_VERSION_PREFIX}%"),
        )
        return db.session.execute(
            select(SdsDoc).where(or_(SdsDoc.product_id == source_prod_id, SdsDoc.srsdoc_id.in_(srs_ids)))
        ).scalars().all()
    q = select(model).where(model.product_id == source_prod_id)
    if model is SrsDoc:
        q = q.where(~SrsDoc.version.like(f"{DELETED_SRS_VERSION_PREFIX}%"))
    return db.session.execute(q).scalars().all()


async def _call_duplicate(doc_key: str, serv_module: str, serv_class: str, method_name: str, doc_id: int, target_pid: int):
    mod = importlib.import_module(f".{serv_module}", package=__package__)
    server = getattr(mod, serv_class)()
    method = getattr(server, method_name)
    if doc_key == "cybersec_plan":
        resp = method(doc_id, target_product_id=target_pid)
    else:
        resp = method(doc_id, product_id=target_pid)
    if hasattr(resp, "__await__"):
        resp = await resp
    return resp


async def _duplicate_bug_doc(doc_id: int, target_pid: int, same_name: bool = False, target_full_version: str = ""):
    fromdoc = db.session.execute(select(BugDoc).where(BugDoc.id == doc_id)).scalars().first()
    if not fromdoc:
        return Resp.resp_err(msg=ts("msg_obj_null"))
    version = TARGET_DOC_VERSION
    if target_pid == fromdoc.product_id:
        version = new_version(fromdoc.version)
    exists = db.session.execute(
        select(func.count(BugDoc.id)).where(BugDoc.product_id == target_pid, BugDoc.version == version)
    ).scalar() or 0
    if exists:
        return Resp.resp_err(msg=ts("msg_obj_exist"))
    newdoc = BugDoc(
        product_id=target_pid,
        version=version,
        file_no=sync_file_no_version(
            apply_product_version_token(fromdoc.file_no, target_full_version) if same_name else fromdoc.file_no,
            version,
        ) or resolve_doc_file_no(
            target_pid, fromdoc.file_no, version, "bug"
        ),
        change_log=fromdoc.change_log,
        file_name=fromdoc.file_name,
        file_path=fromdoc.file_path,
        file_data=fromdoc.file_data,
        stats=copy.deepcopy(fromdoc.stats) if fromdoc.stats else None,
    )
    try:
        db.session.add(newdoc)
        db.session.commit()
        return Resp.resp_ok()
    except Exception:
        logger.exception("")
        db.session.rollback()
    return Resp.resp_err()


def _copy_doc_files(source_prod_id: int, target_prod_id: int, source_product: Product, target_product: Product) -> int:
    rows = db.session.execute(select(DocFile).where(DocFile.product_id == source_prod_id)).scalars().all()
    copied = 0
    for row in rows:
        exists = db.session.execute(
            select(func.count(DocFile.id)).where(DocFile.product_id == target_prod_id, DocFile.category == row.category)
        ).scalar() or 0
        if exists:
            continue
        new_row = DocFile(product_id=target_prod_id, category=row.category)
        db.session.add(new_row)
        db.session.flush()
        src_path = str(row.file_url or "").strip()
        if not src_path or not os.path.exists(src_path):
            continue
        ext = os.path.splitext(src_path)[1] or ".png"
        dst_dir = os.path.join("data.trace", row.category or "doc")
        os.makedirs(dst_dir, exist_ok=True)
        dst_path = os.path.join(dst_dir, f"{new_row.id}{ext}")
        try:
            with open(src_path, "rb") as fs_in, open(dst_path, "wb") as fs_out:
                fs_out.write(fs_in.read())
        except Exception:
            logger.exception("copy doc_file %s", row.id)
            continue
        new_row.file_name = row.file_name
        new_row.file_size = row.file_size
        new_row.file_url = dst_path
        copied += 1
    if copied:
        db.session.commit()
    return copied


def _copy_test_sets(source_prod_id: int, target_prod_id: int) -> int:
    rows = db.session.execute(select(TestSet).where(TestSet.product_id == source_prod_id)).scalars().all()
    copied = 0
    for row in rows:
        exists = db.session.execute(
            select(func.count(TestSet.id)).where(TestSet.product_id == target_prod_id, TestSet.stage == row.stage)
        ).scalar() or 0
        if exists:
            continue
        new_set = TestSet(product_id=target_prod_id, stage=row.stage)
        db.session.add(new_set)
        db.session.flush()
        cases = db.session.execute(select(TestCase).where(TestCase.set_id == row.id)).scalars().all()
        for case in cases:
            payload = case.dict()
            payload.pop("id", None)
            payload["set_id"] = new_set.id
            db.session.add(TestCase(**payload))
        copied += 1
    if copied:
        db.session.commit()
    return copied


async def copy_dhf_linked_assets(
    source_prod_id: int,
    target_prod_id: int,
    dhf_rows: List[ProdDhf],
    same_name: bool = False,
    target_full_version: str = "",
) -> dict:
    if not dhf_rows:
        return {"dhf_count": 0, "doc_count": 0, "test_set_count": 0, "doc_file_count": 0}

    registry = _registry_by_key()
    matched_keys: Set[str] = set()
    docs_to_copy: List[Tuple[str, int]] = []

    for dhf in dhf_rows:
        matched_keys.update(_dhf_name_doc_keys(dhf.name))

    copy_order = ["srs", "sds"] + [k for k in registry.keys() if k not in ("srs", "sds")]

    for doc_key in copy_order:
        if doc_key not in registry:
            continue
        model, serv_module, serv_class, method_name = registry[doc_key]
        module_docs = _list_docs(model, source_prod_id)
        matched_map = {}
        for dhf in dhf_rows:
            for doc in _docs_for_dhf_in_module(dhf, doc_key, module_docs):
                matched_map[doc.id] = doc
        latest = _pick_latest_doc(list(matched_map.values()))
        if latest:
            docs_to_copy.append((doc_key, latest.id))

    doc_count = 0
    for doc_key, doc_id in docs_to_copy:
        model, serv_module, serv_class, method_name = registry[doc_key]
        try:
            if doc_key == "bug":
                resp = await _duplicate_bug_doc(doc_id, target_prod_id, same_name, target_full_version)
            else:
                resp = await _call_duplicate(doc_key, serv_module, serv_class, method_name, doc_id, target_prod_id)
                if resp and getattr(resp, "code", None) == c_ok:
                    new_id = _extract_new_doc_id(resp)
                    if new_id:
                        _apply_target_version_a1(
                            doc_key, new_id, target_prod_id, same_name, target_full_version
                        )
            if resp and getattr(resp, "code", None) == c_ok:
                doc_count += 1
            else:
                logger.warning("duplicate failed key=%s id=%s msg=%s", doc_key, doc_id, getattr(resp, "msg", ""))
        except Exception:
            logger.exception("duplicate key=%s id=%s", doc_key, doc_id)

    test_set_count = 0
    if matched_keys & TEST_DOC_KEYS:
        test_set_count = _copy_test_sets(source_prod_id, target_prod_id)

    doc_file_count = 0
    if matched_keys & CHART_TRIGGER_KEYS:
        source_product = db.session.execute(select(Product).where(Product.id == source_prod_id)).scalars().first()
        target_product = db.session.execute(select(Product).where(Product.id == target_prod_id)).scalars().first()
        if source_product and target_product:
            doc_file_count = _copy_doc_files(source_prod_id, target_prod_id, source_product, target_product)

    return {
        "dhf_count": len(dhf_rows),
        "doc_count": doc_count,
        "test_set_count": test_set_count,
        "doc_file_count": doc_file_count,
    }
