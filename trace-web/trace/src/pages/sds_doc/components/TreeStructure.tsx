import "./TreeStructure.less";
import { useState, useEffect } from "react";
import { Button, Input, Space, Popconfirm, Upload, Table, message, Empty, Tooltip, Image } from "antd";
import { PlusOutlined, DeleteOutlined, TableOutlined, EditOutlined, UploadOutlined, FileOutlined } from "@ant-design/icons";
import { numberToChinese } from "@/common";
import { useTranslation } from "react-i18next";
import EditableTableGenerator, { TableDataWithHeaders } from "./EditableTableGenerator";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile, UploadProps } from "antd/es/upload/interface";
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from "xlsx";
import * as Api from "@/api/ApiSdsDoc";

// 表格数据结构（匹配后端接口，允许空对象表示无表格数据）
interface TableData {
    headers?: Array<{ code: string; name: string }>;
    rows?: { [key: string]: string }[];
    cells?: Array<Array<{ value?: string; row_span?: number; col_span?: number; h_align?: string; v_align?: string }>>;
}

export interface TreeNode {
    id: number;          
    doc_id?: number;
    n_id?: number;
    p_id?: number;
    title: string;
    sds_code?: string;   // 标准模板中需填写 SDS 编码的节点（有该字段则显示输入框，空也显示）
    ref_type?: string;   // topo_1=拓扑图、struct_1=系统结构图 时展示页面级图片，不展示上传和 textarea
    img_url?: string;
    text?: string;
    table?: TableData | null; // 允许空对象/ null 表示无表格数据
    children: TreeNode[];
}

const SDS_REF_TYPE_LABEL_KEYS: Record<string, string> = {
    img_topo: 'sds_doc.ref_type_topo',
    img_struct: 'sds_doc.ref_type_struct',
    img_flow: 'sds_doc.ref_type_flow',
};

function getSdsRefTypeLabel(refType: string | undefined, ts: (key: string) => string): string {
    if (!refType) return '';
    return ts(SDS_REF_TYPE_LABEL_KEYS[refType] || refType);
}

const SDS_IMAGE_REF_TYPES = ['img_topo', 'img_struct', 'img_flow'];
function isDocImageRefType(refType: string | undefined): boolean {
    return !!refType && SDS_IMAGE_REF_TYPES.includes(refType);
}

interface TreeNodeItemProps {
    node: TreeNode;
    level: number;
    docId?: number;
    readOnly?: boolean;
    onAdd: (parentId: number) => void;
    onAddSibling: (nodeId: number, position: 'before' | 'after', defaultTitle: string) => void;
    onDelete: (id: number) => Promise<void>;
    onTitleChange: (id: number, title: string) => void;
    onSdsCodeChange: (id: number, value: string) => void;
    onImageChange: (id: number, imgUrl: string) => void;
    onContentChange: (id: number, content: string) => void;
    onAddTable: (id: number) => void;
    onImportTable: (id: number, file: File) => Promise<void>;
    onEditTable: (id: number) => void;
    onDeleteTable: (id: number) => void;
    onOpenReqdList?: () => void;   // 打开设计列表弹框（ref_type=sds_reqds）
    onOpenTraceList?: () => void;  // 打开需求追溯表弹框（ref_type=sds_traces）
}

