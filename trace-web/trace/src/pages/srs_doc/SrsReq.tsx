import "./SrsManage.less";
import { Form, Input, Button, Select, Row, Col, Table, message, Modal, Space, Tooltip, Tag } from "antd";
import { SearchOutlined, EditOutlined, EyeOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as ApiProduct from "@/api/ApiProduct";
import * as Api from "@/api/ApiSrsDoc";
import * as ApiSrsReqd from "@/api/ApiSrsReqd";
import * as ApiProdRcm from "@/api/ApiProdRcm";

export default () => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();
    const [detailModalForm] = Form.useForm();
    const [data, dispatch] = useData({
        products: [],
        srsDocs: [], // SRS文档列表
        loading: false,
        tableData: [], // 表格数据
        detailModalVisible: false, // 详情弹框是否显示
        detailModalMode: "view" as "view" | "edit" | "add", // 查看/编辑/新增模式
        detailRowData: null as any, // 当前行数据
        detailModalLoading: false, // 保存加载状态
        rcmOptions: [], // RCM选项列表
        rcmTipModalVisible: false, // RCM提示弹框是否显示
        currentProductId: null, // 当前选中的产品ID
    });

    // 加载产品列表
    useEffect(() => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows });
            }
        });
    }, []);

    // 加载产品相关的RCM数据
    const loadProductRcm = (productId: number) => {
        if (!productId) {
            dispatch({ rcmOptions: [] });
            return;
        }

        ApiProdRcm.list_prod_rcm({
            prod_id: productId,
            page_index: 0,
            page_size: 10000
        }).then((res: any) => {
            if (res.code === ApiProdRcm.C_OK) {
                const rcmOptions = (res.data?.rows || []).map((item: any) => ({
                    value: item.rcm_id,
                    label: item.code,
                    description: item.description || "",
                }));
                dispatch({ rcmOptions });
            } else {
                dispatch({ rcmOptions: [] });
            }
        }).catch(() => {
            dispatch({ rcmOptions: [] });
        });
    };

    // 当产品ID变化时，加载该产品下的SRS文档列表和RCM数据
