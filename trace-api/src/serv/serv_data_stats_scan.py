# 数据统计：从服务器目录读 DICOM 头。口径对齐前端 dataStatsLocal.ts / 101。

import json
import os
import re
import struct
from concurrent.futures import ThreadPoolExecutor, as_completed

HEADER_BYTES = 512 * 1024
SKIP_EXT = re.compile(r"\.(txt|json|xml|csv|xlsx|xls|png|jpg|jpeg|gif|bmp|html|md|zip|pdf)$", re.I)
SERIES_RE = re.compile(
    r"^(dicom|dicomdir|images|image|data|s\d+|ser\d*|series\d*|st\d+|se\d*|im\d+)$"
    r"|^\d+\.\d+\.\d+"
    r"|abdomen|thorax|chest|lung|pelvis|brain|head|neck|monitor|scout|localizer|topogram"
    r"|br\d+|dcm$|_\d+_\d+_",
    re.I,
)
LONG_VR = {"OB", "OW", "OF", "SQ", "UT", "UN", "OD", "OL", "UC", "UR", "OV"}
HOST_PATH = re.compile(r"^[\w.-]+:(/.*)$")
KIND_SEC = {"raw": "原始", "base": "基础", "ann": "标注"}

TAGS = [
    (0x00100020, "PatientID", "LO", "none"),
    (0x0020000E, "SeriesInstanceUID", "UI", "none"),
    (0x00080020, "study date", "DA", "none"),
    (0x00080050, "ACC NO", "SH", "none"),
    (0x00100040, "SEX", "CS", None),
    (0x00080070, "DEVICE", "LO", "none"),
    (0x00181210, "ConvolutionKernel", "SH", "none"),
    (0x0008103E, "Series Description", "LO", "none"),
    (0x00081090, "ManufacturerModelName", "LO", "none"),
    (0x00185100, "PatientPosition", "CS", "none"),
    (0x00180015, "Body Part Examined", "CS", "none"),
    (0x00280004, "PhotometricInterpretation", "CS", "none"),
    (0x00101010, "AGE", "AS", None),
    (0x00180060, "KVP", "DS", -1),
    (0x00180050, "THICKNESS", "DS", 1.0),
    (0x00280011, "Columns", "US", 9999),
    (0x00280010, "Rows", "US", 9999),
    (0x00200011, "SeriesNumber", "IS", 9999),
    (0x00189345, "CTDIvol", "FD", 9999),
    (0x00181152, "Exposure", "IS", 9999),
    (0x00200037, "ImageOrientation", "DS", "none"),
    (0x00280030, "PixelSpacing", "DS", 9999),
    (0x00180088, "SpacingBetweenSlices", "DS", 9999),
]
# 病例明细最终保留的列（docs/function_docs/101）：解析/合并用全量头，输出行只留这些 + 统计用小写辅助字段。
KEEP_ROW_KEYS = {
    "TXID", "PatientID", "SeriesInstanceUID", "SEX", "DEVICE", "ConvolutionKernel",
    "PhotometricInterpretation", "AGE", "KVP", "THICKNESS", "PixelSpacing",
    "study date", "ACC NO", "image slices", "医院", "_key",
    "sex", "age", "device", "kvp", "thickness",
}
VR_OF = {t[0]: t[2] for t in TAGS}
VR_OF[0x00100030] = "DA"
VR_OF[0x00020010] = "UI"
WANT = {t[0]: t[1] for t in TAGS}
WANT[0x00100030] = "PatientBirthDate"
WANT[0x00100010] = "PatientName"

