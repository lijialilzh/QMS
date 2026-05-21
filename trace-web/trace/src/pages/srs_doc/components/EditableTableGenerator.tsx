import './EditableTableGenerator.less';
import { useState, useEffect, useRef } from 'react';
import { Form, InputNumber, Button, Table, Input, Space, message, Modal, Select, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

// 表格行数据类型
interface TableRowData {
  key: number;
  [key: string]: any;
}

// 新的表头项类型
export interface TableHeaderItem {
  code: string; // UUID 唯一标识
  name: string; // 表头显示名称
}

// 表格数据结构（包含表头和数据）
export interface TableDataWithHeaders {
  tableName?: string;
  type_code?: string;
  tableId?: number | string;
  headers: TableHeaderItem[];
  data: string[][];
  rowMeta?: Array<Record<string, any>>;
}

// 组件 Props 类型
interface EditableTableGeneratorProps {
  open?: boolean;
  initialData?: TableDataWithHeaders; // 初始数据，用于编辑模式
  rcmOptions?: Array<{ value: number; label: string; description?: string }>;
  lockedRowLabels?: string[];
  onConfirm?: (tableData: TableDataWithHeaders) => void | Promise<void>;
  onCancel?: () => void;
}

// 可编辑表格组件
const EditableTableGenerator: React.FC<EditableTableGeneratorProps> = ({ open = false, initialData, rcmOptions = [], lockedRowLabels = [], onConfirm, onCancel }) => {
  const { t: ts } = useTranslation();
  
  // 1. 状态管理：行列数、表格数据、表单实例
  const [rowCount, setRowCount] = useState<number>(0); // 行数
  const [colCount, setColCount] = useState<number>(0); // 列数
  const [tableName, setTableName] = useState<string>(''); // 表名
  const [headerInput, setHeaderInput] = useState<string>(''); // 表头输入（逗号分隔，仅存储name）
  const [tableData, setTableData] = useState<TableRowData[]>([]); // 表格核心数据
  const [customHeaders, setCustomHeaders] = useState<TableHeaderItem[]>([]); // 自定义表头数组（新结构）
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>("");
  const [form] = Form.useForm(); // 表单实例，用于收集和重置行列数
  const tableDataRef = useRef<TableRowData[]>([]);
  const tableMetaRef = useRef<{ type_code?: string; tableId?: number | string }>({});

  const normalizeRcmCode = (value: string | undefined): string => {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[，。；;、,.]+$/g, "");
  };

  const extractRcmCodesFromText = (text: string | undefined): string[] => {
    const matches = String(text || "").match(/\bRCM[-_A-Za-z0-9]+\b/gi) || [];
    const seen = new Set<string>();
    const result: string[] = [];
    matches.forEach((item) => {
      const code = normalizeRcmCode(item);
      if (code && !seen.has(code)) {
        seen.add(code);
        result.push(code);
      }
    });
    return result;
  };

  const rcmLinePattern = /^\s*RCM[-_A-Za-z0-9]+\s*[.．:：，,、]?\s*/i;
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripLeadingCodeInDesc = (code: string, desc: string): string => {
    const pattern = new RegExp(`^\\s*${escapeRegExp(code)}\\s*[.．:：，,、-]*\\s*`, "i");
    return String(desc || "").replace(pattern, "").trim();
  };
  const mergeRcmContent = (originText: string, selectedIds: number[]) => {
    const baseLines = String(originText || "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "" && !rcmLinePattern.test(line));
    const selectedLines = (selectedIds || [])
      .map((id) => rcmOptions.find((o) => o.value === id))
      .filter((o): o is { value: number; label: string; description?: string } => !!o)
      .map((o) => {
        const code = normalizeRcmCode(o.label);
        const desc = stripLeadingCodeInDesc(code, String(o.description || ""));
        return desc ? `${code}.${desc}` : code;
      });
    const dedup = new Set<string>();
    const normalizedLines = [...baseLines, ...selectedLines]
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        if (dedup.has(line)) return false;
        dedup.add(line);
        return true;
      });
    return normalizedLines.join("\n");
  };

  const isRcmAssistRow = (record: TableRowData, colIndex: number): boolean => {
    if (colIndex !== 1 || colCount !== 2) return false;
    const leftTxt = String(record["col_0"] || "").replace(/\s+/g, "");
    const rightTxt = String(record["col_1"] || "");
    const targetLabels = new Set(["异常情况", "约束", "工作流", "触发器", "前置条件", "后置条件"]);
    return targetLabels.has(leftTxt) || /\bRCM[-_A-Za-z0-9]+\b/i.test(rightTxt);
  };

  const normalizeLockLabel = (value: string | undefined): string => String(value || "").replace(/[\s:：]/g, "");
  const lockedLabelSet = new Set(
    ["需求编号", "需求名称", ...(lockedRowLabels || [])]
      .map((item) => normalizeLockLabel(item))
      .filter(Boolean)
  );
  const isReqDetailTwoColumnTable = colCount === 2 && ["需求编号", "需求名称"].every((label, index) => (
    normalizeLockLabel(tableData[index]?.col_0) === normalizeLockLabel(label)
  ));
  const isLockedRow = (record: TableRowData) => {
    const rowIndex = tableData.findIndex((item) => item.key === record.key);
    const label = normalizeLockLabel(record?.col_0);
    return lockedLabelSet.has(label) || (isReqDetailTwoColumnTable && (rowIndex === 0 || rowIndex === 1));
  };
  const isLockedHeaderRow = colCount === 2 && (
    lockedLabelSet.has(normalizeLockLabel(customHeaders[0]?.name)) ||
    /^SRS-/i.test(String(customHeaders[1]?.name || "").trim())
  );

  const CHANGE_REQ_TABLE_HEADERS = "需求编号,模块,功能,子功能";
  const isChangeReqTableName = (value?: string) => /变更/.test(String(value || "").trim());

  const applyChangeReqTablePreset = () => {
    setHeaderInput(CHANGE_REQ_TABLE_HEADERS);
    setColCount(4);
    form.setFieldsValue({ colCount: 4 });
  };

  const watchedTableName = Form.useWatch("tableName", form);

  useEffect(() => {
    if (!open || initialData || !isChangeReqTableName(watchedTableName)) return;
    applyChangeReqTablePreset();
  }, [watchedTableName, open, initialData]);

  const handleFormValuesChange = (changedValues: Record<string, unknown>) => {
    if ("tableName" in changedValues) {
      setTableName(String(changedValues.tableName || ""));
    }
    if ("rowCount" in changedValues) {
      setRowCount(Number(changedValues.rowCount || 0));
    }
    if ("colCount" in changedValues) {
      setColCount(Number(changedValues.colCount || 0));
    }
  };

  const getSelectedRcmIdsByText = (text: string): number[] => {
    const codes = extractRcmCodesFromText(text);
    const ids = codes
      .map((code) => rcmOptions.find((o) => normalizeRcmCode(o.label) === code)?.value)
      .filter((v): v is number => typeof v === "number");
    return Array.from(new Set(ids));
  };

  // 当 initialData 变化或弹框打开时，初始化数据
  useEffect(() => {
    if (open) {
      setSubmitError("");
    }
    if (open && initialData) {
      // 编辑模式：加载已有数据（适配新的表头结构）
      let headers = initialData.headers.map(header => ({
        code: header.code || uuidv4(), // 确保有UUID，无则自动生成
        name: header.name.trim()
      }));
      let data = initialData.data;
      const firstHeaderName = normalizeLockLabel(headers[0]?.name);
      const secondHeaderName = String(headers[1]?.name || "").trim();
      if (
        headers.length === 2 &&
        firstHeaderName === normalizeLockLabel("需求编号") &&
        /^SRS-/i.test(secondHeaderName)
      ) {
        data = [[headers[0].name, headers[1].name], ...data];
        headers = [
          { ...headers[0], name: "字段" },
          { ...headers[1], name: "内容" },
        ];
      }
      
      setColCount(headers.length);
      setRowCount(data.length);
      setTableName(initialData.tableName || '');
      tableMetaRef.current = {
        type_code: initialData.type_code,
        tableId: initialData.tableId,
      };
      setHeaderInput(headers.map(h => h.name).join(',')); // 输入框只显示name
      setCustomHeaders(headers);
      
      // 初始化表格数据
      const initTableData: TableRowData[] = data.map((row, rowIndex) => {
        const rowData: TableRowData = { key: rowIndex };
        headers.forEach((_header, colIndex) => {
          rowData[`col_${colIndex}`] = row[colIndex] || '';
        });
        rowData.__rowMeta = { ...(initialData.rowMeta?.[rowIndex] || {}) };
        return rowData;
      });
      tableDataRef.current = initTableData;
      setTableData(initTableData);
      
      form.setFieldsValue({
        rowCount: data.length,
        colCount: headers.length,
        tableName: initialData.tableName || '',
        headerInput: headers.map(h => h.name).join(',')
      });
    } else if (open && !initialData) {
      // 新增模式：重置所有数据
      form.resetFields();
      setRowCount(0);
      setColCount(0);
      setTableName('');
      setHeaderInput('');
      tableDataRef.current = [];
      setTableData([]);
      setCustomHeaders([]);
      tableMetaRef.current = {};
    }
  }, [open, initialData, form]);

  // 当 Modal 关闭时重置状态
  const resetAndCancel = () => {
    form.resetFields();
    setRowCount(0);
    setColCount(0);
    setTableName('');
    setHeaderInput('');
    tableDataRef.current = [];
    setTableData([]);
    setCustomHeaders([]);
    onCancel?.();
  };
  const handleCancel = () => {
    if (submitting) return;
    resetAndCancel();
  };

  // 2. 生成表格：点击确认后，根据行列数初始化表格数据和列配置
  const generateTable = () => {
    const formValues = form.getFieldsValue();
    const nextTableName = String(formValues.tableName || tableName || "");
    let nextHeaderInput = String(headerInput || formValues.headerInput || "");
    let nextColCount = Number(formValues.colCount || colCount || 0);
    let nextRowCount = Number(formValues.rowCount || rowCount || 0);

    if (isChangeReqTableName(nextTableName) && !nextHeaderInput.trim()) {
      nextHeaderInput = CHANGE_REQ_TABLE_HEADERS;
      nextColCount = 4;
      setHeaderInput(nextHeaderInput);
      setColCount(nextColCount);
      form.setFieldsValue({
        headerInput: nextHeaderInput,
        colCount: nextColCount,
      });
    }

    // 校验行列数合法性（大于0，避免无效表格）
    if (!nextRowCount || !nextColCount || nextRowCount < 1 || nextColCount < 1) {
      message.warning(ts('srs_doc.please_input_valid_row_col'));
      return;
    }

    // 处理自定义表头（转换为带UUID的对象数组）
    let headers: TableHeaderItem[] = [];
    if (nextHeaderInput.trim()) {
      // 如果输入了表头，使用逗号分隔（支持中文逗号和英文逗号）
      const headerNames = nextHeaderInput.split(/[,，]/).map(h => h.trim()).filter(h => h);
      
      // 生成带UUID的表头对象
      headers = headerNames.map(name => ({
        code: uuidv4(),
        name
      }));
      
      // 如果表头数量不足，用默认名称补齐
      while (headers.length < nextColCount) {
        const defaultName = `${ts('srs_doc.column')} ${headers.length + 1}`;
        headers.push({
          code: uuidv4(),
          name: defaultName
        });
      }
      
      // 如果表头数量过多，截取前 nextColCount 个
      headers = headers.slice(0, nextColCount);
    } else {
      // 如果没有输入表头，使用默认名称生成带UUID的表头
      headers = Array.from({ length: nextColCount }, (_, index) => ({
        code: uuidv4(),
        name: `${ts('srs_doc.column')} ${index + 1}`
      }));
    }
    setCustomHeaders(headers);

    // 初始化表格数据：生成 nextRowCount 条数据，每条数据包含 nextColCount 个可编辑字段（col_0, col_1...）
    const initTableData: TableRowData[] = Array.from({ length: nextRowCount }, (_, rowIndex) => {
      const rowData: TableRowData = { key: rowIndex, __rowMeta: {} }; // key 是 antd Table 必需的唯一标识
      // 为每一列初始化空值，用于编辑
      for (let colIndex = 0; colIndex < nextColCount; colIndex++) {
        rowData[`col_${colIndex}`] = '';
      }
      return rowData;
    });

    // 更新表格数据状态
    tableDataRef.current = initTableData;
    setTableData(initTableData);
    setRowCount(nextRowCount);
    setColCount(nextColCount);
  };

  // 3. 处理表头编辑（仅修改name，保持code不变）
  const handleHeaderEdit = (colIndex: number, value: string) => {
    const newHeaders = [...customHeaders];
    newHeaders[colIndex] = {
      ...newHeaders[colIndex],
      name: value.trim()
    };
    setCustomHeaders(newHeaders);
  };

  // 4. 构建 antd Table 所需的列配置（columns）
  const buildTableColumns = (): ColumnsType<TableRowData> => {
    if (colCount < 1) return []; // 列数为0时，返回空列配置

    const editableColumns: ColumnsType<TableRowData> = Array.from({ length: colCount }, (_, colIndex) => ({
      title: isLockedHeaderRow ? (
        <div className="editable-table-locked-cell">
          {customHeaders[colIndex]?.name || `${ts('srs_doc.column')} ${colIndex + 1}`}
        </div>
      ) : (
          <Input
            value={customHeaders[colIndex]?.name || `${ts('srs_doc.column')} ${colIndex + 1}`}
            onChange={(e) => handleHeaderEdit(colIndex, e.target.value)}
            placeholder={ts('srs_doc.please_input_content')}
            size="small"
            style={{ width: '100%' }}
          />
        ),
      dataIndex: `col_${colIndex}`, // 对应 tableData 中的字段名（与初始化数据一致）
      key: `column_${colIndex}`, // 列唯一标识
      // 5. 渲染可编辑单元格：使用 Input.TextArea 支持换行输入
      render: (text: string, record: TableRowData) => {
        const locked = isLockedRow(record);
        if (locked) {
          return (
            <div className="editable-table-locked-cell">
              {text || "-"}
            </div>
          );
        }
        return isRcmAssistRow(record, colIndex) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={ts("srs_doc.select_rcm_code") || "选择RCM"}
              options={rcmOptions}
              value={getSelectedRcmIdsByText(text ?? "")}
              onChange={(vals) => {
                const nextText = mergeRcmContent(text ?? "", (vals || []) as number[]);
                handleCellEdit(record.key, colIndex, nextText);
              }}
              disabled={locked || !rcmOptions.length}
              style={{ width: "100%" }}
              size="small"
            />
            <Input.TextArea
              value={text ?? ''}
              onChange={(e) => handleCellEdit(record.key, colIndex, e.target.value)}
              placeholder={ts('srs_doc.please_input_content')}
              autoSize={{ minRows: 2, maxRows: 8 }}
              style={{ resize: 'none' }}
              disabled={locked}
            />
          </div>
        ) : (
          <Input.TextArea
            value={text ?? ''}
            onChange={(e) => handleCellEdit(record.key, colIndex, e.target.value)}
            placeholder={ts('srs_doc.please_input_content')}
            autoSize={{ minRows: 1, maxRows: 6 }}
            style={{ resize: 'none' }}
            disabled={locked}
          />
        );
      },
    }));
    return [
      ...editableColumns,
      {
        title: "操作",
        key: "operation",
        width: 96,
        fixed: "right",
        render: (_: unknown, record: TableRowData) => (
          <Space size={4} className="editable-table-row-actions">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => handleAddRowAfter(record.key)}
            />
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={tableData.length <= 1 || isLockedRow(record)}
              onClick={() => handleDeleteRow(record.key)}
            />
          </Space>
        ),
      },
    ];
  };

  // 5. 处理单元格编辑：更新对应位置的表格数据
  const handleCellEdit = (rowKey: number, colIndex: number, value: string) => {
    // 深拷贝原有表格数据，避免直接修改状态（React 状态不可变）
    const newTableData = [...tableData];
    // 找到对应行（通过 rowKey 匹配）
    const targetRow = newTableData.find(item => item.key === rowKey);
    if (targetRow) {
      // 更新对应列的字段值
      targetRow[`col_${colIndex}`] = value;
      // 重新设置表格数据状态，触发组件重渲染
      tableDataRef.current = newTableData;
      setTableData(newTableData);
      if (submitError) setSubmitError("");
    }
  };

  const createEmptyRow = (): TableRowData => {
    const rowData: TableRowData = { key: Date.now() + Math.floor(Math.random() * 1000), __rowMeta: {} };
    for (let colIndex = 0; colIndex < colCount; colIndex++) {
      rowData[`col_${colIndex}`] = '';
    }
    return rowData;
  };

  const syncRowCount = (nextData: TableRowData[]) => {
    tableDataRef.current = nextData;
    setTableData(nextData);
    setRowCount(nextData.length);
    form.setFieldsValue({ rowCount: nextData.length });
  };

  const handleAddRowAfter = (rowKey: number) => {
    const currentIndex = tableData.findIndex((item) => item.key === rowKey);
    const insertIndex = currentIndex >= 0 ? currentIndex + 1 : tableData.length;
    const nextData = [...tableData];
    nextData.splice(insertIndex, 0, createEmptyRow());
    syncRowCount(nextData);
  };

  const handleDeleteRow = (rowKey: number) => {
    if (tableData.length <= 1) {
      message.warning("至少保留一行");
      return;
    }
    syncRowCount(tableData.filter((item) => item.key !== rowKey));
  };

  // 6. 重置表格：清空所有状态和表单
  // const resetTable = () => {
  //   form.resetFields();
  //   setRowCount(0);
  //   setColCount(0);
  //   setHeaderInput('');
  //   setTableData([]);
  //   setCustomHeaders([]);
  //   message.info(ts('srs_doc.table_reset'));
  // };

  // 7. 确认按钮：将表格数据转换为包含表头的结构返回
  const handleConfirm = () => {
    const latestTableData = tableDataRef.current.length ? tableDataRef.current : tableData;
    if (latestTableData.length === 0) {
      message.warning(ts('srs_doc.please_generate_table_first'));
      return;
    }

    // 获取最终的表头（确保每个表头都有UUID和名称）
    const headers: TableHeaderItem[] = Array.from({ length: colCount }, (_, colIndex) => {
      const existingHeader = customHeaders[colIndex];
      return existingHeader || {
        code: uuidv4(),
        name: `${ts('srs_doc.column')} ${colIndex + 1}`
      };
    });

    // 转换为二维数组格式（表格内容）
    const data: string[][] = latestTableData.map(row => {
      return Array.from({ length: colCount }, (_, colIndex) => row[`col_${colIndex}`] || '');
    });

    const result: TableDataWithHeaders = {
      tableName: tableName.trim(),
      type_code: tableMetaRef.current.type_code,
      tableId: tableMetaRef.current.tableId,
      headers,
      data,
      rowMeta: latestTableData.map((row) => ({ ...(row.__rowMeta || {}) })),
    };

    setSubmitError("");
    setSubmitting(true);
    Promise.resolve(onConfirm?.(result))
      .then(() => {
        // 确认后重置状态并关闭
        resetAndCancel();
      })
      .catch((error: any) => {
        setSubmitError(error?.message || '保存失败');
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <Modal
      title={ts('srs_doc.add_table')}
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={1000}
      destroyOnClose
    >
      <div className="editable-table-generator" style={{ padding: '20px' }}>
      {/* 第一步：表单收集行列数 */}
      <Form
        form={form}
        layout="vertical"
        style={{ marginBottom: '20px' }}
        onValuesChange={handleFormValuesChange}
      >
        <Form.Item
          name="tableName"
          label="表名"
        >
          <Input placeholder="请输入表名" />
        </Form.Item>

        <div style={{ display: 'flex', gap: '16px' }}>
          <Form.Item
            name="rowCount"
            label={ts('srs_doc.row_count')}
            rules={[{ required: true, message: ts('srs_doc.please_input_row_count') }]}
          >
            <InputNumber
              min={1}
              max={50} // 限制最大行数，避免性能问题
              style={{ width: '120px' }}
            />
          </Form.Item>

          <Form.Item
            name="colCount"
            label={ts('srs_doc.col_count')}
            rules={[{ required: true, message: ts('srs_doc.please_input_col_count') }]}
          >
            <InputNumber
              min={1}
              max={20} // 限制最大列数，避免表格过宽
              style={{ width: '120px' }}
            />
          </Form.Item>
        </div>

        <Form.Item
          label={ts('srs_doc.table_header')}
          extra={<span style={{ color: '#999', fontSize: '12px' }}>{ts('srs_doc.table_header_hint')}</span>}
        >
          <Input
            value={headerInput}
            onChange={(e) => setHeaderInput(e.target.value)}
            placeholder={ts('srs_doc.table_header_placeholder')}
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" onClick={generateTable} disabled={submitting}>
              {ts('srs_doc.generate_table_preview')}
            </Button>
            {/* <Button onClick={resetTable} danger>
              {ts('srs_doc.reset')}
            </Button> */}
          </Space>
        </Form.Item>
      </Form>

      {/* 第二步：渲染生成的可编辑表格 */}
      {tableData.length > 0 && (
        <>
          <span style={{ fontSize: '16px' }}>{ts('srs_doc.table_preview')}</span>
          <Table
            dataSource={tableData}
            columns={buildTableColumns()}
            bordered // 显示表格边框，更清晰
            pagination={false} // 关闭分页（如需分页可开启，需额外处理数据）
            scroll={{ x: 'max-content' }} // 横向滚动，适配多列场景
            size="middle"
          />
          
          {submitError ? (
            <Alert
              type="error"
              showIcon
              closable
              message={submitError}
              style={{ marginTop: 16 }}
              onClose={() => setSubmitError("")}
            />
          ) : null}

          {/* 第三步：操作按钮 */}
          <div style={{ marginTop: '20px', textAlign: 'right' }}>
            <Space>
              <Button onClick={handleCancel} disabled={submitting}>
                {ts('cancel')}
              </Button>
              <Button type="primary" onClick={handleConfirm} loading={submitting}>
                {ts('srs_doc.save_table')}
              </Button>
            </Space>
          </div>
        </>
      )}
      </div>
    </Modal>
  );
};

export default EditableTableGenerator;