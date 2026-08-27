import "./DataStats.less";
import { Button, Input, Radio, Space, Spin, Table, Tabs, message } from "antd";
import { FolderOpenOutlined, DownloadOutlined } from "@ant-design/icons";
import { useMemo, useRef, useEffect } from "react";
import { useData } from "@/common";
import * as XLSX from "xlsx";
import {
    STATS_TITLES,
    StatsKind,
    DETAIL_COLUMNS,
    buildStatsGrid,
    buildWorkbookSheets,
    buildTriageAoa,
    distRowsFromGrid,
    statsFromFiles,
    CaseRow,
    SheetAoa,
} from "./dataStatsLocal";

export default () => {
    const folderRef = useRef<HTMLInputElement>(null);
    const [data, dispatch] = useData({
        kind: "raw" as StatsKind,
        rows: [] as CaseRow[],
        loading: false,
        progress: "",
        dataType: "",
        disease: "",
        person: "",
    });

    useEffect(() => {
        const el = folderRef.current;
        if (!el) return;
        el.setAttribute("webkitdirectory", "");
        el.setAttribute("directory", "");
    }, []);

    const title = STATS_TITLES[data.kind as StatsKind];
    const extra = { dataType: data.dataType, disease: data.disease, person: data.person };
    const sheets: SheetAoa[] = useMemo(
        () => (data.rows || []).length ? buildWorkbookSheets(title, data.rows, extra) : [],
        [title, data.rows, data.dataType, data.disease, data.person],
    );
    const statsGrid = useMemo(() => buildStatsGrid(title, data.rows || [], extra), [title, data.rows, extra.dataType, extra.disease, extra.person]);
    const tableRows = useMemo(() => distRowsFromGrid(statsGrid), [statsGrid]);
    const total = (data.rows || []).length;
    const detailRows = useMemo(
        () => (data.rows || []).map((r: CaseRow, i: number) => ({ key: i, ...r })),
        [data.rows],
    );
    const triageRows = useMemo(() => {
        const aoa = buildTriageAoa(data.rows || []);
        if (aoa.length < 2) return [];
        return aoa.slice(1).map((r, i) => ({
            key: i, Item: r[0], Catgory: r[1], pos_cases: r[2], neg_cases: r[3], Sen: r[4], Spe: r[5],
        }));
    }, [data.rows]);
    const deviceRows = useMemo(() => triageRows.map((r) => ({
        key: r.key, Item: r.Item, Catgory: r.Catgory, pos_cases: r.pos_cases, neg_cases: r.neg_cases,
    })), [triageRows]);

    const pickFolder = () => {
        if (!folderRef.current) return;
        folderRef.current.value = "";
        folderRef.current.click();
    };

    const saveXlsx = (list: SheetAoa[], fileTitle: string) => {
        const wb = XLSX.utils.book_new();
        list.forEach((sh) => {
            const ws = XLSX.utils.aoa_to_sheet(sh.rows);
            XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
        });
        XLSX.writeFile(wb, `${fileTitle}.xlsx`);
    };

    const onFolder = (fileList: FileList | null) => {
        if (!fileList || !fileList.length) return;
        dispatch({ loading: true, progress: "正在读取病例…", rows: [] });
        statsFromFiles(fileList, (done, all) => {
            dispatch({ progress: `正在读取 ${done}/${all}` });
        }).then((rows) => {
            if (!rows.length) {
                dispatch({ loading: false, progress: "", rows: [] });
                message.warning("未找到病例或无法读取 DICOM，请确认选的是病例根目录");
                return;
            }
            dispatch({ loading: false, progress: "", rows });
            message.success(`已统计 ${rows.length} 个序列，请在下方页签查看`);
        }).catch(() => {
            dispatch({ loading: false, progress: "", rows: [] });
            message.error("读取失败");
        });
    };

    const downloadXlsx = () => {
        if (!total) {
            message.warning("请先选择病例文件夹");
            return;
        }
        saveXlsx(sheets, title);
        message.success(`已下载「${title}.xlsx」，请看 Excel 底部的多个工作表`, 8);
    };

    return (
        <div className="div-v page data-stats">
            <input
                ref={folderRef}
                type="file"
                multiple
                style={{ display: "none" }}
                // @ts-expect-error Chrome/Edge 选文件夹
                webkitdirectory=""
                onChange={(e) => onFolder(e.target.files)}
            />
            <div className="data-stats-toolbar">
                <span className="data-stats-title">数据统计</span>
                <Radio.Group
                    value={data.kind}
                    buttonStyle="solid"
                    onChange={(e) => dispatch({ kind: e.target.value })}>
                    <Radio.Button value="raw">原始数据库</Radio.Button>
                    <Radio.Button value="base">基础数据库</Radio.Button>
                    <Radio.Button value="ann">标注数据库</Radio.Button>
                </Radio.Group>
                <Space>
                    <Button icon={<FolderOpenOutlined />} loading={data.loading} onClick={pickFolder}>
                        选择病例文件夹
                    </Button>
                    <Button type="primary" icon={<DownloadOutlined />} disabled={!total} onClick={downloadXlsx}>
                        下载 Excel
                    </Button>
                </Space>
            </div>
            <div className="data-stats-hint">
                每个病例一个文件夹。选完后在本页查看，不自动下载。需要存档时再点「下载 Excel」。
                {total ? `　当前 ${total} 个序列。` : ""}
            </div>
            <div className="data-stats-fields">
                <span>统计人</span>
                <Input placeholder="选填" value={data.person} onChange={(e) => dispatch({ person: e.target.value })} />
                <span>数据类型</span>
                <Input placeholder="如 胸部CTPA" value={data.dataType} onChange={(e) => dispatch({ dataType: e.target.value })} />
                <span>疾病构成</span>
                <Input placeholder="选填" value={data.disease} onChange={(e) => dispatch({ disease: e.target.value })} />
                {data.progress ? <span className="data-stats-progress">{data.progress}</span> : null}
            </div>
            <Spin spinning={data.loading} wrapperClassName="data-stats-table">
                <Tabs
                    animated={{ inkBar: true, tabPane: false }}
                    items={[
                        {
                            key: "detail",
                            label: `病例明细${total ? `（${total}）` : ""}`,
                            children: (
                                <Table
                                    size="small"
                                    pagination={{ pageSize: 50 }}
                                    scroll={{ x: 2400 }}
                                    dataSource={detailRows}
                                    columns={DETAIL_COLUMNS.map((c) => ({
                                        title: c, dataIndex: c, ellipsis: true, width: 130,
                                    }))}
                                    locale={{ emptyText: "请选择病例文件夹" }}
                                />
                            ),
                        },
                        {
                            key: "dist",
                            label: "数据分布",
                            children: (
                                <Table
                                    size="small"
                                    pagination={false}
                                    dataSource={tableRows}
                                    columns={[
                                        { title: "因素", dataIndex: "factor", width: 120 },
                                        { title: "类别", dataIndex: "category" },
                                        { title: "序列数", dataIndex: "count", width: 120 },
                                        { title: "占比", dataIndex: "ratio", width: 140 },
                                    ]}
                                    locale={{ emptyText: "请选择病例文件夹" }}
                                />
                            ),
                        },
                        {
                            key: "triage",
                            label: "统计结果",
                            children: (
                                <Table
                                    size="small"
                                    pagination={false}
                                    scroll={{ x: 720 }}
                                    dataSource={triageRows}
                                    columns={[
                                        { title: "Item", dataIndex: "Item", width: 160 },
                                        { title: "Catgory", dataIndex: "Catgory" },
                                        { title: "pos_cases", dataIndex: "pos_cases", width: 110 },
                                        { title: "neg_cases", dataIndex: "neg_cases", width: 110 },
                                        { title: "Sen", dataIndex: "Sen", width: 80 },
                                        { title: "Spe", dataIndex: "Spe", width: 80 },
                                    ]}
                                    locale={{ emptyText: total ? "暂无统计结果" : "请选择病例文件夹" }}
                                />
                            ),
                        },
                        {
                            key: "device",
                            label: "设备分布",
                            children: (
                                <Table
                                    size="small"
                                    pagination={false}
                                    scroll={{ x: 640 }}
                                    dataSource={deviceRows}
                                    columns={[
                                        { title: "Item", dataIndex: "Item", width: 160 },
                                        { title: "Catgory", dataIndex: "Catgory" },
                                        { title: "pos_cases", dataIndex: "pos_cases", width: 110 },
                                        { title: "neg_cases", dataIndex: "neg_cases", width: 110 },
                                    ]}
                                    locale={{ emptyText: total ? "暂无设备分布" : "请选择病例文件夹" }}
                                />
                            ),
                        },
                    ]}
                />
            </Spin>
        </div>
    );
};