TAG_ITEM = 0xFFFEE000
TAG_ITEM_DELIM = 0xFFFEE00D
TAG_SEQ_DELIM = 0xFFFEE0DD
TAG_PIXEL = 0x7FE00010
TAG_META_LEN = 0x00020000
TAG_TS = 0x00020010
PYDICOM_ATTR = {
    "PatientID": "PatientID",
    "SeriesInstanceUID": "SeriesInstanceUID",
    "study date": "StudyDate",
    "ACC NO": "AccessionNumber",
    "SEX": "PatientSex",
    "DEVICE": "Manufacturer",
    "ConvolutionKernel": "ConvolutionKernel",
    "Series Description": "SeriesDescription",
    "ManufacturerModelName": "ManufacturerModelName",
    "PatientPosition": "PatientPosition",
    "Body Part Examined": "BodyPartExamined",
    "PhotometricInterpretation": "PhotometricInterpretation",
    "AGE": "PatientAge",
    "KVP": "KVP",
    "THICKNESS": "SliceThickness",
    "Columns": "Columns",
    "Rows": "Rows",
    "SeriesNumber": "SeriesNumber",
    "CTDIvol": "CTDIvol",
    "Exposure": "Exposure",
    "ImageOrientation": "ImageOrientationPatient",
    "PixelSpacing": "PixelSpacing",
    "SpacingBetweenSlices": "SpacingBetweenSlices",
    "WindowWidth": "WindowWidth",
    "WindowCenter": "WindowCenter",
    "PatientBirthDate": "PatientBirthDate",
}


def resolve_stats_path(raw):
    s = str(raw or "").strip()
    if not s or "\x00" in s or len(s) > 1024:
        return ""
    parts = re.split(r"[\\/]+", s)
    if any(p == ".." for p in parts):
        return ""
    m = HOST_PATH.match(s)
    cand = m.group(1) if m else s
    if os.path.isdir(cand):
        return os.path.abspath(cand)
    return ""


def strip_host(raw):
    s = str(raw or "").strip()
    m = HOST_PATH.match(s)
    return m.group(1) if m else s


def host_of(raw):
    s = str(raw or "").strip()
    m = HOST_PATH.match(s)
    return m.group(0).split(":", 1)[0] if m else ""


def common_parent_paths(paths):
    items = [str(p or "").strip() for p in (paths or []) if str(p or "").strip()]
    if not items:
        return ""
    locals_ = [strip_host(p) for p in items]
    try:
        common = os.path.commonpath(locals_)
    except ValueError:
        common = locals_[0]
    host = host_of(items[0])
    if host and common.startswith("/"):
        return f"{host}:{common}"
    return common


def _strip_title(title):
    return re.sub(r"^\s*\d+(?:\.\d+)*[、.\s]*", "", str(title or "")).strip()


def paths_from_dd010(content, kind):
    key = KIND_SEC.get(kind or "raw", "原始")
    found = []

    def walk(nodes):
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            title = _strip_title(n.get("title"))
            if title == key or title.startswith(key):
                for tb in n.get("tables") or []:
                    found.extend(_path_cells(tb))
            walk(n.get("children") or [])

    walk((content or {}).get("sections") or [])
    return found


def _path_cells(tb):
    if not isinstance(tb, list):
        return []
    col = -1
    start = -1
    for i, row in enumerate(tb):
        if not isinstance(row, list):
            continue
        for j, cell in enumerate(row):
            if str(cell or "").strip() == "存储路径":
                col = j
                start = i + 1
                break
        if col >= 0:
            break
    if col < 0:
        return []
    out = []
    for row in tb[start:]:
        if not isinstance(row, list):
            continue
        blob = "".join(str(c or "") for c in row)
        if "签字" in blob or "记录人" in blob or "复核人" in blob:
            continue
        val = str(row[col] if col < len(row) else "").strip()
        if val:
            out.append(val)
    return out


def is_dicom_name(name):
    if not name or re.match(r"^DICOMDIR$", name, re.I):
        return False
    if SKIP_EXT.search(name):
        return False
    return True


def file_rank(name):
    lower = name.lower()
    if lower.endswith(".dcm") or lower.endswith(".dicom"):
        return 0
    if lower.endswith(".ima") or lower.endswith(".img"):
        return 1
    if "." not in name:
        return 2
    return 3


def is_series_folder(name):
    n = str(name or "").strip()
    return bool(n) and bool(SERIES_RE.search(n))


def case_key(dir_parts):
    parts = list(dir_parts)
    end = len(parts)
    while end > 2 and is_series_folder(parts[end - 1]):
        end -= 1
    return "/".join(parts[: max(1, end)]) or "_root"


