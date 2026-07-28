#\!/usr/bin/env python
# encoding: utf-8

# 文档整合导出接口层：按产品+版本聚合产品文件/开发文件/测试文件，支持整合导出(zip)与一键打印清单。
# 整合导出：勾选文档后，逐个调用各模块 serv.export_xxx_doc(output, id) 收集 docx，打包 zip 下载。

import io
import json
import urllib.parse
import zipfile
from datetime import datetime
from typing import Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from sqlalchemy import select

from ..obj import Resp
from ..obj.tobj_role import Perms
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from . import CtxUser, try_log

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
from ..model.utp_doc import UtpDoc
from ..model.utr_doc import UtrDoc
from ..model.teq_doc import TeqDoc

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
from ..serv.serv_utp_doc import Server as SrvUtp
from ..serv.serv_utr_doc import Server as SrvUtr
from ..serv.serv_teq_doc import Server as SrvTeq

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
    "ftr_doc": SrvFtr(), "ftr_record_doc": SrvFtrRecord(), "utp_doc": SrvUtp(), "utr_doc": SrvUtr(),
    "teq_doc": SrvTeq(),
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
    # bug_doc 无导出方法，暂不纳入整合导出
]


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
    groups = {"product_files": [], "dev_files": [], "test_files": []}
    for module_key, module_name, group, model_cls in _DOC_MODULES:
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
async def integrate_export(product_id: int, doc_keys: str):
    """doc_keys: 逗号分隔的 module_key:id 列表，如 pir_doc:2,pdp_doc:5"""
    if not product_id:
        return Resp.resp_err(msg="请选择产品")
    if not doc_keys:
        return Resp.resp_err(msg="请勾选要导出的文档")
    prod = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
    if not prod:
        return Resp.resp_err(msg="产品不存在")

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
            method_name = f"export_{module_key}"
            method = getattr(srv, method_name, None)
            if not method:
                failed.append(f"{module_key}:{doc_id}（无导出方法）")
                continue
            try:
                out = io.BytesIO()
                await method(out, doc_id)
                out.seek(0)
                safe_name = _build_doc_name(module_key, doc_id)
                # zipfile 默认 cp437 编码中文乱码，用 ZipInfo 显式设置 UTF-8 标志
                zi = zipfile.ZipInfo(safe_name, date_time=datetime.now().timetuple()[:6])
                zi.flag_bits |= 0x800  # UTF-8 文件名标志
                zi.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(zi, out.getvalue())
                success.append(safe_name)
            except Exception as e:
                failed.append(f"{module_key}:{doc_id}（{str(e)[:50]}）")

    zip_buf.seek(0)
    zip_size = len(zip_buf.getvalue())
    timestamp = datetime.now().strftime("%y%m%d.%H%M")
    prod_label = (prod.name or "product").replace("/", "_")
    raw_filename = f"整合导出-{prod_label}-{prod.full_version}-{timestamp}.zip"
    # RFC 5987: filename* 用 UTF-8 编码，浏览器会正确解码中文；filename 用 ASCII 兜底
    ascii_filename = f"integrate_export-{prod_label}-{prod.full_version}-{timestamp}.zip"
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


# 内存缓存打包结果（token -> (zip_bytes, filename, expire_ts)），5分钟TTL
import time
import uuid
_PACK_CACHE: dict = {}
_PACK_TTL = 300  # 5分钟


@router.get("/integrate_export_progress", summary="整合导出（SSE进度流）：边打包边推送进度")
@try_log(perm=Perms.product_view)
async def integrate_export_progress(product_id: int, doc_keys: str):
    """SSE 流式推送打包进度，每完成一个文档推送一条进度，最后推送下载token。
    前端用 EventSource 接收，拿到 token 后调 /integrate_download?token=xxx 下载 zip。
    """
    if not product_id or not doc_keys:
        return Resp.resp_err(msg="请选择产品并勾选文档")
    prod = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
    if not prod:
        return Resp.resp_err(msg="产品不存在")

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
                method = getattr(srv, f"export_{module_key}", None) if srv else None
                if not srv or not method:
                    failed.append(f"{module_key}:{doc_id}")
                    yield f"data: {json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'name': module_name, 'status': 'skip'}, ensure_ascii=False)}\n\n"
                    continue
                try:
                    out = io.BytesIO()
                    await method(out, doc_id)
                    out.seek(0)
                    safe_name = _build_doc_name(module_key, doc_id)
                    zi = zipfile.ZipInfo(safe_name, date_time=datetime.now().timetuple()[:6])
                    zi.flag_bits |= 0x800
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    zf.writestr(zi, out.getvalue())
                    success.append(safe_name)
                    yield f"data: {json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'name': module_name, 'status': 'ok'}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    failed.append(f"{module_key}:{doc_id}")
                    yield f"data: {json.dumps({'type': 'progress', 'idx': idx, 'total': total, 'name': module_name, 'status': 'fail', 'error': str(e)[:50]}, ensure_ascii=False)}\n\n"
        # 打包完成，缓存 zip，生成 token
        zip_buf.seek(0)
        zip_bytes = zip_buf.getvalue()
        token = uuid.uuid4().hex
        timestamp = datetime.now().strftime("%y%m%d.%H%M")
        prod_label = (prod.name or "product").replace("/", "_")
        raw_filename = f"整合导出-{prod_label}-{prod.full_version}-{timestamp}.zip"
        _PACK_CACHE[token] = (zip_bytes, raw_filename, time.time() + _PACK_TTL)
        # 清理过期缓存
        now = time.time()
        for k in list(_PACK_CACHE.keys()):
            if _PACK_CACHE[k][2] < now:
                del _PACK_CACHE[k]
        yield f"data: {json.dumps({'type': 'done', 'token': token, 'success': len(success), 'failed': len(failed), 'filename': raw_filename}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        content=event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/integrate_download", summary="整合导出下载：按token下载已打包的zip")
async def integrate_download(token: str):
    """前端 SSE 拿到 token 后，用此接口下载 zip。"""
    if not token or token not in _PACK_CACHE:
        return Resp.resp_err(msg="下载链接已过期或无效，请重新导出")
    zip_bytes, raw_filename, expire = _PACK_CACHE.pop(token)
    ascii_filename = raw_filename.replace("整合导出", "integrate_export")
    encoded = urllib.parse.quote(raw_filename)
    disposition = f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded}"
    return StreamingResponse(
        content=io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": disposition,
            "Content-Length": str(len(zip_bytes)),
        },
    )


@router.get("/one_click_print_list", summary="一键打印：返回选中文档的打印URL清单")
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
        view_path = f"/{module_key}/view/{doc_id}"
        module_name = next((m[1] for m in _DOC_MODULES if m[0] == module_key), module_key)
        items.append({"module_key": module_key, "module_name": module_name, "doc_id": doc_id, "view_path": view_path})
    return Resp.resp_ok(data={"items": items})
