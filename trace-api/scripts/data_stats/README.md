# 数据统计脚本（全产品通用）

离线工具，不绑定某个产品路径。日常请用 QMS 左侧菜单「数据统计」在网页里选文件夹生成并下载；命令行脚本仅备用。封面、产品信息仍由系统填空，不走本脚本。

## 依赖

```bash
pip install -r trace-api/scripts/data_stats/requirements.txt
```

## 1. 从 DICOM 抽病例分布

`--layout flat`：`根目录/病例文件夹/`  
`--layout nested`：`根目录/中心或批次/病例文件夹/`

```bash
python trace-api/scripts/data_stats/data_statistics_multi.py \
  --input /path/to/cases \
  --output /path/to/distribution.xlsx \
  --layout flat
```

## 2. 汇总为统计表（因素 / 类别 / 序列数 / 占比）

```bash
python trace-api/scripts/data_stats/summarize_db_stats.py \
  --input /path/to/distribution.xlsx \
  --output /path/to/stats_table.xlsx \
  --title 原始数据库统计表 \
  --data-type 胸部CTPA
```

在统计表文档编辑页点「导入统计 Excel」，选 `stats_table.xlsx` 或亚组结果 xlsx，再保存。只替换记录章节，封面/修订/产品信息不改。

## 3. 亚组（可选，表中需有 gt/pred，Dice 需有 dice 列）

```bash
python trace-api/scripts/data_stats/triage_subgroup.py \
  --input /path/to/distribution.xlsx \
  --output /path/to/subgroup_result.xlsx
```

表中没有的分组列会自动跳过。