const handleProductChange = (productId: number) => {
  // 产品变化时，清空当前版本和已加载的数据
  editForm.setFieldValue("doc_id", undefined);
        dispatch({ srsDocs: [], tableData: [], currentProductId: productId });

  if (!productId) {
            dispatch({ rcmOptions: [] });
      return;
  }

        // 加载SRS文档列表
  Api.list_srs_doc({ product_id: productId, page_index: 0, page_size: 1000 }).then((res: any) => {
      if (res.code === Api.C_OK) {
          dispatch({ srsDocs: res.data.rows || [] });
      }
  });

        // 加载产品相关的RCM数据
        loadProductRcm(productId);
    };

    // 当文档ID变化时，加载该文档的需求数据
    const handleDocIdChange = (docId: number) => {
        // if (!docId) {
        //     dispatch({ tableData: [] });
        //     return;
        // }
        dispatch({ loading: true });

        // 加载需求数据
        ApiSrsReqd.list_srs_reqd({
            product_id: data.currentProductId,
            doc_id: docId,
            page_index: 0,
            page_size: 10000,
        }).then((res: any) => {
            if (res.code === ApiSrsReqd.C_OK) {
                const rows = res.data?.rows || [];
                const tableData = rows.map((item: any, index: number) => ({
                    key: item.req_id || `req_${index}_${Date.now()}`,
                    req_id: item.req_id,
                    doc_id: item.doc_id,
                    doc_version: item.doc_version || "",
                    code: item.code || "",
                    name: item.name || "",
                    overview: item.overview || "",
                    participant: item.participant || "",
                    pre_condition: item.pre_condition || "",
                    trigger: item.trigger || "",
                    work_flow: item.work_flow || "",
                    post_condition: item.post_condition || "",
                    exception: item.exception || "",
                    constraint: item.constraint || "",
                    type_code: item.type_code || 0,
                    rcm_codes: item.rcm_codes || [],
                    rcm_ids: item.rcm_ids || [],
                }));
                dispatch({ tableData });
            } else {
                message.error(res.msg || "加载数据失败");
                dispatch({ tableData: [] });
            }
            dispatch({ loading: false });
        }).catch((error: any) => {
            console.error("加载需求数据失败:", error);
            message.error("加载数据失败");
            dispatch({ loading: false, tableData: [] });
        });
    };

    // 搜索按钮点击事件
    const handleSearch = () => {
        const docId = editForm.getFieldValue("doc_id");
        // if (!docId) {
        //     message.warning("请先选择当前版本");
        //     return;
        // }
        handleDocIdChange(docId);
    };

    const setDetailFormValues = (row: any) => {
        detailModalForm.setFieldsValue({
            req_id: row.req_id,
            code: row.code,
            name: row.name,
            overview: row.overview,
            participant: row.participant,
            pre_condition: row.pre_condition,
            trigger: row.trigger,
            work_flow: row.work_flow,
            post_condition: row.post_condition,
            exception: row.exception,
            constraint: row.constraint,
            rcm_ids: row.rcm_ids || [],
        });
    };

    // 查看行数据
    const handleViewRow = (row: any) => {
        dispatch({ detailRowData: row, detailModalVisible: true, detailModalMode: "view" });
        setDetailFormValues(row);
    };

    // 编辑行数据
    const handleEditRow = (row: any) => {
        dispatch({ detailRowData: row, detailModalVisible: true, detailModalMode: "edit" });
        setDetailFormValues(row);
    };

    // 删除行数据
    const handleDeleteRow = (row: any) => {
        Modal.confirm({
            title: ts("action"),
            content: ts("confirm_delete"),
            okText: ts("confirm"),
            cancelText: ts("cancel"),
            onOk: () => {
                const request = ApiSrsReqd.delete_srs_reqd({ req_id: row.req_id });
                return request.then((res: any) => {
                    if (res.code === ApiSrsReqd.C_OK) {
                        message.success(res.msg || "删除成功");
                        handleDocIdChange(editForm.getFieldValue("doc_id"));
                    } else {
                        message.error(res.msg || "删除失败");
                    }
                }).catch((error: any) => {
                    console.error("删除失败:", error);
                    message.error("删除失败");
                });
            },
        });
    };

    // 新增行：打开与编辑相同的弹框，为空表单
    // const handleAddRow = () => {
    //     const docId = editForm.getFieldValue("doc_id");
    //     if (!docId) {
    //         message.warning(ts("srs_doc.please_select_current_version") || "请先选择当前版本");
    //         return;
    //     }
    //     dispatch({ detailRowData: null, detailModalVisible: true, detailModalMode: "add" });
    //     detailModalForm.resetFields();
    // };

    // 关闭详情弹框
    const handleCloseDetailModal = () => {
        dispatch({ detailModalVisible: false, detailRowData: null });
        detailModalForm.resetFields();
    };

    // 保存编辑或新增
    const handleSaveEdit = () => {
        detailModalForm.validateFields().then((values) => {
            dispatch({ detailModalLoading: true });
            const docId = editForm.getFieldValue("doc_id");
            const isAdd = data.detailModalMode === "add";
            const request = isAdd
                ? ApiSrsReqd.add_srs_reqd({
                    doc_id: docId,
                    code: values.code ?? "",
                    name: values.name ?? "",
                    overview: values.overview ?? "",
                    participant: values.participant ?? "",
                    pre_condition: values.pre_condition ?? "",
                    trigger: values.trigger ?? "",
                    work_flow: values.work_flow ?? "",
                    post_condition: values.post_condition ?? "",
                    exception: values.exception ?? "",
                    constraint: values.constraint ?? "",
                    rcm_ids: Array.isArray(values.rcm_ids) ? values.rcm_ids : [],
                })
                : ApiSrsReqd.update_srs_reqd(values);
            request.then((res: any) => {
                if (res.code === ApiSrsReqd.C_OK) {
                    message.success(res.msg || "保存成功");
                    dispatch({ detailModalVisible: false, detailModalLoading: false });
                    detailModalForm.resetFields();
                    if (docId) handleDocIdChange(docId);
                } else {
                    message.error(res.msg || "保存失败");
                    dispatch({ detailModalLoading: false });
                }
            }).catch((error: any) => {
                console.error("保存失败:", error);
                message.error("保存失败");
                dispatch({ detailModalLoading: false });
            });
        });
    };

    const isViewMode = data.detailModalMode === "view";
    const isAddMode = data.detailModalMode === "add";

    // RCM选择框点击事件
    const handleRcmSelectClick = () => {
        if (!data.currentProductId) {
            message.warning("请先选择产品");
            return;
        }

        if (!data.rcmOptions || data.rcmOptions.length === 0) {
            dispatch({ rcmTipModalVisible: true });
        }
    };

    // 关闭RCM提示弹框
    const handleCloseRcmTipModal = () => {
        dispatch({ rcmTipModalVisible: false });
    };

    // 表格列定义
    const columns = [
        {
            title: ts("srs_doc.srs_code") || "需求编号",
            dataIndex: "code",
            width: 200,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("sds_reqd.name") || "需求名称",
            dataIndex: "name",
            width: 140,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("srs_reqd.overview") || "需求概述",
            dataIndex: "overview",
            width: 240,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("srs_doc.main_participant") || "主参加者",
            dataIndex: "participant",
            width: 120,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("test_case.precondition") || "前置条件",
            dataIndex: "pre_condition",
            width: 200,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("srs_doc.trigger") || "触发器",
            dataIndex: "trigger",
            width: 120,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("srs_doc.workflow") || "工作流",
            dataIndex: "work_flow",
            width: 220,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("srs_doc.postcondition") || "后置条件",
            dataIndex: "post_condition",
            width: 220,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("srs_doc.exception") || "异常情况",
            dataIndex: "exception",
            width: 220,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("srs_doc.constraint") || "约束",
            dataIndex: "constraint",
            width: 220,
            ellipsis: true,
            render: (text: string) => renderOneLineWithTooltip(text),
        },
        {
            title: ts("rcm.code") || "RCM编号",
            dataIndex: "rcm_codes",
            width: 180,
            ellipsis: true,
            render: (codes: string[]) => renderOneLineWithTooltip((codes || []).join(", ")),
        },
        {
            title: ts("action"),
            width: 140,
            fixed: "right" as const,
            render: (_value: any, row: any) => (
                <Space>
                    <Button
                        type="link"
                        icon={<EyeOutlined />}
                        onClick={() => handleViewRow(row)}>
                        {ts("view")}
                    </Button>
                    <Button
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => handleEditRow(row)}>
                        {ts("edit")}
                    </Button>
                    {
                    row.type_code === 'reqd' && (
                        <Button
                            type="link"
                            icon={<DeleteOutlined />}
                            danger
                            onClick={() => handleDeleteRow(row)}>
                            {ts("delete")}
                        </Button>
                    )
                    }
                </Space>
            ),
        },
    ];

    return (
        <div className="page div-v srs-manage">
        {/* 搜索框 */}
        <div className="div-h searchbar list-searchbar-align">
          <Form
              form={editForm}
                  className="expand"
                  onFinish={handleSearch}>
                  <Row gutter={10} align="middle">
                      <Col>
                          <Form.Item label={ts("srs_doc.select_product")} name="product_id">
                          <ProductVersionSelect
                              products={data.products}
                              allowClear
                              namePlaceholder={ts("product.name")}
                              versionPlaceholder={ts("product.full_version")}
                              onChange={(value) => {
                                  editForm.setFieldValue("product_id", value);
                                  handleProductChange(value);
                              }}
                          />
                      </Form.Item>
                  </Col>
                      <Col>
                          <Form.Item label={ts("srs_doc.current_version")} name="doc_id">
                              <Select
                                  placeholder={ts("srs_doc.please_select_current_version") || "请选择当前版本"}
                                  showSearch
                                  allowClear
                                  optionFilterProp="label"
                                  disabled={!editForm.getFieldValue("product_id")}
                                  options={data.srsDocs.map((item: any) => ({
                                      label: item.version || "",
                                      value: item.id
                                  }))}
                              />
                      </Form.Item>
                  </Col>
                      <Col>
                          <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                      </Col>
                      {/* <Col flex="auto" style={{ textAlign: "right" }}>
                          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddRow}>
                              {ts("srs_doc.add_req_table") || "增加表格"}
                          </Button>
                      </Col> */}
              </Row>
            </Form>
          </div>
          <div className="div-v detail-content">

              {/* 表格 */}
              <Table
                  dataSource={data.tableData}
                  columns={columns}
                  tableLayout="fixed"
                  rowKey="key"
                  pagination={false}
                  loading={data.loading}
                  scroll={{ x: 1800 }}
              />

              {/* 查看/编辑弹框 */}
              <Modal
                  width={1000}
                  title={isViewMode ? (ts("view") || "查看") : (isAddMode ? (ts("add") || "新增") : (ts("edit") || "编辑"))}
                  open={data.detailModalVisible}
                  onCancel={handleCloseDetailModal}
                  confirmLoading={!isViewMode && data.detailModalLoading}
                  onOk={isViewMode ? undefined : handleSaveEdit}
                  okText={ts("save") || "保存"}
                  cancelText={ts("cancel") || "取消"}
                  footer={isViewMode ? [
                      <Button key="close" onClick={handleCloseDetailModal}>
                          {ts("cancel") || "关闭"}
                      </Button>
                  ] : undefined}>
                  <div className={isViewMode ? "view-modal-readonly" : ""}>
                  <Form
                      form={detailModalForm}
                      layout="horizontal"
                      labelCol={{ span: 4 }}
                      wrapperCol={{ span: 20 }}
                      className="expand">
                      <Form.Item hidden name="req_id">
                          <Input />
                      </Form.Item>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_doc.srs_code") || "需求编号"} name="code">
                                  <Input allowClear disabled={isViewMode || !isAddMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_reqd.name") || "需求名称"} name="name">
                                  <Input allowClear disabled />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_reqd.overview") || "需求概述"} name="overview">
                                  <Input.TextArea rows={3} allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_doc.main_participant") || "主参加者"} name="participant">
                                  <Input allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("test_case.precondition") || "前置条件"} name="pre_condition">
                                  <Input.TextArea rows={2} allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_doc.trigger") || "触发器"} name="trigger">
                                  <Input allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_doc.workflow") || "工作流"} name="work_flow">
                                  <Input.TextArea rows={2} allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_doc.postcondition") || "后置条件"} name="post_condition">
                                  <Input.TextArea rows={2} allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_doc.exception") || "异常情况"} name="exception">
                                  <Input.TextArea rows={2} allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("srs_doc.constraint") || "约束"} name="constraint">
                                  <Input.TextArea rows={2} allowClear disabled={isViewMode} />
                              </Form.Item>
                          </Col>
                      </Row>
                      <Row gutter={24}>
                          <Col span={24}>
                              <Form.Item label={ts("rcm.code") || "RCM编号"} name="rcm_ids">
                                  {isViewMode ? (
                                      <Input value={data.detailRowData?.rcm_codes?.join(", ") || "-"} disabled />
                                  ) : (
                                      <Select
                                          mode="multiple"
                                          placeholder="请选择RCM"
                                          showSearch
                                          allowClear
                                          optionFilterProp="label"
                                          options={data.rcmOptions}
                                          maxTagCount="responsive"
                                          tagRender={(tag) => <Tag color="blue">{tag.label}</Tag>}
                                          optionRender={(opt) => (
                                              <Tooltip title={(opt.data as any)?.description} placement="left">
                                                  <span>{opt.data.label}</span>
                                              </Tooltip>
                                          )}
                                          onClick={handleRcmSelectClick}
                                          onDropdownVisibleChange={(open) => {
                                              if (open && (!data.rcmOptions || data.rcmOptions.length === 0)) {
                                                  handleRcmSelectClick();
                                              }
                                          }}
                                      />
                                  )}
                              </Form.Item>
                          </Col>
                      </Row>
                  </Form>
                  </div>
              </Modal>

              {/* RCM提示弹框 */}
              <Modal
                  width={600}
                  title="提示"
                  open={data.rcmTipModalVisible}
                  onCancel={handleCloseRcmTipModal}
                  footer={[
                      <Button key="confirm" type="primary" onClick={handleCloseRcmTipModal}>
                          {ts("confirm") || "确认"}
                      </Button>
                  ]}>
                  <div>
                      <p style={{ marginBottom: 16 }}>暂无RCM数据，请先在RCM列表中维护。</p>
                      <p style={{ color: '#666', fontSize: '12px' }}>
                          提示：请先访问"风险与追溯管理&gt;风险分析汇总&gt;RCM列表"页面，选择对应的产品名称和完整版本，然后从RCM总表多选添加RCM数据。
                      </p>
                  </div>
              </Modal>
          </div>
        </div>
    );
};
