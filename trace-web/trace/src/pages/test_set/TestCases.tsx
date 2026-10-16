import "./TestCases.less";
import { Table, Tabs, message } from "antd";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiTestCase";
import { renderOneLineWithTooltip } from "@/common/tableRenderers";

export default ({ set_id }: any) => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        rows: [] as any[],
        loading: false,
        activeSheet: "全部",
    });

    const doSearch = (setId: string) => {
        dispatch({ loading: true, rows: [] });
        Api.list_test_case({ set_id: setId }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const rows = res.data.rows || [];
                dispatch({ loading: false, rows, activeSheet: "全部" });
            } else {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const sheetTabs = useMemo(() => {
        const names: string[] = [];
        (data.rows || []).forEach((r: any) => {
            const sn = String(r.sheet_name || "").trim();
            if (sn && !names.includes(sn)) names.push(sn);
        });
        return ["全部", ...names];
    }, [data.rows]);

    const filteredRows = useMemo(() => {
        if (data.activeSheet === "全部") return data.rows || [];
        return (data.rows || []).filter((r: any) => String(r.sheet_name || "").trim() === data.activeSheet);
    }, [data.rows, data.activeSheet]);

    const columns = [
        {
            title: ts("test_case.code"),
            dataIndex: "code",
            width: "9%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.srs_code"),
            dataIndex: "srs_code",
            width: "9%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.test_type"),
            dataIndex: "test_type",
            width: "8%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.stage"),
            dataIndex: "stage",
            width: "8%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.function"),
            dataIndex: "function",
            width: "8%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.description"),
            dataIndex: "description",
            width: "13%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.precondition"),
            dataIndex: "precondition",
            width: "13%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.test_step"),
            dataIndex: "test_step",
            width: "13%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.expect"),
            dataIndex: "expect",
            width: "13%",
            render: renderOneLineWithTooltip,
        },
        {
            title: ts("test_case.note"),
            dataIndex: "note",
            width: "6%",
            render: renderOneLineWithTooltip,
        },
    ];

    useEffect(() => {
        doSearch(set_id);
    }, [set_id]);

    return (
        <div className="div-v table-box">
            {sheetTabs.length > 1 && (
                <Tabs
                    size="small"
                    activeKey={data.activeSheet}
                    onChange={(key) => dispatch({ activeSheet: key })}
                    items={sheetTabs.map((name) => ({ key: name, label: name }))}
                    style={{ marginBottom: 8 }}
                />
            )}
            <Table
                className="expand"
                tableLayout="fixed"
                sticky
                scroll={{ y: "68vh" }}
                pagination={false}
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={filteredRows}
                loading={data.loading}
            />
        </div>
    );
};
