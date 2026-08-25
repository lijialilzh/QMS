# 数据统计脚本（离线）。详见 docs/function_docs/100_数据文件管理.md。
#
# 适用任意产品：只扫传入目录，不写死路径。
# 每个病例一个子文件夹，内含 DICOM。

import argparse
import os
import sys
import time
from multiprocessing import Pool, cpu_count

try:
    import pydicom as dicom
except ImportError:
    sys.exit("请先安装：pip install -r scripts/data_stats/requirements.txt")

import pandas as pd


def merge_ww_wc(ww, wc):
    ww_wc = []
    if isinstance(ww, list):
        for i in range(len(ww)):
            ww_wc.append([wc[i], ww[i]])
    else:
        ww_wc.append([wc, ww])
    return ww_wc


def dicom_info(name):
    info_dic = {}
    try:
        slices = dicom.read_file(name, force=True, stop_before_pixels=True)
    except Exception:
        return info_dic
    getters = [
        ("PatientID", "PatientID", "none"),
        ("SeriesInstanceUID", "SeriesInstanceUID", "none"),
        ("study date", "StudyDate", "none"),
        ("ACC NO", "AccessionNumber", "none"),
        ("SEX", "PatientSex", None),
        ("DEVICE", "Manufacturer", "none"),
        ("ConvolutionKernel", "ConvolutionKernel", "none"),
        ("Series Description", "SeriesDescription", "none"),
        ("ManufacturerModelName", "ManufacturerModelName", "none"),
        ("PatientPosition", "PatientPosition", "none"),
        ("Body Part Examined", "BodyPartExamined", "none"),
        ("PhotometricInterpretation", "PhotometricInterpretation", "none"),
    ]
    for key, attr, default in getters:
        try:
            info_dic[key] = getattr(slices, attr)
        except Exception:
            if default is not None:
                info_dic[key] = default
    try:
        info_dic["AGE"] = int(str(slices.PatientAge)[0:3])
    except Exception:
        pass
    try:
        info_dic["KVP"] = slices.KVP
    except Exception:
        info_dic["KVP"] = -1
    try:
        info_dic["THICKNESS"] = slices.SliceThickness
    except Exception:
        info_dic["THICKNESS"] = 1.0
    try:
        info_dic["wc_ww"] = merge_ww_wc(slices.WindowWidth, slices.WindowCenter)
    except Exception:
        info_dic["wc_ww"] = "none"
    for key, attr, default in [
        ("Columns", "Columns", 9999),
        ("Rows", "Rows", 9999),
        ("SeriesNumber", "SeriesNumber", 9999),
        ("CTDIvol", "CTDIvol", 9999),
        ("Exposure", "Exposure", 9999),
        ("ImageOrientation", "ImageOrientationPatient", "none"),
    ]:
        try:
            info_dic[key] = getattr(slices, attr)
        except Exception:
            info_dic[key] = default
    try:
        info_dic["PixelSpacing"] = slices.PixelSpacing[0]
    except Exception:
        info_dic["PixelSpacing"] = 9999
    try:
        info_dic["SpacingBetweenSlices"] = slices.SpacingBetweenSlices
    except Exception:
        info_dic["SpacingBetweenSlices"] = 9999
    return info_dic


def check_ins_continue(pid_path):
    try:
        files = [f for f in os.listdir(pid_path) if not f.startswith(".")]
        ins_list = []
        for filename in files:
            try:
                ins_list.append(int(filename.replace(".dcm", "").split("_")[-1]))
            except Exception:
                continue
        if not ins_list:
            return False
        return max(ins_list) - min(ins_list) + 1 == len(files)
    except Exception:
        return "error"


def get_dicom_info(pid_path):
    try:
        files = [f for f in os.listdir(pid_path) if not f.startswith(".")]
        if not files:
            return {}
        dicom_name = os.path.join(pid_path, files[0])
        info_dic = dicom_info(dicom_name)
        info_dic["TXID"] = os.path.basename(pid_path.rstrip("/"))
        info_dic["image slices"] = len(files)
        info_dic["contiue"] = check_ins_continue(pid_path)
        print(pid_path, "complete")
        return info_dic
    except Exception as exc:
        print(pid_path, exc)
        return {}


def collect_case_dirs(basepath, layout):
    paths = []
    if layout == "nested":
        for folder in os.listdir(basepath):
            folder_path = os.path.join(basepath, folder)
            if not os.path.isdir(folder_path) or folder.startswith("."):
                continue
            for pid in os.listdir(folder_path):
                full = os.path.join(folder_path, pid)
                if os.path.isdir(full) and not pid.startswith("."):
                    paths.append(full)
        return paths
    for name in os.listdir(basepath):
        full = os.path.join(basepath, name)
        if os.path.isdir(full) and not name.startswith("."):
            paths.append(full)
    return paths


def main():
    parser = argparse.ArgumentParser(description="从 DICOM 目录抽取病例信息，输出分布 Excel（全产品通用）")
    parser.add_argument("--input", required=True, help="病例根目录")
    parser.add_argument("--output", default="", help="输出 xlsx，默认 <input>_distribution.xlsx")
    parser.add_argument("--layout", choices=["flat", "nested"], default="flat",
                        help="flat=目录/病例；nested=目录/中心或批次/病例")
    parser.add_argument("--jobs", type=int, default=0, help="进程数，默认 CPU 核数")
    args = parser.parse_args()
    basepath = os.path.abspath(args.input)
    if not os.path.isdir(basepath):
        sys.exit("输入目录不存在: %s" % basepath)
    excelname = args.output or (basepath.rstrip("/") + "_distribution.xlsx")
    start = time.time()
    pid_path = collect_case_dirs(basepath, args.layout)
    if not pid_path:
        sys.exit("未找到病例文件夹")
    jobs = args.jobs or cpu_count()
    with Pool(processes=jobs) as pool:
        rows = pool.map(get_dicom_info, pid_path)
    df = pd.DataFrame.from_dict([r for r in rows if r])
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    headers = list(df.columns)
    ws.append(headers)
    for _, row in df.iterrows():
        ws.append([row[c] if pd.notna(row[c]) else "" for c in headers])
    os.makedirs(os.path.dirname(os.path.abspath(excelname)) or ".", exist_ok=True)
    wb.save(excelname)
    print("wrote", excelname, "rows", len(df), "elapsed", round(time.time() - start, 2), "s")


if __name__ == "__main__":
    main()
