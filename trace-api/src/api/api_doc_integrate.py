#\!/usr/bin/env python
# encoding: utf-8

# 文档整合导出接口层：按产品+版本聚合产品文件/开发文件/测试文件，支持整合导出(zip)与一键打印清单。
# 整合导出：勾选文档后，逐个调用各模块 serv.export_xxx_doc(output, id) 收集 docx，打包 zip 下载。

import io
import json
import asyncio
import urllib.parse
import zipfile
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from sqlalchemy import select, func

from ..obj import Resp, Page
from ..obj.tobj_role import Perms
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from . import CtxUser, CtxPerm, try_log

router = APIRouter()

from ..model.product import Product
from ..model.pir_doc import PirDoc
from ..model.pdp_doc import PdpDoc
from ..model.srs_doc import SrsDoc
from ..model.acc_doc import AccDoc
from ..model.release_note import ReleaseNote
from ..model.vuh_doc import VuhDoc
from ..model.ptr_doc import PtrDoc
from ..model.research_doc import ResearchDoc
from ..model.rmp_doc import RmpDoc
from ..model.pha_doc import PhaDoc
from ..model.nsr_doc import NsrDoc
from ..model.cyber_cap_doc import CyberCapDoc
from ..model.label_doc import LabelDoc
from ..model.nsmp_doc import NsmpDoc
from ..model.risk_mgmt_doc import RiskMgmtDoc
from ..model.scm_doc import ScmDoc
from ..model.scs_doc import ScsDoc
from ..model.sd_doc import SdDoc
from ..model.sds_doc import SdsDoc
from ..model.dem_doc import DemDoc
from ..model.crr_doc import CrrDoc
from ..model.dat_doc import DatDoc
from ..model.deq_doc import DeqDoc
from ..model.stp_doc import StpDoc
from ..model.str_doc import StrDoc
from ..model.tem_doc import TemDoc
from ..model.imm_doc import ImmDoc
from ..model.ftr_doc import FtrDoc
from ..model.ftr_record_doc import FtrRecordDoc
from ..model.train_record_doc import TrainRecordDoc
from ..model.utp_doc import UtpDoc
from ..model.utr_doc import UtrDoc
from ..model.teq_doc import TeqDoc
from ..model.cybersec_doc import CybersecDoc
from ..model.cybersec_plan_doc import CybersecPlanDoc

# serv 导入
from ..serv.serv_pir_doc import Server as SrvPir
from ..serv.serv_pdp_doc import Server as SrvPdp
from ..serv.serv_srs_doc import Server as SrvSrs
from ..serv.serv_acc_doc import Server as SrvAcc
from ..serv.serv_release_note import Server as SrvRelease
from ..serv.serv_vuh_doc import Server as SrvVuh
from ..serv.serv_ptr_doc import Server as SrvPtr
from ..serv.serv_research_doc import Server as SrvResearch
from ..serv.serv_rmp_doc import Server as SrvRmp
from ..serv.serv_pha_doc import Server as SrvPha
from ..serv.serv_nsr_doc import Server as SrvNsr
from ..serv.serv_cyber_cap_doc import Server as SrvCyberCap
from ..serv.serv_label_doc import Server as SrvLabel
from ..serv.serv_nsmp_doc import Server as SrvNsmp
from ..serv.serv_risk_mgmt_doc import Server as SrvRiskMgmt
from ..serv.serv_scm_doc import Server as SrvScm
from ..serv.serv_scs_doc import Server as SrvScs
from ..serv.serv_sd_doc import Server as SrvSd
from ..serv.serv_sds_doc import Server as SrvSds
from ..serv.serv_dem_doc import Server as SrvDem
from ..serv.serv_crr_doc import Server as SrvCrr
from ..serv.serv_dat_doc import Server as SrvDat
from ..serv.serv_deq_doc import Server as SrvDeq
from ..serv.serv_stp_doc import Server as SrvStp
from ..serv.serv_str_doc import Server as SrvStr
from ..serv.serv_tem_doc import Server as SrvTem
from ..serv.serv_imm_doc import Server as SrvImm
from ..serv.serv_ftr_doc import Server as SrvFtr
from ..serv.serv_ftr_record_doc import Server as SrvFtrRecord
from ..serv.serv_train_record_doc import Server as SrvTrainRecord
from ..serv.serv_utp_doc import Server as SrvUtp
from ..serv.serv_utr_doc import Server as SrvUtr
from ..serv.serv_teq_doc import Server as SrvTeq
from ..serv.serv_cybersec_doc import Server as SrvCybersec
from ..serv.serv_cybersec_plan_doc import Server as SrvCybersecPlan

