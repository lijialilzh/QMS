import "./EditDlg.less";
import { Form, Button, Table, message, Row, Col, Modal, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as ApiRcm from "@/api/ApiRcm";
import * as ApiProdRcm from "@/api/ApiProdRcm";

const pageSizeOptions = [2000, 5000];

export default ({ prod_id, isOpen, onClose }: any) => {
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

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        ApiRcm.list_rcm({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === ApiRcm.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const doAddProdRcms = () => {
        const rcm_ids = Array.from(data.targetIds);
        if (rcm_ids.length === 0) {
            message.error("请选择HAZ!");
            return;
        }
        dispatch({ loadingAdd: true });
        ApiProdRcm.add_prod_rcms({ prod_id, rcm_ids }).then((res: any) => {
            dispatch({ loadingAdd: false });
            if (res.code === ApiRcm.C_OK) {
                dispatch({ targetIds: new Set() });
                message.success(res.msg);
                onClose(true);
            } else {
                message.error(res.msg);
            }
        });
    };

    const columns =[{
            title: ts("rcm.code"),
            dataIndex: "code",
        },
        {
            title: ts("rcm.description"),
            dataIndex: "description",
        },
        {
            title: ts("rcm.proof"),
            dataIndex: "proof",
        },
        {
            title: ts("rcm.note"),
            dataIndex: "note",
        }];

    useEffect(() => {
        if (isOpen) {
            const form = queryForm.getFieldsValue();
            doSearch(form, data.pageIndex, data.pageSize);
        }
    }, [isOpen]);

    return (
        <Modal
            width="95%"
            title={ts("add")}
            open={isOpen}
            maskClosable={false}
            onCancel={onClose}
            onOk={doAddProdRcms}
            confirmLoading={data.loadingAdd}>
            <div className="div-v table-box">
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
                                dispatch({ targetIds: new Set(selectedRowKeys) });
                            },
                        }}
                    />
                )}
            </div>
        </Modal>
    );
};
