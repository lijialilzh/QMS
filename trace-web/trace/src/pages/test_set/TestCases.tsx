import "./TestCases.less";
import { Table, message } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiTestCase";
import { renderOneLineWithTooltip } from "@/common/tableRenderers";

export default ({ set_id }: any) => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        rows: [],
        loading: false,
    });

    const doSearch = (set_id: string) => {
        dispatch({ loading: true, rows: [] });
        Api.list_test_case({ set_id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, rows: res.data.rows });
            } else {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
            }
        });
    };

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
            <Table
                className="expand"
                tableLayout="fixed"
                sticky
                scroll={{ y: "68vh" }}
                pagination={false}
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
            />
        </div>
    );
};
