import re
from datetime import datetime

def new_version(version: str) -> str:
    version = (version or "").strip()
    match = re.search(r"(\d+)(?!.*\d)", version)
    if not match:
        return datetime.now().strftime("%Y%m%d.%H%M%S")
    start, end = match.span(1)
    return version[:start] + str(int(version[start:end]) + 1) + version[end:]

if __name__ == "__main__":
    print(new_version("1.1.0099"))
    print(new_version("1.1.99"))
    print(new_version("abc"))
    print(new_version(None))
