import re
from datetime import datetime

def new_version(version: str) -> str:
    version = (version or "").strip()
    match = re.search(r"(\d+)(?!.*\d)", version)
    if not match:
        return datetime.now().strftime("%Y%m%d.%H%M%S")
    start, end = match.span(1)
    return version[:start] + str(int(version[start:end]) + 1) + version[end:]

def sync_file_no_version(file_no: str, version: str) -> str:
    # 将文件编号末尾的版本段（形如 -A0/-A1，字母+数字）同步为当前文档版本。
    # 仅替换最后一个 "-" 之后、且为“字母+数字”的版本段，避免误伤 -003/-011 这类纯数字序号。
    if not file_no or not version:
        return file_no
    idx = file_no.rfind("-")
    if idx == -1:
        return file_no
    tail = file_no[idx + 1:]
    if re.match(r"^[A-Za-z]+\d+$", tail):
        # 文件编号末尾是字母+数字（如 -A0），用版本号中的数字部分替换
        ver_match = re.search(r"(\d+)(?!.*\d)", version)
        if ver_match:
            ver_num = ver_match.group(1)
            # 保留字母前缀，只替换数字部分
            letter_part = re.match(r"^[A-Za-z]+", tail).group(0)
            return file_no[:idx + 1] + letter_part + ver_num
        return file_no[:idx + 1] + version
    return file_no

if __name__ == "__main__":
    print(new_version("1.1.0099"))
    print(new_version("1.1.99"))
    print(new_version("abc"))
    print(new_version(None))