# (module_key, module_name, group, model_cls, serv_instance, export_method_name, ext)
# bug_doc 无导出方法，跳过
_SERVERS = {
    "pir_doc": SrvPir(), "pdp_doc": SrvPdp(), "srs_doc": SrvSrs(), "acc_doc": SrvAcc(),
    "release_note": SrvRelease(), "vuh_doc": SrvVuh(), "ptr_doc": SrvPtr(), "research_doc": SrvResearch(),
    "rmp_doc": SrvRmp(), "pha_doc": SrvPha(), "nsr_doc": SrvNsr(), "cyber_cap_doc": SrvCyberCap(),
    "label_doc": SrvLabel(), "nsmp_doc": SrvNsmp(), "risk_mgmt_doc": SrvRiskMgmt(),
    "scm_doc": SrvScm(), "scs_doc": SrvScs(), "sd_doc": SrvSd(), "sds_doc": SrvSds(),
    "dem_doc": SrvDem(), "crr_doc": SrvCrr(), "dat_doc": SrvDat(), "deq_doc": SrvDeq(),
    "stp_doc": SrvStp(), "str_doc": SrvStr(), "tem_doc": SrvTem(), "imm_doc": SrvImm(),
    "ftr_doc": SrvFtr(), "ftr_record_doc": SrvFtrRecord(), "train_record_doc": SrvTrainRecord(), "utp_doc": SrvUtp(), "utr_doc": SrvUtr(),
    "teq_doc": SrvTeq,
    "cybersec_doc": SrvCybersec(), "cybersec_plan_doc": SrvCybersecPlan(),
    "srs_doc_trace": SrvSrs(),
}

# (module_key, module_name, group, model_cls)
_DOC_MODULES = [
    ("pir_doc", "产品立项报告", "product_files", PirDoc),
    ("pdp_doc", "产品开发计划", "product_files", PdpDoc),
    ("srs_doc", "需求规格说明", "product_files", SrsDoc),
    ("acc_doc", "产品验收记录", "product_files", AccDoc),
    ("release_note", "产品发布说明", "product_files", ReleaseNote),
    ("vuh_doc", "版本更新历史", "product_files", VuhDoc),
    ("ptr_doc", "产品技术要求", "product_files", PtrDoc),
    ("research_doc", "自研软件研究报告", "product_files", ResearchDoc),
    ("rmp_doc", "风险管理计划", "product_files", RmpDoc),
    ("pha_doc", "初步危害分析清单", "product_files", PhaDoc),
    ("nsr_doc", "自研软件网络安全研究报告", "product_files", NsrDoc),
    ("cyber_cap_doc", "网络安全能力分析", "product_files", CyberCapDoc),
    ("label_doc", "产品标签样稿", "product_files", LabelDoc),
    ("nsmp_doc", "网络安全维护计划", "product_files", NsmpDoc),
    ("risk_mgmt_doc", "风险管理报告", "product_files", RiskMgmtDoc),
    ("train_record_doc", "培训记录表", "product_files", TrainRecordDoc),
    ("scm_doc", "软件配置管理计划", "dev_files", ScmDoc),
    ("scs_doc", "软件配置状态报告", "dev_files", ScsDoc),
    ("sd_doc", "软件开发计划", "dev_files", SdDoc),
    ("sds_doc", "软件详细设计", "dev_files", SdsDoc),
    ("dem_doc", "开发环境维护说明", "dev_files", DemDoc),
    ("crr_doc", "代码审查记录", "dev_files", CrrDoc),
    ("dat_doc", "数据申请单", "dev_files", DatDoc),
    ("deq_doc", "开发设备清单", "dev_files", DeqDoc),
    ("stp_doc", "软件测试计划", "test_files", StpDoc),
    ("str_doc", "软件测试报告", "test_files", StrDoc),
    ("tem_doc", "测试环境维护说明", "test_files", TemDoc),
    ("imm_doc", "安装维护手册", "test_files", ImmDoc),
    ("ftr_doc", "现场测试规程", "test_files", FtrDoc),
    ("ftr_record_doc", "现场测试记录", "test_files", FtrRecordDoc),
    ("utp_doc", "用户测试计划", "test_files", UtpDoc),
    ("utr_doc", "用户测试报告", "test_files", UtrDoc),
    ("teq_doc", "测试设备清单", "test_files", TeqDoc),
    ("cybersec_doc", "网络安全风险管理报告", "cybersec_files", CybersecDoc),
    ("cybersec_plan_doc", "网络安全风险管理计划", "cybersec_files", CybersecPlanDoc),
    ("srs_doc_trace", "追溯分析", "trace_files", SrsDoc),
    # bug_doc 无导出方法，暂不纳入整合导出
]


