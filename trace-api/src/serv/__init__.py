import os
from ..utils import get_uuid

msg_err_db = "msg_err_db"


async def save_file(file_type, id: int, file, with_uid: bool = True):
    if not file:
        return None, None
    surfix = (os.path.splitext(file.filename)[1] or "").lower()
    if with_uid:
        path = os.path.join("data.trace", file_type, str(id),  get_uuid() + surfix)
    else:
        path = os.path.join("data.trace", file_type, str(id) + surfix)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bys = await file.read()
    with open(path, "wb") as fs:
        fs.write(bys)
    return len(bys), path