def collect_case_files(root):
    grouped = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        rel = os.path.relpath(dirpath, root)
        parts = [] if rel in (".", "") else rel.split(os.sep)
        if any(p.startswith(".") for p in parts):
            continue
        files = [f for f in filenames if is_dicom_name(f) and not f.startswith(".")]
        if not files:
            continue
        key = case_key(parts)
        grouped.setdefault(key, [])
        for name in files:
            grouped[key].append(os.path.join(dirpath, name))
    for key, files in grouped.items():
        files.sort(key=lambda p: (file_rank(os.path.basename(p)), os.path.basename(p)))
        grouped[key] = files
    return grouped


def _u16(buf, off, le):
    if off + 2 > len(buf):
        return 0
    return struct.unpack_from("<H" if le else ">H", buf, off)[0]


def _u32(buf, off, le):
    if off + 4 > len(buf):
        return 0
    return struct.unpack_from("<I" if le else ">I", buf, off)[0]


def _i16(buf, off, le):
    return struct.unpack_from("<h" if le else ">h", buf, off)[0]


def _i32(buf, off, le):
    return struct.unpack_from("<i" if le else ">i", buf, off)[0]


def _f32(buf, off, le):
    return struct.unpack_from("<f" if le else ">f", buf, off)[0]


def _f64(buf, off, le):
    return struct.unpack_from("<d" if le else ">d", buf, off)[0]


def _cstr(buf, off, length):
    end = min(len(buf), off + max(0, length))
    raw = buf[off:end]
    if 0 in raw:
        raw = raw[: raw.index(0)]
    return raw.decode("latin-1", "ignore").rstrip().strip()


def _read_value(vr, buf, off, length, le):
    if length <= 0:
        return ""
    if vr == "US" and length >= 2:
        return str(_u16(buf, off, le))
    if vr == "UL" and length >= 4:
        return str(_u32(buf, off, le))
    if vr == "SS" and length >= 2:
        return str(_i16(buf, off, le))
    if vr == "SL" and length >= 4:
        return str(_i32(buf, off, le))
    if vr == "FL" and length >= 4:
        return str(_f32(buf, off, le))
    if vr == "FD" and length >= 8:
        return str(_f64(buf, off, le))
    return _cstr(buf, off, length)


def _is_dicm(buf):
    return len(buf) >= 132 and buf[128:132] == b"DICM"