# 模块key → 分组中文名映射
_GROUP_LABELS = {"product_files": "产品文件", "dev_files": "开发文件", "test_files": "测试文件", "cybersec_files": "网络安全文件", "trace_files": "追溯文件"}


def _build_zip_filename(prod, doc_keys: str) -> str:
    """按"产品名称_完整版本_产品/开发/测试文件_日期.zip"格式生成zip文件名。
    根据勾选文档涉及的分组，拼出"产品文件/开发文件/测试文件"部分。"""
    prod_name = (prod.name or "product").replace("/", "_").replace("\\", "_")
    full_ver = (prod.full_version or "").replace("/", "_")
    # 解析 doc_keys 里的 module_key，查所属分组
    groups_hit = []
    for item in (doc_keys or "").split(","):
        item = item.strip()
        if ":" not in item:
            continue
        mk = item.split(":", 1)[0]
        group = next((m[2] for m in _DOC_MODULES if m[0] == mk), None)
        if group and group not in groups_hit:
            groups_hit.append(group)
    # 按固定顺序排列
    ordered = []
    for g in ["product_files", "dev_files", "test_files", "cybersec_files", "trace_files"]:
        if g in groups_hit:
            ordered.append(_GROUP_LABELS[g])
    group_label = "+".join(ordered) if ordered else "文档"
    date_str = datetime.now().strftime("%Y%m%d")
    return f"{prod_name}_{full_ver}_{group_label}_{date_str}.zip"



def _build_doc_name(module_key: str, doc_id: int) -> str:
    """按"文件编号_文件名称_文档版本.docx"格式生成 zip 内文件名，严格遵守。
    缺失字段则跳过该段，保证文件名合法（替换非法字符 / \ : * ? " < > |）。"""
    module_name = next((m[1] for m in _DOC_MODULES if m[0] == module_key), module_key)
    model_cls = next((m[3] for m in _DOC_MODULES if m[0] == module_key), None)
    file_no = ""
    version = ""
    if model_cls:
        r = db.session.execute(select(model_cls).where(model_cls.id == doc_id)).scalars().first()
        if r:
            file_no = (getattr(r, "file_no", "") or "").strip()
            version = (getattr(r, "version", "") or "").strip()
    # 拼接：文件编号_文件名称_文档版本
    parts = []
    if file_no:
        parts.append(file_no)
    parts.append(module_name)
    if version:
        parts.append(version)
    name = "_".join(parts) + ".docx"
    # 替换文件名非法字符
    for ch in '/\\:*?"<>|':
        name = name.replace(ch, "_")
    return name



