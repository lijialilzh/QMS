import asyncio, io, zipfile
import src.serv.serv_label_doc as m
srv = m.Server()
async def main():
    lst = await srv.list_label_doc(page_index=0, page_size=5)
    rows = lst.data.rows if hasattr(lst.data,'rows') else lst.data
    print("count", len(rows))
    if not rows:
        print("NO_DOC"); return
    did = rows[0].id
    print("export id", did)
    out = io.BytesIO()
    await srv.export_label_doc(out, did)
    out.seek(0)
    z = zipfile.ZipFile(out)
    imgs = [n for n in z.namelist() if n.startswith('word/media/')]
    print("media", imgs)
asyncio.run(main())
