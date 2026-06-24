import json
import logging
from sqlalchemy import select
from ..model.prod_device_res import ProdDeviceRes
from ..obj.tobj_prod_device_res import ProdDeviceResForm
from ..obj.vobj_prod_device_res import ProdDeviceResObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Resp
from . import msg_err_db

logger = logging.getLogger(__name__)

# 设备资源模板默认值（取自标准《4. 设备资源》模板）。
DEFAULT_DEVICE_ITEMS = [
    {"use": "操作系统", "name": "Ubuntu24.04、Windows 10", "qty": "3"},
    {"use": "开发语言", "name": "Python、JavaScript、less、html", "qty": "4"},
    {"use": "数据库", "name": "PostgreSQL", "qty": "2"},
    {"use": "开发工具", "name": "VS Code", "qty": "1"},
    {"use": "测试工具", "name": "Chrome、JMeter、Nmap", "qty": "3"},
    {"use": "配置管理工具", "name": "Jira、GitLab、NextCloud、Nas", "qty": "4"},
    {"use": "开发设备", "name": "计算机", "qty": "7"},
    {"use": "测试设备", "name": "计算机", "qty": "2"},
    {"use": "生产设备", "name": "计算机", "qty": "1"},
    {"use": "检验设备", "name": "计算机", "qty": "1"},
]


def _parse_items(raw):
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
    except Exception:
        logger.exception("")
    return []


class Server(object):

    async def get_prod_device_res(self, prod_id: int):
        if not prod_id:
            return Resp.resp_err(msg=ts("msg_err_param"))
        row: ProdDeviceRes = db.session.execute(
            select(ProdDeviceRes).where(ProdDeviceRes.prod_id == prod_id)
        ).scalars().first()
        if row:
            return Resp.resp_ok(data=ProdDeviceResObj(
                id=row.id, prod_id=row.prod_id,
                items=_parse_items(row.items),
                create_time=row.create_time, update_time=row.update_time,
            ))
        # 未建记录：返回模板默认值供前端预填（不落库，首次保存才创建）
        return Resp.resp_ok(data=ProdDeviceResObj(
            prod_id=prod_id, items=[dict(it) for it in DEFAULT_DEVICE_ITEMS],
        ))

    async def save_prod_device_res(self, form: ProdDeviceResForm):
        try:
            if not form.prod_id:
                return Resp.resp_err(msg=ts("msg_err_param"))
            row: ProdDeviceRes = db.session.execute(
                select(ProdDeviceRes).where(ProdDeviceRes.prod_id == form.prod_id)
            ).scalars().first()
            if not row:
                row = ProdDeviceRes(prod_id=form.prod_id)
                db.session.add(row)
            row.items = json.dumps(form.items or [], ensure_ascii=False)
            db.session.commit()
            return Resp.resp_ok(data={"id": row.id})
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