@router.get("/list_integrate_docs", summary="整合导出预览：按产品聚合所有文档清单")
@try_log(perm=Perms.product_view)
async def list_integrate_docs(product_id: int):
    if not product_id:
        return Resp.resp_err(msg="请选择产品")
    prod = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
    if not prod:
        return Resp.resp_err(msg="产品不存在")
    # 按用户权限过滤可见分组
    user_perms = CtxPerm.get()
    group_perm_map = {
        "product_files": "pir_doc_view",
        "dev_files": "scm_doc_view",
        "test_files": "stp_doc_view",
        "cybersec_files": "cybersec_doc_view",
        "trace_files": "srs_doc_view",
    }
    visible_groups = [g for g in ["product_files", "dev_files", "test_files", "cybersec_files", "trace_files"] if g not in group_perm_map or group_perm_map[g] in user_perms]
    groups = {g: [] for g in visible_groups}
    for module_key, module_name, group, model_cls in _DOC_MODULES:
        if group not in visible_groups:
            continue
        # 追溯分析：基于 SRS 文档列表，每个 SRS 文档对应一份追溯分析（排除软删占位）
        if module_key == "srs_doc_trace":
            rows = db.session.execute(
                select(SrsDoc).where(SrsDoc.product_id == product_id)
                .where(~SrsDoc.version.like("__deleted_srs__%"))
                .order_by(SrsDoc.id.desc())
            ).scalars().all()
            items = []
            for r in rows:
                items.append({
                    "id": r.id,
                    "module_key": module_key,
                    "module_name": module_name,
                    "group": group,
                    "version": getattr(r, "version", "") or "",
                    "file_no": getattr(r, "file_no", "") or "",
                    "change_log": getattr(r, "change_log", "") or "",
                    "create_time": str(getattr(r, "create_time", "") or ""),
                })
            groups[group].append({"module_key": module_key, "module_name": module_name, "docs": items})
            continue
        rows = db.session.execute(
            select(model_cls).where(model_cls.product_id == product_id).order_by(model_cls.id.desc())
        ).scalars().all()
        items = []
        for r in rows:
            items.append({
                "id": r.id,
                "module_key": module_key,
                "module_name": module_name,
                "group": group,
                "version": getattr(r, "version", "") or "",
                "file_no": getattr(r, "file_no", "") or "",
                "change_log": getattr(r, "change_log", "") or "",
                "create_time": str(getattr(r, "create_time", "") or ""),
            })
        groups[group].append({"module_key": module_key, "module_name": module_name, "docs": items})
    return Resp.resp_ok(data={
        "product_id": prod.id,
        "product_name": prod.name,
        "full_version": prod.full_version,
        "groups": groups,
    })