def parse_dicom_tags(buf):
    out = {}
    if len(buf) < 8:
        return out

    def is_delim(tag):
        return tag in (TAG_ITEM, TAG_ITEM_DELIM, TAG_SEQ_DELIM)

    def read_hdr(o, expl, le):
        if o + 8 > len(buf):
            return None
        tag = ((_u16(buf, o, le) << 16) | _u16(buf, o + 2, le)) & 0xFFFFFFFF
        if is_delim(tag):
            return tag, "", _u32(buf, o + 4, le), o + 8
        if expl:
            vr = chr(buf[o + 4]) + chr(buf[o + 5])
            if vr in LONG_VR:
                if o + 12 > len(buf):
                    return None
                return tag, vr, _u32(buf, o + 8, le), o + 12
            return tag, vr, _u16(buf, o + 6, le), o + 8
        return tag, VR_OF.get(tag, ""), _u32(buf, o + 4, le), o + 8

    def skip_sq(start, expl, le, seq_len):
        if seq_len != 0xFFFFFFFF:
            return start + max(0, seq_len)
        o = start
        while o + 8 <= len(buf):
            h = read_hdr(o, expl, le)
            if not h:
                return len(buf)
            tag, vr, ln, val_off = h
            if tag == TAG_SEQ_DELIM:
                return val_off
            if tag == TAG_ITEM:
                o = skip_item(val_off, expl, le) if ln == 0xFFFFFFFF else val_off + max(0, ln)
                continue
            if vr == "SQ" or ln == 0xFFFFFFFF:
                o = skip_sq(val_off, expl, le, ln)
            else:
                o = val_off + max(0, ln)
        return len(buf)

    def skip_item(start, expl, le):
        o = start
        while o + 8 <= len(buf):
            h = read_hdr(o, expl, le)
            if not h:
                return len(buf)
            tag, vr, ln, val_off = h
            if tag == TAG_ITEM_DELIM:
                return val_off
            if vr == "SQ" or ln == 0xFFFFFFFF:
                o = skip_sq(val_off, expl, le, ln)
            else:
                o = val_off + max(0, ln)
        return len(buf)

    def walk(start, expl, le, take, only_group=None):
        o = start
        ts = ""
        meta_end = -1
        while o + 8 <= len(buf):
            h = read_hdr(o, expl, le)
            if not h:
                break
            tag, vr, ln, val_off = h
            group = (tag >> 16) & 0xFFFF
            if only_group is not None and group != only_group:
                break
            if tag in (TAG_PIXEL, TAG_SEQ_DELIM, TAG_ITEM_DELIM):
                break
            if tag == TAG_ITEM:
                o = skip_item(val_off, expl, le) if ln == 0xFFFFFFFF else val_off + max(0, ln)
                continue
            if vr == "SQ" or ln == 0xFFFFFFFF:
                o = skip_sq(val_off, expl, le, ln)
                continue
            if ln < 0 or val_off + ln > len(buf):
                break
            key = WANT.get(tag)
            if take and key and ln <= 2048 and key not in out:
                use_vr = vr or VR_OF.get(tag, "LO")
                v = _read_value(use_vr, buf, val_off, ln, le)
                if v:
                    out[key] = v
            if tag == TAG_TS:
                ts = _read_value("UI", buf, val_off, ln, le)
            if tag == TAG_META_LEN and ln >= 4:
                meta_end = val_off + ln + _u32(buf, val_off, le)
            o = val_off + ln
            if meta_end >= 0 and o >= meta_end:
                break
        return meta_end if meta_end >= 0 else o, ts

    off = 132 if _is_dicm(buf) else 0
    little = True
    explicit = True
    if off + 6 <= len(buf) and _u16(buf, off, True) == 2:
        nxt, ts = walk(off, True, True, False, 2)
        off = nxt
        ts = (ts or "").replace("\0", "").strip()
        if ts == "1.2.840.10008.1.2":
            explicit = False
        elif ts == "1.2.840.10008.1.2.2":
            little = False
            explicit = True
    walk(off, explicit, little, True)
    return out


def _ds_text(val):
    if val is None:
        return ""
    if isinstance(val, (list, tuple)):
        return "\\".join(str(x) for x in val)
    return str(val)


def read_tags_pydicom(path):
    try:
        import pydicom
    except Exception:
        return None
    try:
        ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
    except Exception:
        return None
    out = {}
    for key, attr in PYDICOM_ATTR.items():
        try:
            v = getattr(ds, attr, None)
        except Exception:
            v = None
        if v is None:
            continue
        text = _ds_text(v).strip()
        if text:
            out[key] = text
    return out or None


def read_tags_file(path):
    tags = read_tags_pydicom(path)
    if tags:
        return tags
    try:
        with open(path, "rb") as f:
            buf = f.read(HEADER_BYTES)
        return parse_dicom_tags(buf)
    except Exception:
        return {}


def parse_age(raw):
    m = re.search(r"(\d+)", str(raw or ""))
    if not m:
        return None
    n = int(m.group(1))
    return n if n < 1000 else None


def parse_thickness(raw, default):
    s = str(raw or "").strip()
    if re.search(r"mm$", s, re.I):
        s = s[:-2].strip()
    if not s:
        return default
    inner = s.strip("[]").strip()
    if re.search(r"[-~～—至]", inner) and not re.match(r"^-?\d+(\.\d+)?$", inner):
        compact = re.sub(r"\s*至\s*", "-", inner)
        compact = re.sub(r"[～—~]", "-", compact)
        compact = re.sub(r"\s+", "", compact)
        return "[%s]" % compact
    try:
        return float(s)
    except Exception:
        return default


