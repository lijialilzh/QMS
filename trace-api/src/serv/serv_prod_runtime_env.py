import logging
from sqlalchemy import select
from ..model.prod_runtime_env import ProdRuntimeEnv
from ..obj.tobj_prod_runtime_env import ProdRuntimeEnvForm
from ..obj.vobj_prod_runtime_env import ProdRuntimeEnvObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Resp
from . import msg_err_db

logger = logging.getLogger(__name__)

# 运行环境模板默认值（取自标准《2.4 运行环境》模板）。
DEFAULT_RUNTIME_ENV = {
    "arch": "软件为B/S架构",
    "srv_cpu": "主频：至少为2GHz\n核心数：10核及以上\n指令集：x86指令集",
    "srv_memory": "容量至少为64G",
    "srv_gpu": "厂商：英伟达\n显存：至少8GB\nFP16计算性能：14TFLOPS",
    "srv_disk": "系统盘：至少为500GB\n存储盘：至少为3TB",
    "srv_nic": "千兆 PCI-E 网卡（支持 Linux 系统）",
    "srv_os": "Ubuntu 24.04LTS（64位）",
    "srv_cuda": "12.6",
    "cli_cpu": "英特尔酷睿 i5及以上",
    "cli_memory": "至少16GB",
    "cli_resolution": "1920*1080",
    "cli_os": "Windows 10 专业版（64位）及兼容版本",
    "cli_browser": "Chrome 137.0 及兼容版本",
    "net_lan": "100Mbps 及以上",
    "net_wan": "1000Mbps 及以上",
}

# 允许写入的字段（排除 id / prod_id）
_EDITABLE_FIELDS = list(DEFAULT_RUNTIME_ENV.keys())


def copy_prod_runtime_env_for_product(source_prod_id: int, target_prod_id: int) -> bool:
    """产品复制时：若源产品已保存运行环境，则为目标产品复制一份（目标已有则跳过）。"""
    if not source_prod_id or not target_prod_id or source_prod_id == target_prod_id:
        return False
    target_exists = db.session.execute(
        select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == target_prod_id)
    ).scalars().first()
    if target_exists:
        return False
    source = db.session.execute(
        select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == source_prod_id)
    ).scalars().first()
    if not source:
        return False
    new_row = ProdRuntimeEnv(prod_id=target_prod_id)
    for key in _EDITABLE_FIELDS:
        setattr(new_row, key, getattr(source, key, None))
    db.session.add(new_row)
    return True


class Server(object):

    async def get_prod_runtime_env(self, prod_id: int):
        if not prod_id:
            return Resp.resp_err(msg=ts("msg_err_param"))
        row: ProdRuntimeEnv = db.session.execute(
            select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == prod_id)
        ).scalars().first()
        if row:
            return Resp.resp_ok(data=ProdRuntimeEnvObj(**row.dict()))
        # 未建记录：返回模板默认值供前端预填（不落库，首次保存才创建）
        data = dict(DEFAULT_RUNTIME_ENV)
        data["prod_id"] = prod_id
        return Resp.resp_ok(data=ProdRuntimeEnvObj(**data))

    async def save_prod_runtime_env(self, form: ProdRuntimeEnvForm):
        try:
            if not form.prod_id:
                return Resp.resp_err(msg=ts("msg_err_param"))
            row: ProdRuntimeEnv = db.session.execute(
                select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == form.prod_id)
            ).scalars().first()
            if not row:
                row = ProdRuntimeEnv(prod_id=form.prod_id)
                db.session.add(row)
            payload = form.dict()
            for key in _EDITABLE_FIELDS:
                if key in payload:
                    setattr(row, key, payload[key])
            db.session.commit()
            return Resp.resp_ok(data={"id": row.id})
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