@router.get("/integrate_export", summary="整合导出：勾选文档打包zip")
@try_log(perm=Perms.product_view)
async def integrate_export(product_id: int, doc_keys: str, with_sign: bool = True):
    """doc_keys: 逗号分隔的 module_key:id 列表，如 pir_doc:2,pdp_doc:5
    with_sign: 是否带签名章（True=带签名，False=不带签名清空封面和评审记录签名）"""
    if not product_id:
        return Resp.resp_err(msg="请选择产品")
    if not doc_keys:
        return Resp.resp_err(msg="请勾选要导出的文档")
    prod = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
    if not prod:
        return Resp.resp_err(msg="产品不存在")

    # 设置签名模式（contextvar，仅影响本次导出请求）
    from ..serv.serv_review_util import set_export_sign_mode, restore_export_sign_mode
    sign_token = set_export_sign_mode(with_sign)
    zip_buf = io.BytesIO()
    success, failed = [], []
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in doc_keys.split(","):
            item = item.strip()
            if not item or ":" not in item:
                continue
            module_key, doc_id_str = item.split(":", 1)
            try:
                doc_id = int(doc_id_str)
            except ValueError:
                continue
            srv = _SERVERS.get(module_key)
            if not srv:
                failed.append(f"{module_key}:{doc_id}（不支持导出）")
                continue
            # 追溯分析：方法名 export_doc_trace，输出 xlsx
            if module_key == "srs_doc_trace":
                method = getattr(srv, "export_doc_trace", None)
            else:
                method = getattr(srv, f"export_{module_key}", None)
            if not method:
                failed.append(f"{module_key}:{doc_id}（无导出方法）")
                continue
            try:
                out = io.BytesIO()
                result = method(out, doc_id)
                if asyncio.iscoroutine(result):
                    await result
                out.seek(0)
                ext = "xlsx" if module_key == "srs_doc_trace" else "docx"
                safe_name = _build_doc_name(module_key, doc_id).replace(".docx", f".{ext}")
                # zipfile 默认 cp437 编码中文乱码，用 ZipInfo 显式设置 UTF-8 标志
                zi = zipfile.ZipInfo(safe_name, date_time=datetime.now().timetuple()[:6])
                zi.flag_bits |= 0x800  # UTF-8 文件名标志
                zi.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(zi, out.getvalue())
                success.append(safe_name)
            except Exception as e:
                failed.append(f"{module_key}:{doc_id}（{str(e)[:50]}）")

    # 恢复签名模式
    restore_export_sign_mode(sign_token)
    zip_buf.seek(0)
    zip_size = len(zip_buf.getvalue())
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    raw_filename = _build_zip_filename(prod, doc_keys)
    # RFC 5987: filename* 用 UTF-8 编码，浏览器会正确解码中文；filename 用 ASCII 兜底
    ascii_filename = raw_filename.encode("ascii", "ignore").decode("ascii") or "export.zip"
    if not ascii_filename.strip():
        ascii_filename = "export.zip"
    encoded = urllib.parse.quote(raw_filename)
    disposition = f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded}"
    return StreamingResponse(
        content=zip_buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": disposition,
            "Content-Length": str(zip_size),
        },
    )


# 临时文件缓存打包结果（多 worker 共享），用 token 作为文件名，5分钟TTL
import time
import uuid
import os
import tempfile
_PACK_TTL = 300  # 5分钟
_PACK_DIR = os.path.join(tempfile.gettempdir(), "qms_pack_cache")
os.makedirs(_PACK_DIR, exist_ok=True)


def _pack_path(token: str) -> str:
    return os.path.join(_PACK_DIR, f"{token}.zip")


def _pack_meta_path(token: str) -> str:
    return os.path.join(_PACK_DIR, f"{token}.meta")


