import "./EditDlg.less";
import { Form, Button, Table, message, Row, Col, Modal, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import * as ApiRcm from "@/api/ApiRcm";
import * as ApiProdRcm from "@/api/ApiProdRcm";

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
        if (embedded) return;
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

    const renderShortText = (value: any) => renderOneLineWithTooltip(value, { emptyText: "", maxChars: 20 });

    const columns =[{
            title: ts("rcm.code"),
            dataIndex: "code",
            render: renderShortText,
        },
        {
            title: ts("rcm.description"),
            dataIndex: "description",
            render: renderShortText,
        },
        {
            title: ts("rcm.proof"),
            dataIndex: "proof",
            render: renderShortText,
        },
        {
            title: ts("rcm.note"),
            dataIndex: "note",
            render: renderShortText,
        }];

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
            onOk={doAddProdRcms}
            confirmLoading={data.loadingAdd}>
            {pickerBody}
        </Modal>
    );
};
