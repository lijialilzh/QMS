import './EditableTableGenerator.less';
import { useState, useEffect } from 'react';
import { Form, InputNumber, Button, Table, Input, Space, message, Modal, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';

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
  headers: TableHeaderItem[];
  data: string[][];
}

// 组件 Props 类型
interface EditableTableGeneratorProps {
  open?: boolean;
  initialData?: TableDataWithHeaders; // 初始数据，用于编辑模式
  rcmOptions?: Array<{ value: number; label: string; description?: string }>;
  onConfirm?: (tableData: TableDataWithHeaders) => void;
  onCancel?: () => void;
}

// 可编辑表格组件
const EditableTableGenerator: React.FC<EditableTableGeneratorProps> = ({ open = false, initialData, rcmOptions = [], onConfirm, onCancel }) => {
  const { t: ts } = useTranslation();
  
  // 1. 状态管理：行列数、表格数据、表单实例
  const [rowCount, setRowCount] = useState<number>(0); // 行数
  const [colCount, setColCount] = useState<number>(0); // 列数
  const [headerInput, setHeaderInput] = useState<string>(''); // 表头输入（逗号分隔，仅存储name）
  const [tableData, setTableData] = useState<TableRowData[]>([]); // 表格核心数据
  const [customHeaders, setCustomHeaders] = useState<TableHeaderItem[]>([]); // 自定义表头数组（新结构）
  const [form] = Form.useForm(); // 表单实例，用于收集和重置行列数

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

  const getSelectedRcmIdsByText = (text: string): number[] => {
    const codes = extractRcmCodesFromText(text);
    const ids = codes
      .map((code) => rcmOptions.find((o) => normalizeRcmCode(o.label) === code)?.value)
      .filter((v): v is number => typeof v === "number");
    return Array.from(new Set(ids));
  };

  // 当 initialData 变化或弹框打开时，初始化数据
  useEffect(() => {
    if (open && initialData) {
      // 编辑模式：加载已有数据（适配新的表头结构）
      const headers = initialData.headers.map(header => ({
        code: header.code || uuidv4(), // 确保有UUID，无则自动生成
        name: header.name.trim()
      }));
      const data = initialData.data;
      
      setColCount(headers.length);
      setRowCount(data.length);
      setHeaderInput(headers.map(h => h.name).join(',')); // 输入框只显示name
      setCustomHeaders(headers);
      
      // 初始化表格数据
      const initTableData: TableRowData[] = data.map((row, rowIndex) => {
        const rowData: TableRowData = { key: rowIndex };
        headers.forEach((_header, colIndex) => {
          rowData[`col_${colIndex}`] = row[colIndex] || '';
        });
        return rowData;
      });
      setTableData(initTableData);
      
      form.setFieldsValue({
        rowCount: data.length,
        colCount: headers.length,
        headerInput: headers.map(h => h.name).join(',')
      });
    } else if (open && !initialData) {
      // 新增模式：重置所有数据
      form.resetFields();
      setRowCount(0);
      setColCount(0);
      setHeaderInput('');
      setTableData([]);
      setCustomHeaders([]);
    }
  }, [open, initialData, form]);

  // 当 Modal 关闭时重置状态
  const handleCancel = () => {
    form.resetFields();
    setRowCount(0);
    setColCount(0);
    setHeaderInput('');
    setTableData([]);
    setCustomHeaders([]);
    onCancel?.();
  };

  // 2. 生成表格：点击确认后，根据行列数初始化表格数据和列配置
  const generateTable = () => {
    // 校验行列数合法性（大于0，避免无效表格）
    if (!rowCount || !colCount || rowCount < 1 || colCount < 1) {
      message.warning(ts('srs_doc.please_input_valid_row_col'));
      return;
    }

    // 处理自定义表头（转换为带UUID的对象数组）
    let headers: TableHeaderItem[] = [];
    if (headerInput.trim()) {
      // 如果输入了表头，使用逗号分隔（支持中文逗号和英文逗号）
      const headerNames = headerInput.split(/[,，]/).map(h => h.trim()).filter(h => h);
      
      // 生成带UUID的表头对象
      headers = headerNames.map(name => ({
        code: uuidv4(),
        name
      }));
      
      // 如果表头数量不足，用默认名称补齐
      while (headers.length < colCount) {
        const defaultName = `${ts('srs_doc.column')} ${headers.length + 1}`;
        headers.push({
          code: uuidv4(),
          name: defaultName
        });
      }
      
      // 如果表头数量过多，截取前 colCount 个
      headers = headers.slice(0, colCount);
    } else {
      // 如果没有输入表头，使用默认名称生成带UUID的表头
      headers = Array.from({ length: colCount }, (_, index) => ({
        code: uuidv4(),
        name: `${ts('srs_doc.column')} ${index + 1}`
      }));
    }
    setCustomHeaders(headers);

    // 初始化表格数据：生成 rowCount 条数据，每条数据包含 colCount 个可编辑字段（col_0, col_1...）
    const initTableData: TableRowData[] = Array.from({ length: rowCount }, (_, rowIndex) => {
      const rowData: TableRowData = { key: rowIndex }; // key 是 antd Table 必需的唯一标识
      // 为每一列初始化空值，用于编辑
      for (let colIndex = 0; colIndex < colCount; colIndex++) {
        rowData[`col_${colIndex}`] = '';
      }
      return rowData;
    });

    // 更新表格数据状态
    setTableData(initTableData);
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

    return Array.from({ length: colCount }, (_, colIndex) => ({
      title: (
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
      render: (text: string, record: TableRowData) => (
        isRcmAssistRow(record, colIndex) ? (
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
              disabled={!rcmOptions.length}
              style={{ width: "100%" }}
              size="small"
            />
            <Input.TextArea
              value={text ?? ''}
              onChange={(e) => handleCellEdit(record.key, colIndex, e.target.value)}
              placeholder={ts('srs_doc.please_input_content')}
              autoSize={{ minRows: 2, maxRows: 8 }}
              style={{ resize: 'none' }}
            />
          </div>
        ) : (
          <Input.TextArea
            value={text ?? ''}
            onChange={(e) => handleCellEdit(record.key, colIndex, e.target.value)}
            placeholder={ts('srs_doc.please_input_content')}
            autoSize={{ minRows: 1, maxRows: 6 }}
            style={{ resize: 'none' }}
          />
        )
      ),
    }));
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
      setTableData(newTableData);
    }
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
    if (tableData.length === 0) {
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
    const data: string[][] = tableData.map(row => {
      return Array.from({ length: colCount }, (_, colIndex) => row[`col_${colIndex}`] || '');
    });

    const result: TableDataWithHeaders = {
      headers,
      data
    };

    onConfirm?.(result);
    
    // 确认后重置状态并关闭
    handleCancel();
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
      >
        <div style={{ display: 'flex', gap: '16px' }}>
          <Form.Item
            name="rowCount"
            label={ts('srs_doc.row_count')}
            rules={[{ required: true, message: ts('srs_doc.please_input_row_count') }]}
          >
            <InputNumber
              min={1}
              max={50} // 限制最大行数，避免性能问题
              value={rowCount}
              onChange={(value) => setRowCount(value || 0)}
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
              value={colCount}
              onChange={(value) => setColCount(value || 0)}
              style={{ width: '120px' }}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="headerInput"
          label={ts('srs_doc.table_header')}
        >
          <Input
            value={headerInput}
            onChange={(e) => setHeaderInput(e.target.value)}
            placeholder={ts('srs_doc.table_header_placeholder')}
          />
          <div style={{ marginBottom: '16px', color: '#999', fontSize: '12px' }}>
            {ts('srs_doc.table_header_hint')}
          </div>
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" onClick={generateTable}>
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
          
          {/* 第三步：操作按钮 */}
          <div style={{ marginTop: '20px', textAlign: 'right' }}>
            <Space>
              <Button onClick={onCancel}>
                {ts('cancel')}
              </Button>
              <Button type="primary" onClick={handleConfirm}>
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