@router.get("/integrate_export_progress", summary="整合导出（SSE进度流）：边打包边推送进度")
@try_log(perm=Perms.product_view)
async def integrate_export_progress(product_id: int, doc_keys: str, with_sign: bool = True):
    """SSE 流式推送打包进度，每完成一个文档推送一条进度，最后推送下载token。
    前端用 EventSource 接收，拿到 token 后调 /integrate_download?token=xxx 下载 zip。
    with_sign: 是否带签名章（True=带签名，False=不带签名清空封面和评审记录签名）。
    """
    if not product_id or not doc_keys:
        return Resp.resp_err(msg="请选择产品并勾选文档")
    prod = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
    if not prod:
        return Resp.resp_err(msg="产品不存在")

    # 设置签名模式（contextvar，仅影响本次导出请求）
    from ..serv.serv_review_util import set_export_sign_mode, restore_export_sign_mode
    sign_token = set_export_sign_mode(with_sign)

    # 在 SSE 生成器外部获取当前用户（ContextVar 在异步生成器中可能丢失）
    _op_user = CtxUser.get()
    _op_name = (_op_user.nick_name or _op_user.name or "") if _op_user else ""

    # 解析文档清单
    doc_list = []
    for item in doc_keys.split(","):
        item = item.strip()
        if not item or ":" not in item:
            continue
        module_key, doc_id_str = item.split(":", 1)
        try:
            doc_id = int(doc_id_str)
        except ValueError:
            continue
        doc_list.append((module_key, doc_id))
    total = len(doc_list)

    async def event_stream():
        # SSE: 先推送 total
        yield f"data: {json.dumps({'type': 'start', 'total': total}, ensure_ascii=False)}\n\n"
        zip_buf = io.BytesIO()
        success, failed = [], []
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for idx, (module_key, doc_id) in enumerate(doc_list, 1):
                module_name = next((m[1] for m in _DOC_MODULES if m[0] == module_key), module_key)
                srv = _SERVERS.get(module_key)
                # 追溯分析：方法名 export_doc_trace，输出 xlsx
                if module_key == "srs_doc_trace":
                    method = getattr(srv, "export_doc_trace", None) if srv else None
                else:
                    method = getattr(srv, f"export_{module_key}", None) if srv else None
                if not srv or not method:
                    failed.append(f"{module_key}:{doc_id}")
                    yield f"data: {json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'name': module_name, 'status': 'skip'}, ensure_ascii=False)}\n\n"
                    continue
                try:
                    out = io.BytesIO()
                    result = method(out, doc_id)
                    if asyncio.iscoroutine(result):
                        await result
                    out.seek(0)
                    # 追溯分析输出 xlsx，其他输出 docx
                    ext = "xlsx" if module_key == "srs_doc_trace" else "docx"
                    safe_name = _build_doc_name(module_key, doc_id).replace(".docx", f".{ext}")
                    zi = zipfile.ZipInfo(safe_name, date_time=datetime.now().timetuple()[:6])
                    zi.flag_bits |= 0x800
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    zf.writestr(zi, out.getvalue())
                    success.append(safe_name)
                    yield f"data: {json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'name': module_name, 'status': 'ok'}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    failed.append(f"{module_key}:{doc_id}")
                    yield f"data: {json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'name': module_name, 'status': 'fail', 'error': str(e)[:50]}, ensure_ascii=False)}\n\n"
        # 打包完成，写入临时文件（多 worker 共享），生成 token
        zip_buf.seek(0)
        zip_bytes = zip_buf.getvalue()
        token = uuid.uuid4().hex
        timestamp = datetime.now().strftime("%y%m%d.%H%M")
        raw_filename = _build_zip_filename(prod, doc_keys)
        # 写 zip 文件和元数据（文件名）到共享临时目录
        with open(_pack_path(token), "wb") as f:
            f.write(zip_bytes)
        with open(_pack_meta_path(token), "w", encoding="utf-8") as f:
            f.write(raw_filename)
        # 清理过期缓存文件
        now = time.time()
        for fn in os.listdir(_PACK_DIR):
            fp = os.path.join(_PACK_DIR, fn)
            try:
                if os.path.getmtime(fp) < now - _PACK_TTL:
                    os.remove(fp)
            except Exception:
                pass
        # 写导出记录
        try:
            from ..model.doc_record import DocExportRecord
            rec = DocExportRecord(
                product_id=prod.id, product_name=prod.name, full_version=prod.full_version,
                doc_count=total, success_count=len(success), fail_count=len(failed),
                filename=raw_filename, doc_names=", ".join(success[:50]), operator=_op_name,
            )
            db.session.add(rec)
            db.session.commit()
        except Exception:
            db.session.rollback()
        yield f"data: {json.dumps({'type': 'done', 'token': token, 'success': len(success), 'failed': len(failed), 'filename': raw_filename}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        content=event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/integrate_download", summary="整合导出下载：按token下载已打包的zip")
async def integrate_download(token: str):
    """前端 SSE 拿到 token 后，用此接口下载 zip。"""
    zip_path = _pack_path(token)
    meta_path = _pack_meta_path(token)
    if not token or not os.path.exists(zip_path):
        return Resp.resp_err(msg="下载链接已过期或无效，请重新导出")
    with open(meta_path, "r", encoding="utf-8") as f:
        raw_filename = f.read().strip()
    with open(zip_path, "rb") as f:
        zip_bytes = f.read()
    # 下载后删除临时文件
    try:
        os.remove(zip_path)
        os.remove(meta_path)
    except Exception:
        pass
    encoded = urllib.parse.quote(raw_filename)
    # ASCII 兜底文件名：移除所有非 ASCII 字符，避免 latin-1 编码失败
    ascii_filename = raw_filename.encode("ascii", "ignore").decode("ascii") or "export.zip"
    if not ascii_filename.strip():
        ascii_filename = "export.zip"
    disposition = f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded}"
    return StreamingResponse(
        content=io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": disposition,
            "Content-Length": str(len(zip_bytes)),
        },
    )


