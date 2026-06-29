import asyncio, io, zipfile, re
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
        if not did:
            print("NO_DOC"); return
        print("export id", did)
        out = io.BytesIO()
        await srv.export_label_doc(out, did)
        out.seek(0)
        z = zipfile.ZipFile(out)
        xml = z.read('word/document.xml').decode('utf-8')
        media = [n for n in z.namelist() if n.startswith('word/media/')]
        tbl_count = xml.count('<w:tbl>')
        for key in ["文件修订记录","其他内容详见说明书","UDI 条形码","产品型号","dashed","page"]:
            print(key, "->", (key in xml) or (key=="page" and 'w:br' in xml))
        print("media", media, "tables", tbl_count)
asyncio.run(main())
