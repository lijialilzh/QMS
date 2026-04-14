import { Form, Input, Button, Table, message, Row, Col } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiProduct";

const pageSizeOptions = [10, 20, 50];

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        exportingSet: new Set(),
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_product({ ...params, with_trace: 1, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const columns = [
        {
            title: ts("product.name"),
            dataIndex: "name",
        },
        {
            title: ts("product.type_code"),
            dataIndex: "type_code",
        },
        {
            title: ts("product.full_version"),
            dataIndex: "full_version",
        },
        {
            title: ts("product.version_trace"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        {(row.traces || []).map((item: any) => {
                            return (
                                <div>
                                    {item.srsdoc_version} + {item.sdsdoc_version}
                                </div>
                            );
                        })}
                    </div>
                );
            },
        },
        {
            title: ts("product.trace_docs"),
            render: (_: any, row: any) => {
                return (
                    <div>
                        {ts("product.srs_versions")}: {(row.srs_versions || []).join(", ")}
                        <br />
                        {ts("product.sds_versions")}: {(row.sds_versions || []).join(", ")}
                        <br />
                    </div>
                );
            },
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <Button
                            type="link"
                            onClick={() => {
                                dispatch({ exportingSet: new Set([...data.exportingSet, row.id]) });
                                Api.export_product_trace({ id: row.id }).then((res: any) => {
                                    dispatch({ exportingSet: new Set([...data.exportingSet].filter((item: any) => item !== row.id)) });
                                    if (res.code !== Api.C_OK) {
                                        message.error(res.msg);
                                    }
                                });
                            }}>
                            {ts("export")}
                        </Button>
                    </div>
                );
            },
        },
    ];

    useEffect(() => {
        const form = queryForm.getFieldsValue();
        doSearch(form, data.pageIndex, data.pageSize);
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("fuzzy")} name="fuzzy">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
            </div>
            <Table
                className="expand"
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                pagination={{
                    total: data.total,
                    current: data.pageIndex,
                    showSizeChanger: true,
                    defaultPageSize: pageSizeOptions[0],
                    pageSizeOptions,
                    hideOnSinglePage: false,
                    onShowSizeChange: (page, pageSize) => {
                        dispatch({ pageIndex: page, pageSize: pageSize });
                    },
                    showTotal: (total: number) => {
                        return sprintf(ts("total_items"), { total });
                    },
                }}
                onChange={(pager, _, _sorter: any) => {
                    const form = queryForm.getFieldsValue();
                    doSearch(form, pager.current, pager.pageSize);
                }}
            />
        </div>
    );
};