@router.get("/export_single_doc", summary="单文档导出：直接下载单个docx（带/不带签名）")
@try_log(perm=Perms.product_view)
async def export_single_doc(module_key: str, doc_id: int, with_sign: bool = True):
    """导出单个文档为 docx 并直接下载（不打包 zip）。
    with_sign: True=带签名，False=不带签名（清空封面和评审记录签名）。"""
    if not module_key or not doc_id:
        return Resp.resp_err(msg="参数无效")
    srv = _SERVERS.get(module_key)
    if not srv:
        return Resp.resp_err(msg=f"不支持的文档模块：{module_key}")
    # 追溯分析：方法名 export_doc_trace，输出 xlsx
    if module_key == "srs_doc_trace":
        method = getattr(srv, "export_doc_trace", None)
    else:
        method = getattr(srv, f"export_{module_key}", None)
    if not method:
        return Resp.resp_err(msg=f"模块 {module_key} 无导出方法")
    # 设置签名模式
    from ..serv.serv_review_util import set_export_sign_mode
    set_export_sign_mode(with_sign)
    try:
        out = io.BytesIO()
        result = method(out, doc_id)
        if asyncio.iscoroutine(result):
            await result
        out.seek(0)
    except Exception as e:
        return Resp.resp_err(msg=f"生成文档失败：{str(e)[:80]}")
    ext = "xlsx" if module_key == "srs_doc_trace" else "docx"
    safe_name = _build_doc_name(module_key, doc_id).replace(".docx", f".{ext}")
    encoded = urllib.parse.quote(safe_name)
    ascii_filename = safe_name.encode("ascii", "ignore").decode("ascii") or f"export.{ext}"
    media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if module_key == "srs_doc_trace" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    disposition = f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded}"
    # 写导出记录（单文档导出也记录）
    try:
        _op_user = CtxUser.get()
        _op_name = (_op_user.nick_name or _op_user.name or "") if _op_user else ""
        _model_cls = next((m[3] for m in _DOC_MODULES if m[0] == module_key), None)
        _prod_id = 0
        _prod_name = ""
        _full_ver = ""
        if _model_cls:
            _row = db.session.execute(select(_model_cls).where(_model_cls.id == doc_id)).scalars().first()
            if _row:
                _prod_id = getattr(_row, "product_id", 0) or 0
                _prod = db.session.execute(select(Product).where(Product.id == _prod_id)).scalars().first()
                if _prod:
                    _prod_name = _prod.name or ""
                    _full_ver = _prod.full_version or ""
        from ..model.doc_record import DocExportRecord
        rec = DocExportRecord(
            product_id=_prod_id, product_name=_prod_name, full_version=_full_ver,
            doc_count=1, success_count=1, fail_count=0,
            filename=safe_name, doc_names=safe_name, operator=_op_name,
        )
        db.session.add(rec)
        db.session.commit()
    except Exception:
        db.session.rollback()
    return StreamingResponse(
        content=out,
        media_type=media_type,
        headers={
            "Content-Disposition": disposition,
        },
    )
@try_log(perm=Perms.product_view)
async def one_click_print_list(product_id: int, doc_keys: str):
    """返回选中文档的可打印视图URL清单，前端逐个打开新窗口打印。"""
    if not product_id or not doc_keys:
        return Resp.resp_err(msg="请选择产品并勾选文档")
    items = []
    for item in doc_keys.split(","):
        item = item.strip()
        if not item or ":" not in item:
            continue
        module_key, doc_id_str = item.split(":", 1)
        try:
            doc_id = int(doc_id_str)
        except ValueError:
            continue
        # 各模块的查看页路由 path（与前端路由一致）
        module_name = next((m[1] for m in _DOC_MODULES if m[0] == module_key), module_key)
        # 追溯分析是 Excel，不支持打印预览，跳过
        if module_key == "srs_doc_trace":
            continue
        view_path = f"/{module_key}/view/{doc_id}"
        items.append({"module_key": module_key, "module_name": module_name, "doc_id": doc_id, "view_path": view_path})
    return Resp.resp_ok(data={"items": items})