def age_from_dates(birth, study):
    b = re.sub(r"\D", "", str(birth or ""))
    s = re.sub(r"\D", "", str(study or ""))
    if len(b) < 8 or len(s) < 8:
        return None
    by, bm, bd = int(b[0:4]), int(b[4:6]), int(b[6:8])
    sy, sm, sd = int(s[0:4]), int(s[4:6]), int(s[6:8])
    if not by or not sy:
        return None
    age = sy - by
    if sm < bm or (sm == bm and sd < bd):
        age -= 1
    return age if 0 <= age < 150 else None


def merge_ww_wc(ww, wc):
    if not ww and not wc:
        return "none"
    wws = str(ww).split("\\")
    wcs = str(wc).split("\\")
    n = max(len(wws), len(wcs))
    pairs = [[wcs[i] if i < len(wcs) else "", wws[i] if i < len(wws) else ""] for i in range(n)]
    return json.dumps(pairs, ensure_ascii=False)


def tags_to_row(tags):
    if not tags:
        return None
    row = {}
    lookup = {t[1]: t for t in TAGS}
    for key, _vr, default in [(t[1], t[2], t[3]) for t in TAGS]:
        raw = tags.get(key)
        if raw is None or raw == "":
            if default is not None:
                row[key] = default
            continue
        if key == "AGE":
            age = parse_age(raw)
            if age is not None:
                row["AGE"] = age
            continue
        if key == "THICKNESS":
            row[key] = parse_thickness(raw, lookup[key][3])
            continue
        if key in ("KVP", "CTDIvol", "SpacingBetweenSlices"):
            try:
                row[key] = float(raw)
            except Exception:
                row[key] = lookup[key][3]
            continue
        if key == "PixelSpacing":
            try:
                row[key] = float(str(raw).split("\\")[0])
            except Exception:
                row[key] = lookup[key][3]
            continue
        row[key] = raw
    if row.get("AGE") is None:
        age = age_from_dates(tags.get("PatientBirthDate"), tags.get("study date"))
        if age is not None:
            row["AGE"] = age
    row["wc_ww"] = merge_ww_wc(tags.get("WindowWidth") or "", tags.get("WindowCenter") or "")
    row["sex"] = row.get("SEX") or ""
    row["age"] = row.get("AGE")
    device = row.get("DEVICE")
    row["device"] = device if device and device != "none" else ""
    row["kvp"] = "" if row.get("KVP") is None else str(row.get("KVP"))
    row["thickness"] = "" if row.get("THICKNESS") is None else str(row.get("THICKNESS"))
    # 输出行只保留指定列（+合并用内部字段），其余删除
    return {k: v for k, v in row.items() if k in KEEP_ROW_KEYS}


def check_continue(paths):
    ins = []
    for p in paths:
        name = os.path.basename(p).replace(".dcm", "").replace(".DCM", "")
        try:
            ins.append(int(name.split("_")[-1]))
        except Exception:
            continue
    if not ins:
        return False
    return max(ins) - min(ins) + 1 == len(paths)


def txid_from_keys(keys):
    split = [str(k or "").split("/") for k in (keys or []) if str(k or "")]
    split = [p for p in split if p]
    if not split:
        return ""
    i = 0
    while split and all(i < len(p) and p[i] == split[0][i] for p in split):
        i += 1
    parts = split[0][:i] if i else split[0]
    while len(parts) > 2 and is_series_folder(parts[-1]):
        parts = parts[:-1]
    return parts[-1] if parts else ""


def merge_by_study(rows):
    grouped = {}
    order = []
    for r in rows or []:
        sig = "|".join([str(r.get("PatientID") or ""), str(r.get("ACC NO") or ""), str(r.get("study date") or "")])
        key = str(r.get("_key") or r.get("TXID") or "")
        slices = int(r.get("image slices") or 0) or 0
        hit = grouped.get(sig)
        if not hit:
            grouped[sig] = {"row": dict(r), "keys": [key] if key else [], "slices": slices}
            order.append(sig)
            continue
        if key:
            hit["keys"].append(key)
        hit["slices"] += slices
    built = []
    txid_count = {}
    tmp = []
    for sig in order:
        g = grouped[sig]
        from_path = txid_from_keys(g["keys"])
        txid = from_path or str(g["row"].get("PatientID") or "").strip() or str(g["row"].get("TXID") or "")
        tmp.append((g, txid))
        txid_count[txid] = txid_count.get(txid, 0) + 1
    for g, txid in tmp:
        row = g["row"]
        pid = str(row.get("PatientID") or "").strip()
        row["TXID"] = (pid or txid) if txid_count.get(txid, 0) > 1 else txid
        row["image slices"] = g["slices"]
        row.pop("_key", None)
        built.append(row)
    return built


