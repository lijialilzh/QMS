import asyncio, io, zipfile
from sqlalchemy import create_engine, select
import src.env as env
from src.utils import sql_ctx
from src.utils.sql_ctx import db
sql_ctx.init(create_engine(env.DB_URL))
from src.model.label_doc import LabelDoc
import src.serv.serv_label_doc as m
srv = m.Server()
async def main():
    with db():
        did = db.session.execute(select(LabelDoc.id).order_by(LabelDoc.id.desc())).scalars().first()
        out = io.BytesIO(); await srv.export_label_doc(out, did); out.seek(0)
        xml = zipfile.ZipFile(out).read('word/document.xml').decode('utf-8')
        for k in ["条形码","其他内容详见说明书","软件名称","U盘","技术要求","生效日期","注册人"]:
            print(k, k in xml)
asyncio.run(main())