const TreeNodeItem = ({ node, level, docId, readOnly, onAdd, onAddSibling, onDelete, onTitleChange, onSdsCodeChange, onImageChange, onContentChange, onAddTable, onImportTable, onEditTable, onDeleteTable, onOpenReqdList, onOpenTraceList }: TreeNodeItemProps) => {
    const { t: ts } = useTranslation();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploadLoading, setUploadLoading] = useState(false);

    // 当节点的 img_url 变化时，更新 fileList
    useEffect(() => {
        if (node.img_url) {
            setFileList([{
                uid: '-1',
                name: 'image.png',
                status: 'done',
                url: `${window.location.origin}/${node.img_url}`,
            }]);
        } else {
            setFileList([]);
        }
    }, [node.img_url]);

    // 图片上传配置（Upload 无 loading 属性，通过 disabled 在上传时禁用）
    const uploadProps: UploadProps = {
        maxCount: 1,
        fileList: fileList,
        disabled: uploadLoading,
        beforeUpload: async (file) => {
            try {
                setUploadLoading(true);
                const formData = new FormData();
                formData.append('file', file);
                formData.append('doc_id', String(docId ?? 0));
                
                // 调用add_doc_file接口上传图片
                const res = await Api.add_doc_file(formData); // 第一个参数根据实际fileType调整
                if (res.code === Api.C_OK || res.code === 1) { // 兼容1表示成功的情况
                    const imgUrl = res.data; // 接口返回的data就是图片服务器地址
                    onImageChange(node.id, imgUrl);
                    setFileList([{
                        uid: file.uid,
                        name: file.name,
                        status: 'done',
                        url: `${window.location.origin}/${imgUrl}`
                    }]);
                    message.success(ts('upload_success'));
                } else {
                    message.error(res.msg || ts('upload_failed'));
                }
            } catch (error) {
                console.error('图片上传失败:', error);
                message.error(ts('upload_failed'));
            } finally {
                setUploadLoading(false);
            }
            return false; // 阻止自动上传
        },
        onRemove: () => {
            onImageChange(node.id, '');
            setFileList([]);
        },
        accept: "image/*",
        showUploadList: false,
    };

    const tableImportProps: UploadProps = {
        showUploadList: false,
        accept: ".xlsx,.xls,.csv,text/csv",
        beforeUpload: async (file) => {
            await onImportTable(node.id, file as File);
            return false;
        },
    };

    // 构建表格列配置：列少时加大列宽，列多时缩小并启用横向滚动
    const buildTableColumns = (): ColumnsType<any> => {
        if (!node.table || !node.table.headers || node.table.headers.length === 0) {
            return [];
        }
        const tableCells = node.table.cells || [];
        const hasMergedCells = Array.isArray(tableCells) && tableCells.length > 1;
        const colCount = node.table.headers.length;
        const colWidth = Math.max(150, Math.min(380, 1200 / colCount));
        return node.table.headers.map((header, index) => {
            const col: any = {
                title: header.name,
                dataIndex: header.code,
                key: `col_${index}`,
                width: colWidth,
            };
            if (hasMergedCells) {
                col.render = (_val: any, _row: any, rowIndex: number) => {
                    const bodyCells = tableCells.slice(1);
                    const cell = bodyCells[rowIndex]?.[index];
                    const rowSpan = cell?.row_span ?? 1;
                    const colSpan = cell?.col_span ?? 1;
                    const hAlign = (cell?.h_align || "left") as "left" | "center" | "right";
                    const vAlign = (cell?.v_align || "top") as "top" | "middle" | "bottom";
                    return {
                        children: <div style={{ whiteSpace: "pre-line" }}>{cell?.value || ""}</div>,
                        props: { rowSpan, colSpan, style: { textAlign: hAlign, verticalAlign: vAlign } },
                    };
                };
            }
            return col;
        });
    };

    // 构建表格数据源
    const buildTableDataSource = () => {
        if (!node.table || !node.table.rows || node.table.rows.length === 0) {
            return [];
        }
        const tableCells = node.table.cells || [];
        const hasMergedCells = Array.isArray(tableCells) && tableCells.length > 1;
        if (hasMergedCells && node.table.headers) {
            const bodyCells = tableCells.slice(1);
            return bodyCells.map((row, rowIndex) => {
                const rowObj: any = { key: rowIndex };
                node.table!.headers!.forEach((header, colIdx) => {
                    rowObj[header.code] = row?.[colIdx]?.value || "";
                });
                return rowObj;
            });
        }

        return node.table.rows.map((row, index) => ({
            key: index,
            ...row
        }));
    };

    const hasTable = node.table && 
                     node.table.headers && 
                     Array.isArray(node.table.headers) && 
                     node.table.headers.length > 0 &&
                     node.table.rows && 
                     Array.isArray(node.table.rows) && 
                     node.table.rows.length > 0;

    return (
        <div style={{ marginLeft: level * 32 }}>
          <div className={`tree-node-item level-${level}`}>
              <div className="node-row">
                  {!readOnly && (
                    <Tooltip title={ts('sds_doc.add_sibling_before') || '在前面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'before', node.title)}
                      />
                    </Tooltip>
                  )}
                  <span className="node-title-prefix">{numberToChinese(level + 1)}{ts('level_menu')}</span>
                  <Input
                      className="node-title"
                      value={node.title}
                      onChange={(e) => onTitleChange(node.id, e.target.value)}
                      placeholder={ts('please_input_title')}
                      disabled={readOnly}
                  />
                  {
                    ('sds_code' in node) && (
                        <Input
                            className="node-sds-code"
                            value={node.sds_code ?? ''}
                            onChange={(e) => onSdsCodeChange(node.id, e.target.value)}
                            placeholder={ts('please_input_sds_code')}
                            disabled={readOnly}
                        />
                    )
                  }
                  {isDocImageRefType(node.ref_type) && (
                      <div className="node-file-ref node-content">
                          {node.img_url ? (
                              <a
                                  href={`/${node.img_url}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="node-file-link"
                              >
                                  <FileOutlined /> {getSdsRefTypeLabel(node.ref_type, ts)}
                              </a>
                          ) : (
                              <Tooltip title={ts('srs_doc.no_file')}>
                                  <span className="node-file-empty">
                                      <FileOutlined /> {getSdsRefTypeLabel(node.ref_type, ts)}
                                  </span>
                              </Tooltip>
                          )}
                      </div>
                  )}
                  {/* 编辑/查看模式均显示已上传的图片预览 */}
                  {level <= 2 && node.img_url && (
                      <div className="node-pic node-pic-readonly">
                          <Image
                              src={node.img_url.startsWith('http') ? node.img_url : `${window.location.origin}/${node.img_url.replace(/^\//, '')}`}
                              alt={node.title || 'image'}
                              preview={true}
                          />
                      </div>
                  )}
                  {level <= 2 && !readOnly && (
                      <Upload {...uploadProps} className="node-pic">
                          <Button size="small" icon={<UploadOutlined />}>
                              {node.img_url ? "重新上传" : ts("select_file")}
                          </Button>
                      </Upload>
                  )}
                  <Input.TextArea
                      className="node-content node-text-area"
                      value={node.text}
                      onChange={(e) => onContentChange(node.id, e.target.value)}
                      placeholder={ts('srs_doc.please_input_content')}
                      size="small"
                      rows={1}
                      autoSize={{ minRows: 1, maxRows: 6 }}
                      disabled={readOnly}
                  />
                  {node.ref_type === 'sds_reqds' && onOpenReqdList && (
                      <Button type="primary" size="small" className="node-srsreq-btn" onClick={onOpenReqdList}>
                          {ts('menu.sds_reqds') || '设计列表'}
                      </Button>
                  )}
                  {node.ref_type === 'sds_traces' && onOpenTraceList && (
                      <Button type="primary" size="small" className="node-srsreq-btn" onClick={onOpenTraceList}>
                          {ts('menu.sds_traces') || '需求追溯表'}
                      </Button>
                  )}
                  {!readOnly && (
                    <Tooltip title={ts('sds_doc.add_sibling_after') || '在后面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'after', node.title)}
                      />
                    </Tooltip>
                  )}
                  {!readOnly && (
                  <Space className="node-actions" size={8}>
                      {
                        level < 2 && (
                        <Button
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => onAdd(node.id)}>
                          {ts('add')}{numberToChinese(level + 2)}{ts('level_menu')}
                        </Button>)
                      }
                      {!isDocImageRefType(node.ref_type) && node.ref_type !== 'sds_reqds' && node.ref_type !== 'sds_traces' && (
                      <Button
                          size="small"
                          icon={<TableOutlined />}
                          onClick={() => onAddTable(node.id)}>
                          {ts('srs_doc.table')}
                      </Button>
                      )}
                      {!isDocImageRefType(node.ref_type) && node.ref_type !== 'sds_reqds' && node.ref_type !== 'sds_traces' && (
                      <Upload {...tableImportProps}>
                          <Button
                              size="small"
                              icon={<UploadOutlined />}>
                              导入表格
                          </Button>
                      </Upload>
                      )}
                      <Popconfirm
                          title={ts('confirm_delete')}
                          onConfirm={() => onDelete(node.id)}
                          okText={ts('confirm')}
                          cancelText={ts('cancel')}>
                          <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}>
                              {ts('delete')}
                          </Button>
                      </Popconfirm>
                  </Space>
                  )}
              </div>
              
              {/* 显示表格数据（ref_type 节点不展示表格） */}
              {hasTable && !isDocImageRefType(node.ref_type) && node.ref_type !== 'sds_reqds' && node.ref_type !== 'sds_traces' && (
                  <div className="node-table">
                      <div className="node-table-header">
                          <div className="node-table-scroll">
                          <Table
                              columns={buildTableColumns()}
                              dataSource={buildTableDataSource()}
                              pagination={false}
                              size="small"
                              bordered
                              scroll={{ x: node.table!.headers!.length * Math.max(150, Math.min(380, 1200 / node.table!.headers!.length)) }}
                          />
                          </div>
                          {!readOnly && (
                          <Space className="node-table-actions" size={8}>
                              <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => onEditTable(node.id)}>
                                  {ts('edit')}
                              </Button>
                              <Popconfirm
                                  title={ts('srs_doc.confirm_delete_table')}
                                  onConfirm={() => onDeleteTable(node.id)}
                                  okText={ts('confirm')}
                                  cancelText={ts('cancel')}>
                                  <Button
                                      size="small"
                                      danger
                                      icon={<DeleteOutlined />}>
                                      {ts('delete')}
                                  </Button>
                              </Popconfirm>
                          </Space>
                          )}
                      </div>
                  </div>
              )}
          </div>
            {node.children && node.children.map((child) => (
                <TreeNodeItem
                    key={child.id}
                    node={child}
                    level={level + 1}
                    docId={docId}
                    readOnly={readOnly}
                    onAdd={onAdd}
                    onAddSibling={onAddSibling}
                    onDelete={onDelete}
                    onTitleChange={onTitleChange}
                    onSdsCodeChange={onSdsCodeChange}
                    onImageChange={onImageChange}
                    onContentChange={onContentChange}
                    onAddTable={onAddTable}
                    onImportTable={onImportTable}
                    onEditTable={onEditTable}
                    onDeleteTable={onDeleteTable}
                    onOpenReqdList={onOpenReqdList}
                    onOpenTraceList={onOpenTraceList}
                />
            ))}
        </div>
    );
};

interface TreeStructureProps {
    value?: TreeNode[];
    onChange?: (value: TreeNode[]) => void;
    docId?: number;
    onNodeDelete?: (docId: number, nodeId: number) => Promise<boolean>; // 删除节点回调
    readOnly?: boolean;
    onOpenReqdList?: () => void;   // 打开设计列表弹框
    onOpenTraceList?: () => void;  // 打开需求追溯表弹框
}

export default ({ value = [], onChange, docId, onNodeDelete, readOnly, onOpenReqdList, onOpenTraceList }: TreeStructureProps) => {
    const { t: ts } = useTranslation();
    const [nodes, setNodes] = useState<TreeNode[]>(value);
    const [tableModalVisible, setTableModalVisible] = useState(false);
    const [currentNodeId, setCurrentNodeId] = useState<number | null>(null);
    const [initialTableData, setInitialTableData] = useState<TableDataWithHeaders | undefined>(undefined);
    const [tableCellsBackup, setTableCellsBackup] = useState<TableData["cells"] | undefined>(undefined);

    // 同步外部传入的 value 到内部状态
    useEffect(() => {
        setNodes(value);
    }, [value]);

    const updateNodes = (newNodes: TreeNode[]) => {
        setNodes(newNodes);
        onChange?.(newNodes);
    };

    const generateId = () => {
        // 临时ID使用时间戳，实际应由后端返回
        return Date.now() + Math.floor(Math.random() * 1000);
    };

    const findNodeAndUpdate = (
        nodes: TreeNode[],
        targetId: number,
        updateFn: (node: TreeNode) => TreeNode | null
    ): TreeNode[] => {
        return nodes.map(node => {
            if (node.id === targetId) {
                const updated = updateFn(node);
                return updated === null ? node : updated;
            }
            if (node.children && node.children.length > 0) {
                return {
                    ...node,
                    children: findNodeAndUpdate(node.children, targetId, updateFn)
                };
            }
            return node;
        }).filter(node => node !== null);
    };

    const deleteNode = (nodes: TreeNode[], targetId: number): TreeNode[] => {
        return nodes.filter(node => {
            if (node.id === targetId) {
                return false;
            }
            if (node.children && node.children.length > 0) {
                node.children = deleteNode(node.children, targetId);
            }
            return true;
        });
    };

    const handleAdd = (parentId: number) => {
        // 查找父节点以获取其信息
        let parentNode: TreeNode | undefined = undefined;
        const findParent = (nodeList: TreeNode[]): TreeNode | undefined => {
            for (const node of nodeList) {
                if (node.id === parentId) {
                    return node;
                }
                if (node.children && node.children.length > 0) {
                    const found = findParent(node.children);
                    if (found) return found;
                }
            }
            return undefined;
        };
        parentNode = findParent(nodes);

        const newNode: TreeNode = {
            id: generateId(),
            doc_id: parentNode?.doc_id || 0,
            n_id: 0, // 新节点，后端生成
            p_id: parentNode?.n_id || 0, // 使用父节点的n_id
            title: "",
            img_url: undefined,
            text: "",
            table: {},
            children: []
        };

        const newNodes = findNodeAndUpdate(nodes, parentId, (node) => ({
            ...node,
            children: [...node.children, newNode]
        }));

        updateNodes(newNodes);
    };

    const handleAddSibling = (targetId: number, position: 'before' | 'after', _defaultTitle: string) => {
        const insertSibling = (list: TreeNode[], parentNode?: TreeNode): TreeNode[] => {
            const idx = list.findIndex((n) => n.id === targetId);
            if (idx >= 0) {
                const sibling = list[idx];
                const newNode: TreeNode = {
                    id: generateId(),
                    doc_id: sibling.doc_id || 0,
                    n_id: 0,
                    p_id: parentNode?.n_id ?? sibling.p_id ?? 0,
                    title: "",
                    img_url: undefined,
                    text: '',
                    table: {},
                    children: []
                };
                const insertIndex = position === 'before' ? idx : idx + 1;
                return [
                    ...list.slice(0, insertIndex),
                    newNode,
                    ...list.slice(insertIndex)
                ];
            }
            return list.map((node) => ({
                ...node,
                children: insertSibling(node.children || [], node)
            }));
        };
        const newNodes = insertSibling(nodes, undefined);
        updateNodes(newNodes);
    };

    const handleDelete = async (id: number) => {
        // 查找要删除的节点
        const findNodeById = (nodeList: TreeNode[], targetId: number): TreeNode | undefined => {
            for (const node of nodeList) {
                if (node.id === targetId) return node;
                if (node.children) {
                    const found = findNodeById(node.children, targetId);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const nodeToDelete = findNodeById(nodes, id);
        
        // 如果节点有 n_id（已保存到后端），则调用删除API
        if (nodeToDelete?.n_id && docId && onNodeDelete) {
            const success = await onNodeDelete(docId, nodeToDelete.n_id);
            if (!success) return; // 删除失败，不更新前端状态
        }

        const newNodes = deleteNode(nodes, id);
        updateNodes(newNodes);
    };

    const handleTitleChange = (id: number, title: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            title
        }));
        updateNodes(newNodes);
    };

    const handleSdsCodeChange = (id: number, sds_code: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            sds_code
        }));
        updateNodes(newNodes);
    };

    const handleImageChange = (id: number, img_url: string) => {
        const updateImageById = (nodeList: TreeNode[]): TreeNode[] => {
            return nodeList.map((node) => {
                const sameNode = String(node.id) === String(id) || String(node.n_id ?? "") === String(id);
                if (sameNode) {
                    return { ...node, img_url };
                }
                if (node.children && node.children.length > 0) {
                    return { ...node, children: updateImageById(node.children) };
                }
                return node;
            });
        };
        updateNodes(updateImageById(nodes));
    };

    const handleContentChange = (id: number, text: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            text
        }));
        updateNodes(newNodes);
    };

    const handleAddTable = (id: number) => {
        setCurrentNodeId(id);
        setTableModalVisible(true);
        setInitialTableData(undefined); // 新增模式，不传初始数据
        setTableCellsBackup(undefined);
    };

    const parseExcelToTables = (file: File): Promise<Array<{ sheetName: string; table: TableData }>> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = event.target?.result;
                    if (!data) {
                        reject(new Error("empty_file"));
                        return;
                    }
                    const workbook = XLSX.read(data, { type: "array" });
                    const sheetNames = workbook.SheetNames || [];
                    if (sheetNames.length === 0) {
                        reject(new Error("empty_sheet"));
                        return;
                    }
                    const tables: Array<{ sheetName: string; table: TableData }> = [];
                    for (const sheetName of sheetNames) {
                        const worksheet = workbook.Sheets[sheetName];
                        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" }) as any[][];
                        const normalized = matrix.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []));
                        const validRows = normalized.filter((row) => row.some((cell) => cell !== ""));
                        if (validRows.length < 2) {
                            reject(new Error(`invalid_sheet:${sheetName}`));
                            return;
                        }
                        const [headerRow, ...bodyRows] = validRows;
                        const headers = headerRow.map((name, idx) => ({
                            code: uuidv4(),
                            name: name || `列${idx + 1}`,
                        }));
                        if (headers.length === 0) {
                            reject(new Error(`invalid_header:${sheetName}`));
                            return;
                        }
                        const rows = bodyRows.map((row) => {
                            const rowObj: { [key: string]: string } = {};
                            headers.forEach((header, idx) => {
                                rowObj[header.code] = String(row[idx] ?? "").trim();
                            });
                            return rowObj;
                        });
                        tables.push({ sheetName, table: { headers, rows } });
                    }
                    resolve(tables);
                } catch {
                    reject(new Error("parse_failed"));
                }
            };
            reader.onerror = () => reject(new Error("read_failed"));
            reader.readAsArrayBuffer(file);
        });
    };

    const handleImportTable = async (id: number, file: File) => {
        try {
            const importedTables = await parseExcelToTables(file);
            const insertImportedSheets = (nodeList: TreeNode[], parentNode?: TreeNode): TreeNode[] => {
                const idx = nodeList.findIndex((n) => n.id === id);
                if (idx >= 0) {
                    const target = nodeList[idx];
                    const currentSheet = importedTables[0];
                    const siblingSheets = importedTables.slice(1);
                    const currentNode: TreeNode = {
                        ...target,
                        table: currentSheet.table,
                    };
                    const siblingNodes: TreeNode[] = siblingSheets.map((sheet) => ({
                        id: generateId(),
                        doc_id: target.doc_id || 0,
                        n_id: 0,
                        p_id: parentNode?.n_id ?? target.p_id ?? 0,
                        title: "",
                        ...(("sds_code" in target) ? { sds_code: target.sds_code ?? "" } : {}),
                        img_url: undefined,
                        text: "",
                        table: sheet.table,
                        children: [],
                    }));
                    return [
                        ...nodeList.slice(0, idx),
                        currentNode,
                        ...siblingNodes,
                        ...nodeList.slice(idx + 1),
                    ];
                }
                return nodeList.map((node) => ({
                    ...node,
                    children: insertImportedSheets(node.children || [], node),
                }));
            };
            const newNodes = insertImportedSheets(nodes);
            updateNodes(newNodes);
            message.success("导入成功");
        } catch {
            message.error("导入失败，请检查Excel内容（首行表头，至少一行数据）");
        }
    };

    const handleEditTable = (id: number) => {
        // 查找节点
        const findNode = (nodeList: TreeNode[], targetId: number): TreeNode | undefined => {
            for (const node of nodeList) {
                if (node.id === targetId) {
                    return node;
                }
                if (node.children && node.children.length > 0) {
                    const found = findNode(node.children, targetId);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const targetNode = findNode(nodes, id);
        if (!targetNode || !targetNode.table) return;
    
        // 适配新的表头结构：将字符串表头/带code的表头转换为 TableHeaderItem 数组
        const headers = (targetNode.table.headers || []).map(header => {
            // 兼容旧数据（字符串表头）和新数据（{code, name} 表头）
            if (typeof header === 'string') {
                return {
                    code: uuidv4(), // 为旧字符串表头生成新的UUID
                    name: header
                };
            }
            return {
                code: header.code || uuidv4(), // 确保有UUID
                name: header.name || ''
            };
        });
        
        const rows = targetNode.table.rows || [];
        if (headers.length === 0) return;

        const tableData: TableDataWithHeaders = {
            headers,
            data: rows.map(row => 
                headers.map(header => row[header.code] || '')
            )
        };

        setCurrentNodeId(id);
        setInitialTableData(tableData);
        setTableCellsBackup(targetNode.table.cells);
        setTableModalVisible(true);
    };

    const handleDeleteTable = (id: number) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            table: {}
        }));
        updateNodes(newNodes);
    };

    const handleTableConfirm = (tableData: TableDataWithHeaders) => {
        if (currentNodeId === null) return;

        const rebuildMergedCells = () => {
            const cells = tableCellsBackup;
            if (!cells || !Array.isArray(cells) || cells.length < 2) return undefined;
            const rowCount = tableData.data.length;
            const colCount = tableData.headers.length;
            if (cells.length !== rowCount + 1) return undefined;
            if (!cells.every((r) => Array.isArray(r) && r.length === colCount)) return undefined;
            const next = cells.map((r) => r.map((c) => ({ ...c })));
            for (let c = 0; c < colCount; c++) {
                next[0][c].value = tableData.headers[c]?.name || "";
                next[0][c].row_span = next[0][c].row_span ?? 1;
                next[0][c].col_span = next[0][c].col_span ?? 1;
            }
            for (let r = 0; r < rowCount; r++) {
                for (let c = 0; c < colCount; c++) {
                    const cell = next[r + 1][c];
                    const rs = cell?.row_span ?? 1;
                    const cs = cell?.col_span ?? 1;
                    if (rs === 0 || cs === 0) continue;
                    next[r + 1][c].value = tableData.data[r]?.[c] || "";
                }
            }
            return next;
        };
    
        // 转换为父组件存储的格式：rows 是对象数组，键为表头name（或code），值为单元格内容
        const rows: { [key: string]: string }[] = tableData.data
            .map(row => {
                const rowObj: { [key: string]: string } = {};
                tableData.headers.forEach((header, index) => {
                    rowObj[header.code] = row[index] || ''; // 键=code，值=单元格内容
                });
                return rowObj;
            })
            // 过滤掉整行都是空字符串的行
            .filter(row => {
                return Object.values(row).some(value => value.trim() !== '');
            });

        // 如果过滤后没有有效行，或者表头为空，则设置为空对象
        let tableFormat: TableData | null = {};
        if (rows.length > 0 && tableData.headers.length > 0 && tableData.headers.some(h => h.name.trim() !== '')) {
            const mergedCells = rebuildMergedCells();
            tableFormat = {
                // 存储完整的表头对象（包含code和name）
                headers: tableData.headers.map(header => ({
                    code: header.code,
                    name: header.name.trim()
                })),
                rows: rows,
                cells: mergedCells,
            };
            if (tableCellsBackup && !mergedCells) {
                message.warning("表格结构已变化，合并单元格已按新结构重建。");
            }
        }

        const newNodes = findNodeAndUpdate(nodes, currentNodeId, (node) => ({
            ...node,
            table: tableFormat
        }));
        updateNodes(newNodes);
        setTableCellsBackup(undefined);
    };

    return (
        <>
            <div className="tree-structure-container">
                {nodes.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={ts("sds_doc.empty_directory_structure")}
                        className="tree-structure-empty"
                    />
                ) : nodes.map((node) => (
                  <div className="tree-node-item-wrapper" key={node.id}>
                    <TreeNodeItem
                        node={node}
                        level={0}
                        docId={docId}
                        readOnly={readOnly}
                        onAdd={handleAdd}
                        onAddSibling={handleAddSibling}
                        onDelete={handleDelete}
                        onTitleChange={handleTitleChange}
                        onSdsCodeChange={handleSdsCodeChange}
                        onImageChange={handleImageChange}
                        onContentChange={handleContentChange}
                        onAddTable={handleAddTable}
                        onImportTable={handleImportTable}
                        onEditTable={handleEditTable}
                        onDeleteTable={handleDeleteTable}
                        onOpenReqdList={onOpenReqdList}
                        onOpenTraceList={onOpenTraceList}
                    />
                  </div>
                ))}
            </div>

            {/* 添加/编辑表格弹框 */}
            <EditableTableGenerator
                open={tableModalVisible}
                initialData={initialTableData}
                onConfirm={handleTableConfirm}
                onCancel={() => {
                    setTableModalVisible(false);
                    setCurrentNodeId(null);
                    setInitialTableData(undefined);
                    setTableCellsBackup(undefined);
                }}
            />
        </>
    );
};