def _read_case(key, files):
    row = None
    for path in files[:8]:
        row = tags_to_row(read_tags_file(path))
        if row:
            break
    if not row:
        return None
    parts = [p for p in str(key).split("/") if p]
    row["_key"] = key
    row["TXID"] = parts[-1] if parts else key
    row["image slices"] = len(files)
    row["contiue"] = check_continue(files)
    if len(parts) >= 3:
        row["医院"] = parts[-2]
    return row


class StatsScanError(Exception):
    def __init__(self, msg):
        super().__init__(msg)
        self.msg = msg


def _sftp_join(root, name):
    if str(root).endswith("/"):
        return str(root) + name
    return str(root) + "/" + name


def _sftp_connect(host, username, password):
    try:
        import paramiko
    except Exception:
        raise StatsScanError("服务器未安装 SFTP 组件")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=22,
            username=username,
            password=password,
            timeout=20,
            allow_agent=False,
            look_for_keys=False,
            banner_timeout=20,
            auth_timeout=20,
        )
    except paramiko.AuthenticationException:
        client.close()
        raise StatsScanError("服务器登录失败，请检查用户名和密码")
    except Exception:
        client.close()
        raise StatsScanError(f"无法连接服务器 {host}")
    try:
        return client, client.open_sftp()
    except Exception:
        client.close()
        raise StatsScanError(f"无法连接服务器 {host}")


SFTP_HEADER_BYTES = 64 * 1024
SFTP_KEEP_FILES = 3
SFTP_WORKERS = 8


def _sftp_close(client, sftp=None):
    try:
        if sftp:
            sftp.close()
    except Exception:
        pass
    try:
        if client:
            client.close()
    except Exception:
        pass


def _keep_best_files(files):
    files = list(files or [])
    files.sort(key=lambda p: (file_rank(os.path.basename(p)), os.path.basename(p)))
    return files[:SFTP_KEEP_FILES]


def collect_case_files_sftp(sftp, root, start=None):
    import stat as pystat
    grouped = {}
    counts = {}
    stack = [start or root]
    seen = set()
    while stack:
        dirpath = stack.pop()
        if dirpath in seen:
            continue
        seen.add(dirpath)
        rel = os.path.relpath(dirpath, root).replace("\\", "/")
        parts = [] if rel in (".", "") else [p for p in rel.split("/") if p and p != "."]
        if any(p.startswith(".") for p in parts):
            continue
        try:
            entries = sftp.listdir_attr(dirpath)
        except Exception:
            continue
        files = []
        subdirs = []
        for attr in entries:
            name = getattr(attr, "filename", "") or ""
            if not name or name.startswith("."):
                continue
            full = _sftp_join(dirpath, name)
            mode = getattr(attr, "st_mode", 0) or 0
            if pystat.S_ISDIR(mode):
                subdirs.append((name, full))
            elif is_dicom_name(name):
                files.append(full)
        if files:
            key = case_key(parts)
            counts[key] = counts.get(key, 0) + len(files)
            grouped[key] = _keep_best_files((grouped.get(key) or []) + files)
        for name, full in subdirs:
            next_key = case_key(parts + [name])
            if is_series_folder(name) and len(grouped.get(next_key) or []) >= SFTP_KEEP_FILES:
                continue
            stack.append(full)
    return grouped, counts


def _merge_groups(dst, src, dst_n, src_n):
    for key, files in (src or {}).items():
        dst[key] = _keep_best_files((dst.get(key) or []) + files)
    for key, n in (src_n or {}).items():
        dst_n[key] = dst_n.get(key, 0) + n