# ===== 导出/打印记录 =====
from ..model.doc_record import DocExportRecord, DocPrintRecord


@router.get("/list_export_records", summary="查询导出记录")
@try_log(perm=Perms.product_view)
async def list_export_records(page_index: int = 0, page_size: int = 100):
    _op_user = CtxUser.get()
    _op_name = (_op_user.nick_name or _op_user.name or "") if _op_user else ""
    _is_admin = (_op_user and _op_user.id == 1)
    _where = [] if _is_admin else [DocExportRecord.operator == _op_name]
    total = db.session.execute(select(func.count(DocExportRecord.id)).where(*_where)).scalar() or 0
    rows = db.session.execute(
        select(DocExportRecord).where(*_where).order_by(DocExportRecord.id.desc())
        .offset(page_index * page_size).limit(page_size)
    ).scalars().all()
    return Resp.resp_ok(data=Page(total=total, rows=[{
        "id": r.id, "product_name": r.product_name or "", "full_version": r.full_version or "",
        "doc_count": r.doc_count or 0, "success_count": r.success_count or 0, "fail_count": r.fail_count or 0,
        "filename": r.filename or "", "doc_names": r.doc_names or "", "operator": r.operator or "", "create_time": str(r.create_time or ""),
    } for r in rows], page_index=page_index, page_size=page_size))


@router.get("/list_print_records", summary="查询打印记录")
@try_log(perm=Perms.product_view)
async def list_print_records(page_index: int = 0, page_size: int = 100):
    _op_user = CtxUser.get()
    _op_name = (_op_user.nick_name or _op_user.name or "") if _op_user else ""
    _is_admin = (_op_user and _op_user.id == 1)
    _where = [] if _is_admin else [DocPrintRecord.operator == _op_name]
    total = db.session.execute(select(func.count(DocPrintRecord.id)).where(*_where)).scalar() or 0
    rows = db.session.execute(
        select(DocPrintRecord).where(*_where).order_by(DocPrintRecord.id.desc())
        .offset(page_index * page_size).limit(page_size)
    ).scalars().all()
    return Resp.resp_ok(data=Page(total=total, rows=[{
        "id": r.id, "product_name": r.product_name or "", "full_version": r.full_version or "",
        "doc_count": r.doc_count or 0, "success_count": r.success_count or 0, "fail_count": r.fail_count or 0,
        "printer_name": r.printer_name or "", "doc_names": r.doc_names or "", "operator": r.operator or "", "create_time": str(r.create_time or ""),
    } for r in rows], page_index=page_index, page_size=page_size))


@router.post("/add_print_record", summary="记录一键打印操作")
@try_log(perm=Perms.product_view)
async def add_print_record(form: dict):
    """前端一键打印完成后调用，写入打印记录。"""
    from ..model.doc_record import DocPrintRecord
    try:
        _op_user = CtxUser.get()
        _op_name = (_op_user.nick_name or _op_user.name or "") if _op_user else ""
        rec = DocPrintRecord(
            product_id=int(form.get("product_id") or 0),
            product_name=form.get("product_name") or "",
            full_version=form.get("full_version") or "",
            doc_count=int(form.get("doc_count") or 0),
            success_count=int(form.get("success_count") or 0),
            fail_count=int(form.get("fail_count") or 0),
            printer_name=form.get("printer_name") or "",
            doc_names=form.get("doc_names") or "",
            operator=_op_name,
        )
        db.session.add(rec)
        db.session.commit()
        return Resp.resp_ok()
    except Exception:
        db.session.rollback()
        return Resp.resp_err(msg=ts("msg_err_db"))
