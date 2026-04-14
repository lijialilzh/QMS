import "./TestCases.less";
import { Table, message } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiTestCase";

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
        },
        {
            title: ts("test_case.srs_code"),
            dataIndex: "srs_code",
        },
        {
            title: ts("test_case.test_type"),
            dataIndex: "test_type",
        },
        {
            title: ts("test_case.stage"),
            dataIndex: "stage",
        },
        {
            title: ts("test_case.function"),
            dataIndex: "function",
        },
        {
            title: ts("test_case.description"),
            dataIndex: "description",
        },
        {
            title: ts("test_case.precondition"),
            dataIndex: "precondition",
        },
        {
            title: ts("test_case.test_step"),
            dataIndex: "test_step",
        },
        {
            title: ts("test_case.expect"),
            dataIndex: "expect",
        },
        {
            title: ts("test_case.note"),
            dataIndex: "note",
        },
    ];

    useEffect(() => {
        doSearch(set_id);
    }, [set_id]);

    return (
        <div className="div-v table-box">
            <Table className="expand scroll-y" pagination={false} columns={columns} rowKey={(item: any) => item.id} dataSource={data.rows} loading={data.loading} />
        </div>
    );
};