def collect_case_files_sftp_all(host, root, username, password):
    import stat as pystat
    client, sftp = _sftp_connect(host, username, password)
    try:
        try:
            sftp.stat(root)
        except Exception:
            raise StatsScanError(f"服务器上找不到该目录：{host}:{root}")
        try:
            entries = sftp.listdir_attr(root)
        except Exception:
            raise StatsScanError(f"服务器上找不到该目录：{host}:{root}")
        files = []
        dirs = []
        for attr in entries:
            name = getattr(attr, "filename", "") or ""
            if not name or name.startswith("."):
                continue
            full = _sftp_join(root, name)
            mode = getattr(attr, "st_mode", 0) or 0
            if pystat.S_ISDIR(mode):
                dirs.append(full)
            elif is_dicom_name(name):
                files.append(full)
        grouped, counts = {}, {}
        if files:
            grouped["_root"] = _keep_best_files(files)
            counts["_root"] = len(files)
        if not dirs:
            return grouped, counts
        if len(dirs) == 1:
            g1, n1 = collect_case_files_sftp(sftp, root, start=dirs[0])
            _merge_groups(grouped, g1, counts, n1)
            return grouped, counts
    finally:
        _sftp_close(client, sftp)

    workers = min(6, len(dirs))
    chunks = [dirs[i::workers] for i in range(workers)]

    def walk_chunk(starts):
        c, s = _sftp_connect(host, username, password)
        try:
            g, n = {}, {}
            for d in starts:
                g1, n1 = collect_case_files_sftp(s, root, start=d)
                _merge_groups(g, g1, n, n1)
            return g, n
        finally:
            _sftp_close(c, s)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(walk_chunk, ch) for ch in chunks if ch]
        for fut in as_completed(futs):
            g1, n1 = fut.result()
            _merge_groups(grouped, g1, counts, n1)
    return grouped, counts


def read_tags_sftp(sftp, path):
    try:
        with sftp.open(path, "rb") as f:
            try:
                f.prefetch(SFTP_HEADER_BYTES)
            except Exception:
                pass
            buf = f.read(SFTP_HEADER_BYTES)
        tags = parse_dicom_tags(buf)
        if tags:
            return tags
        with sftp.open(path, "rb") as f:
            buf = f.read(HEADER_BYTES)
        return parse_dicom_tags(buf)
    except Exception:
        return {}


def _read_case_sftp(sftp, key, files, slice_count=None):
    row = None
    for path in files[:SFTP_KEEP_FILES]:
        row = tags_to_row(read_tags_sftp(sftp, path))
        if row:
            break
    if not row:
        return None
    parts = [p for p in str(key).split("/") if p]
    row["_key"] = key
    row["TXID"] = parts[-1] if parts else key
    row["image slices"] = slice_count if slice_count is not None else len(files)
    row["contiue"] = check_continue(files)
    if len(parts) >= 3:
        row["医院"] = parts[-2]
    return row


def _read_sftp_chunk(host, username, password, items):
    client, sftp = _sftp_connect(host, username, password)
    try:
        rows = []
        for key, files, nslice in items:
            row = _read_case_sftp(sftp, key, files, nslice)
            if row:
                rows.append(row)
        return rows
    finally:
        _sftp_close(client, sftp)


def scan_case_rows_sftp(host, root, username, password):
    grouped, counts = collect_case_files_sftp_all(host, root, username, password)
    if not grouped:
        return []
    items = [(key, files, counts.get(key, len(files))) for key, files in grouped.items()]
    workers = min(SFTP_WORKERS, max(1, len(items)))
    chunks = [items[i::workers] for i in range(workers)]
    rows = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_read_sftp_chunk, host, username, password, ch) for ch in chunks if ch]
        for fut in as_completed(futs):
            rows.extend(fut.result())
    return merge_by_study(rows)


def scan_case_rows(root):
    grouped = collect_case_files(root)
    if not grouped:
        return []
    rows = []
    items = list(grouped.items())
    workers = min(8, max(1, len(items)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_read_case, key, files) for key, files in items]
        for fut in as_completed(futs):
            row = fut.result()
            if row:
                rows.append(row)
    return merge_by_study(rows)
