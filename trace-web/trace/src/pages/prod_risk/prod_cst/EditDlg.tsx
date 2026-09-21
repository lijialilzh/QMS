import "./EditDlg.less";
import { Form, Button, Table, message, Row, Col, Modal, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import * as ApiCst from "@/api/ApiCst";
import * as ApiProdCst from "@/api/ApiProdCst";

const pageSizeOptions = [1000, 2000, 5000];

export default ({ prod_id, isOpen, onClose, embedded, onIdsChange }: any) => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        loading: false,
        loadingProducts: false,
        products: [],
        loadingAdd: false,
        targetIds: new Set(),
    });

    const setTargetIds = (ids: Set<any>) => {
        dispatch({ targetIds: ids });
        onIdsChange?.(Array.from(ids));
    };

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        ApiCst.list_cst({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === ApiCst.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const doAddProdCsts = () => {
        const cst_ids = Array.from(data.targetIds);
        if (cst_ids.length === 0) {
            message.error("请选择HAZ!");
            return;
        }
        if (embedded) return;
        dispatch({ loadingAdd: true });
        ApiProdCst.add_prod_csts({ prod_id, cst_ids }).then((res: any) => {
            dispatch({ loadingAdd: false });
            if (res.code === ApiCst.C_OK) {
                dispatch({ targetIds: new Set() });
                message.success(res.msg);
                onClose(true);
            } else {
                message.error(res.msg);
            }
        });
    };

    const renderShortText = (value: any) => renderOneLineWithTooltip(value, { emptyText: "", maxChars: 20 });

    const columns = [
        {
            title: ts("cst.code"),
            dataIndex: "code",
            render: renderShortText,
        },
        {
            title: ts("cst.category"),
            dataIndex: "category",
            render: renderShortText,
        },
        {
            title: ts("cst.module"),
            dataIndex: "module",
            render: renderShortText,
        },
        {
            title: ts("cst.connection"),
            dataIndex: "connection",
            render: renderShortText,
        },
        {
            title: ts("cst.description"),
            dataIndex: "description",
            render: renderShortText,
        },
        {
            title: ts("cst.harm"),
            dataIndex: "harm",
            render: renderShortText,
        },
    ];

    useEffect(() => {
        if (isOpen) {
            setTargetIds(new Set());
            const form = queryForm.getFieldsValue();
            doSearch(form, 1, data.pageSize);
        }
    }, [isOpen]);

    const pickerBody = (
            <div className="div-v prod-risk-master-picker">
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
                            <Col>
                                <Button onClick={() => setTargetIds(new Set((data.rows || []).map((r: any) => r.id)))}>
                                    全选
                                </Button>
                            </Col>
                            <Col>
                                <Button onClick={() => setTargetIds(new Set())}>取消全选</Button>
                            </Col>
                        </Row>
                    </Form>
                </div>
                {isOpen && (
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
                        rowSelection={{
                            type: "checkbox",
                            selectedRowKeys: [...data.targetIds],
                            onChange: (selectedRowKeys) => {
                                setTargetIds(new Set(selectedRowKeys));
                            },
                        }}
                    />
                )}
            </div>
    );

    if (embedded) {
        return isOpen ? pickerBody : null;
    }

    return (
        <Modal
            width="95%"
            title={ts("add")}
            open={isOpen}
            maskClosable={false}
            onCancel={onClose}
            onOk={doAddProdCsts}
            confirmLoading={data.loadingAdd}>
            {pickerBody}
        </Modal>
    );
};
