import "./TreeStructure.less";
import { useState, useEffect } from "react";
import { Button, Input, Space, Popconfirm, Table, Empty, Tooltip, Select, Tag, Upload, message, Image } from "antd";
import { PlusOutlined, DeleteOutlined, TableOutlined, EditOutlined, FileOutlined, UploadOutlined, CaretRightOutlined, CaretDownOutlined } from "@ant-design/icons";
import { numberToChinese } from "@/common";
import { useTranslation } from "react-i18next";
import EditableTableGenerator, { TableDataWithHeaders } from "./EditableTableGenerator";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile, UploadProps } from "antd/es/upload/interface";
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from "xlsx";
import * as Api from "@/api/ApiSrsDoc";

// 表格数据结构（匹配后端接口，允许空对象表示无表格数据）
interface TableData {
    show_header?: number;
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
    srs_code?: string | null; // 标准模板中需填写 SRS 编码的节点：srs_code=null 时不展示输入框
    rcm_codes?: string[] | null; // RCM 编号数组（code 列表），用于章节 RCM 选择控件
    text?: string;
    ref_type?: string;  // 有则表示该节点对应文件，用 img_url 展示，替换 textarea
    img_url?: string;  // 文件地址，点击下载/打开
    label?: string;    // 不展示，但上传时需传递给后端
    table?: TableData | null; // 允许空对象/ null 表示无表格数据
    children: TreeNode[];
}

const REF_TYPE_LABEL_KEYS: Record<string, string> = {
    img_struct: 'srs_doc.ref_type_struct',
    img_flow: 'srs_doc.ref_type_flow',
    img_topo: 'srs_doc.ref_type_topo',
};

function getRefTypeLabel(refType: string | undefined, ts: (key: string) => string): string {
    if (!refType) return '';
    return ts(REF_TYPE_LABEL_KEYS[refType] || refType);
}

const IMG_REF_TYPES = ['img_struct', 'img_flow', 'img_topo'];
function isImgRefType(refType: string | undefined): boolean {
    return !!refType && IMG_REF_TYPES.includes(refType);
}

function isDataUrl(url: string | undefined): boolean {
    return !!url && /^data:/i.test(url);
}

function resolveFileUrl(url: string | undefined): string {
    if (!url) return "";
    if (isDataUrl(url) || url.startsWith("http")) return url;
    return `${window.location.origin}/${url.replace(/^\//, "")}`;
}

function isImportedImageNode(node: TreeNode): boolean {
    const title = (node.title || "").trim();
    const onlyImage = !!node.img_url && !node.text && (!node.table || !node.table.headers?.length) && (!node.children || node.children.length === 0);
    return /^导入图片\d*$/.test(title) && onlyImage;
}

function isImportedTableNode(node: TreeNode): boolean {
    const title = (node.title || "").trim();
    const hasTable = !!(node.table && Array.isArray(node.table.headers) && node.table.headers.length > 0 && Array.isArray(node.table.rows));
    const noExtra = !node.img_url && !node.text && (!node.children || node.children.length === 0);
    return /^导入表格\d*$/.test(title) && hasTable && noExtra;
}

function isReqMainTable(table?: TableData | null): boolean {
    if (!table?.headers?.length) return false;
    const hs = table.headers.map((h) => normalizeCellText(h?.name));
    return hs.some((h) => h.includes("需求编号")) && hs.some((h) => h.includes("功能"));
}

function isReqOtherTable(table?: TableData | null): boolean {
    if (!table?.headers?.length) return false;
    const hs = table.headers.map((h) => normalizeCellText(h?.name));
    return hs.some((h) => h.includes("需求编号")) && hs.some((h) => h.includes("章节"));
}

function normalizeRcmCode(code: string | undefined): string {
    return String(code || "")
        .trim()
        .toUpperCase()
        .replace(/[，。；;、,.]+$/g, "");
}

const KV_FIELD_LABELS = new Set([
    "需求编号",
    "需求名称",
    "需求概述",
    "主参加者",
    "前置条件",
    "触发器",
    "工作流",
    "后置条件",
    "异常情况",
    "约束",
]);

function normalizeCellText(value: string | undefined): string {
    return String(value || "")
        .replace(/[\s↩\r\n\t]+/g, "")
        .replace(/[：:，,。.;；、]/g, "")
        .toLowerCase();
}

function normalizeReqDisplayText(value: any): string {
    const txt = String(value ?? "").trim();
    if (!txt) return "";
    const invalid = new Set(["/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"]);
    return invalid.has(txt) ? "" : txt;
}

function isFunctionalKvTable(table?: TableData | null): boolean {
    if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return false;
    if (table.headers.length !== 2 || table.rows.length < 3) return false;
    const h1 = normalizeCellText(table.headers[0]?.name);
    const h2 = normalizeCellText(table.headers[1]?.name);
    const fieldHits = table.rows
        .map((row) => normalizeCellText(String(row?.[table.headers![0].code] || "")))
        .filter((txt) => KV_FIELD_LABELS.has(txt)).length;
    // 命中多个“需求详情字段”时，按 Word 里的“左列字段+右列内容”无表头表格渲染
    if (fieldHits >= 3) return true;
    // 兜底：第一行常被误解析成表头（如“需求编号 | SRS-XXX”）
    return KV_FIELD_LABELS.has(h1) && !!h2;
}

function isSrsCodeColumn(header?: { code: string; name: string }): boolean {
    const hName = normalizeCellText(header?.name);
    const hCode = normalizeCellText(header?.code);
    return hName.includes("需求编号") || hCode.includes("srscode") || hCode.includes("srs");
}

interface TreeNodeItemProps {
    node: TreeNode;
    level: number;
    docId?: number;
    readOnly?: boolean;
    rcmOptions: Array<{ value: number; label: string; description?: string }>;
    onRcmSelectChange: (nodeId: number, selectedRcmIds: number[]) => void;
    onAdd: (parentId: number) => void;
    onAddSibling: (nodeId: number, position: 'before' | 'after', defaultTitle: string) => void;
    onDelete: (id: number) => Promise<void>;
    onTitleChange: (id: number, title: string) => void;
    onSrsCodeChange: (id: number, value: string) => void;
    onImageChange: (id: number, imgUrl: string) => void;
    onContentChange: (id: number, content: string) => void;
    onAddTable: (id: number) => void;
    onImportTable: (id: number, file: File) => Promise<void>;
    onEditTable: (id: number) => void;
    onDeleteTable: (id: number) => void;
    onOpenSrsTable?: () => void;  // 打开 SRS 表弹框
    onOpenReqList?: () => void;   // 打开需求列表弹框
    onEditSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    srsReqPreview?: {
        main: any[];
        other: any[];
        changes: Array<{ id: number | string; title: string; data: any[] }>;
    };
    srsReqLoading?: boolean;
    hideLevelPrefix?: boolean;
    disableHierarchyActions?: boolean;
}

const TreeNodeItem = ({
    node,
    level,
    docId,
    readOnly,
    rcmOptions,
    onRcmSelectChange,
    onAdd,
    onAddSibling,
    onDelete,
    onTitleChange,
    onSrsCodeChange,
    onImageChange,
    onContentChange,
    onAddTable,
    onImportTable,
    onEditTable,
    onDeleteTable,
    onOpenSrsTable,
    onOpenReqList,
    onEditSrsChangeTable,
    srsReqPreview,
    srsReqLoading,
    hideLevelPrefix = false,
    disableHierarchyActions = false,
}: TreeNodeItemProps) => {
    const { t: ts } = useTranslation();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploadLoading, setUploadLoading] = useState(false);
    // 性能优化：默认仅展开前两级，减少编辑页首次渲染和输入卡顿
    const [expanded, setExpanded] = useState(level <= 1);

    useEffect(() => {
        if (node.img_url) {
            setFileList([{
                uid: '-1',
                name: 'image.png',
                status: 'done',
                url: `${window.location.origin}/${node.img_url.replace(/^\//, "")}`,
            }]);
        } else {
            setFileList([]);
        }
    }, [node.img_url]);

    const uploadProps: UploadProps = {
        maxCount: 1,
        fileList,
        disabled: uploadLoading,
        beforeUpload: async (file) => {
            try {
                setUploadLoading(true);
                const formData = new FormData();
                formData.append("file", file);
                formData.append("doc_id", String(docId ?? 0));

                const res = await Api.add_doc_file(formData);
                if (res.code === Api.C_OK || res.code === 1) {
                    const imgUrl = res.data;
                    onImageChange(node.id, imgUrl);
                    setFileList([{
                        uid: file.uid,
                        name: file.name,
                        status: "done",
                        url: `${window.location.origin}/${imgUrl}`,
                    }]);
                    message.success(ts("upload_success"));
                } else {
                    message.error(res.msg || ts("upload_failed"));
                }
            } catch (error) {
                console.error("图片上传失败:", error);
                message.error(ts("upload_failed"));
            } finally {
                setUploadLoading(false);
            }
            return false;
        },
        onRemove: () => {
            onImageChange(node.id, "");
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
    const embeddedImageNode = (node.children || []).find((child) => isImportedImageNode(child));
    const embeddedTableNodes = (node.children || []).filter((child) => isImportedTableNode(child));
    const embeddedMainReqTableNode =
        embeddedTableNodes.find((child) => isReqMainTable(child.table)) || embeddedTableNodes[0];
    const embeddedOtherReqTableNodes = embeddedTableNodes.filter(
        (child) => child.id !== embeddedMainReqTableNode?.id
    );
    const displayImageUrl = node.img_url || embeddedImageNode?.img_url || "";
    const displayTable = node.table && node.table.headers?.length ? node.table : embeddedMainReqTableNode?.table;
    // 表格可能展示在父节点，但真实数据在“导入表格X”子节点；编辑时应命中真实节点ID
    const tableOwnerNodeId =
        (node.table && node.table.headers?.length ? node.id : (embeddedMainReqTableNode?.id ?? node.id)) as number;
    const visibleChildren = (node.children || []).filter((child) => !isImportedImageNode(child) && !isImportedTableNode(child));
    const hasVisibleChildren = visibleChildren.length > 0;
    const showReqExtraTables =
        embeddedTableNodes.some((child) => isReqMainTable(child.table)) &&
        embeddedTableNodes.some((child) => isReqOtherTable(child.table));

    // 构建表格列配置：不横向滚动，内容自动换行
    const buildTableColumns = (targetTable?: TableData | null): ColumnsType<any> => {
        const table = targetTable || displayTable;
        if (!table || !table.headers || table.headers.length === 0) {
            return [];
        }
        const hideHeader = table.show_header === 0 || isFunctionalKvTable(table);
        const tableCells = table.cells || [];
        // 无表头两列表格优先按“数据行”渲染，避免合并单元格分支吞掉首行（需求编号/SRS）
        const hasMergedCells = !hideHeader && Array.isArray(tableCells) && tableCells.length > 1;
        return table.headers.map((header, index) => {
            const codeCol = isSrsCodeColumn(header);
            const col: any = {
                title: hideHeader ? "" : header.name,
                dataIndex: header.code,
                key: `col_${index}`,
                className: codeCol ? "srs-code-col" : "",
            };
            if (codeCol) {
                col.width = 190;
                col.ellipsis = true;
            }
            if (hasMergedCells) {
                col.render = (_val: any, _row: any, rowIndex: number) => {
                    const bodyCells = tableCells.slice(1);
                    const cell = bodyCells[rowIndex]?.[index];
                    const rowSpan = cell?.row_span ?? 1;
                    const colSpan = cell?.col_span ?? 1;
                    const hAlign = (cell?.h_align || "left") as "left" | "center" | "right";
                    const vAlign = (cell?.v_align || "top") as "top" | "middle" | "bottom";
                    return {
                        children: <div className={codeCol ? "table-cell-code" : "table-cell-content"}>{cell?.value || ""}</div>,
                        props: { rowSpan, colSpan, style: { textAlign: hAlign, verticalAlign: vAlign } },
                    };
                };
            } else {
                col.render = (val: any) => <div className={codeCol ? "table-cell-code" : "table-cell-content"}>{val || ""}</div>;
            }
            return col;
        });
    };

    // 构建表格数据源
    const buildTableDataSource = (targetTable?: TableData | null) => {
        const table = targetTable || displayTable;
        if (!table || !table.rows || table.rows.length === 0) {
            return [];
        }
        const hideHeader = table.show_header === 0 || isFunctionalKvTable(table);
        const headers = table.headers || [];
        const tableCells = table.cells || [];
        // 无表头两列表格优先按“数据行”渲染，避免合并单元格分支吞掉首行（需求编号/SRS）
        const hasMergedCells = !hideHeader && Array.isArray(tableCells) && tableCells.length > 1;
        const shouldPrependHeaderAsFirstRow =
            hideHeader &&
            headers.length === 2 &&
            normalizeCellText(headers[0]?.name).includes("需求编号") &&
            !!normalizeCellText(headers[1]?.name);
        if (hasMergedCells && table.headers) {
            const bodyCells = tableCells.slice(1);
            const rows = bodyCells.map((row, rowIndex) => {
                const rowObj: any = { key: rowIndex };
                table!.headers!.forEach((header, colIdx) => {
                    rowObj[header.code] = normalizeReqDisplayText(row?.[colIdx]?.value || "");
                });
                return rowObj;
            });
            if (shouldPrependHeaderAsFirstRow) {
                const firstHeaderRow: any = { key: `kv_header_row` };
                firstHeaderRow[headers[0].code] = headers[0].name || "";
                firstHeaderRow[headers[1].code] = headers[1].name || "";
                const firstBodyLeft = normalizeCellText(rows?.[0]?.[headers[0].code]);
                const firstBodyRight = normalizeCellText(rows?.[0]?.[headers[1].code]);
                const headerLeft = normalizeCellText(headers[0].name);
                const headerRight = normalizeCellText(headers[1].name);
                // 仅当首行与“需求编号|SRS编号”完全重复时才不重复插入
                if (!(firstBodyLeft === headerLeft && firstBodyRight === headerRight)) {
                    rows.unshift(firstHeaderRow);
                }
            }
            return rows;
        }

        const rows = table.rows.map((row, index) => ({
            key: index,
            ...Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, normalizeReqDisplayText(v)]))
        }));
        if (shouldPrependHeaderAsFirstRow) {
            const firstHeaderRow: any = { key: `kv_header_row` };
            firstHeaderRow[headers[0].code] = headers[0].name || "";
            firstHeaderRow[headers[1].code] = headers[1].name || "";
            const firstBodyLeft = normalizeCellText(rows?.[0]?.[headers[0].code]);
            const firstBodyRight = normalizeCellText(rows?.[0]?.[headers[1].code]);
            const headerLeft = normalizeCellText(headers[0].name);
            const headerRight = normalizeCellText(headers[1].name);
            // 仅当首行与“需求编号|SRS编号”完全重复时才不重复插入
            if (!(firstBodyLeft === headerLeft && firstBodyRight === headerRight)) {
                rows.unshift(firstHeaderRow);
            }
        }
        return rows;
    };

    const hasTable = !!(
        displayTable &&
        displayTable.headers &&
        Array.isArray(displayTable.headers) &&
        displayTable.headers.length > 0 &&
        displayTable.rows &&
        Array.isArray(displayTable.rows) &&
        displayTable.rows.length > 0
    );

    return (
        <div style={{ marginLeft: level * 32 }}>
          <div className={`tree-node-item level-${level}`}>
              <div className="node-row">
                  {hasVisibleChildren ? (
                      <Button
                          type="text"
                          size="small"
                          className="node-expand-btn"
                          icon={expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                          onClick={() => setExpanded((v) => !v)}
                      />
                  ) : (
                      <span className="node-expand-placeholder" />
                  )}
                  {!readOnly && !disableHierarchyActions && (
                    <Tooltip title={ts('srs_doc.add_sibling_before') || '在前面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'before', node.title)}
                      />
                    </Tooltip>
                  )}
                  {!readOnly && !hideLevelPrefix && (
                      <span className="node-title-prefix">{numberToChinese(level + 1)}{ts('level_menu')}</span>
                  )}
                  {readOnly ? (
                      <div className="node-title">{node.title || "-"}</div>
                  ) : (
                      <Input
                          className="node-title"
                          value={node.title}
                          onChange={(e) => onTitleChange(node.id, e.target.value)}
                          placeholder={ts('please_input_title')}
                          disabled={readOnly}
                      />
                  )}
                  {
                    ('srs_code' in node) && node.srs_code !== null && (
                        readOnly ? (
                            <div className="node-srs-code">{node.srs_code || "-"}</div>
                        ) : (
                            <Input
                                className="node-srs-code"
                                value={node.srs_code ?? ''}
                                onChange={(e) => onSrsCodeChange(node.id, e.target.value)}
                                placeholder={ts('please_input_srs_code')}
                                disabled={readOnly}
                            />
                        )
                    )
                  }
                  {/* 章节 RCM 选择：选择后自动拼接写入 text 文本框（与标题同一行） */}
                  {Array.isArray(node.rcm_codes) && (
                      <div className="node-rcm-select">
                          {readOnly ? (
                              <div>{(node.rcm_codes || []).join(", ") || "-"}</div>
                          ) : (
                              <Select
                                  mode="multiple"
                                  showSearch
                                  allowClear
                                  optionFilterProp="label"
                                  placeholder={ts("srs_doc.select_rcm_code") || "选择RCM"}
                                  options={rcmOptions}
                                  value={(() => {
                                      const codes = Array.isArray(node.rcm_codes) ? node.rcm_codes.filter(Boolean) : [];
                                      const normalizedCodes = codes.map((code) => normalizeRcmCode(code));
                                      return codes
                                          .map((code, idx) => {
                                              const codeNorm = normalizedCodes[idx];
                                              return rcmOptions.find((o) => normalizeRcmCode(o.label) === codeNorm)?.value;
                                          })
                                          .filter((v): v is number => typeof v === "number");
                                  })()}
                                  onChange={(vals) => onRcmSelectChange(node.id, (vals || []) as number[])}
                                  disabled={readOnly || !rcmOptions.length}
                                  // 容器变窄时避免 responsive 模式不渲染选中 tag
                                  maxTagCount={999}
                                  tagRender={(tagProps: any) => {
                                      const code = String(tagProps?.label ?? "");
                                      const opt = rcmOptions.find((o) => o.label === code);
                                      return (
                                          <Tooltip title={opt?.description || ""} placement="topLeft">
                                              <Tag color="blue">{code}</Tag>
                                          </Tooltip>
                                      );
                                  }}
                                  optionRender={(opt: any) => (
                                      <Tooltip title={opt?.data?.description || ""} placement="left">
                                          <span>{opt?.data?.label}</span>
                                      </Tooltip>
                                  )}
                                  size="small"
                                  style={{ width: "100%", minWidth: 0 }}
                              />
                          )}
                      </div>
                  )}
                  {readOnly ? (
                      <div className="node-content node-text-area">{node.text || ""}</div>
                  ) : (
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
                  )}
                  {isImgRefType(node.ref_type) && (
                      <div className="node-file-ref node-content">
                          {displayImageUrl ? (
                              <a
                                  href={resolveFileUrl(displayImageUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="node-file-link"
                              >
                                  <FileOutlined /> {getRefTypeLabel(node.ref_type, ts)}
                              </a>
                          ) : (
                              <Tooltip title={ts('srs_doc.no_file')}>
                                  <span className="node-file-empty">
                                      <FileOutlined /> {getRefTypeLabel(node.ref_type, ts)}
                                  </span>
                              </Tooltip>
                          )}
                      </div>
                  )}
                  {level <= 2 && displayImageUrl && (
                      <div className="node-pic node-pic-readonly">
                          <Image
                              src={resolveFileUrl(displayImageUrl)}
                              alt={node.title || "image"}
                              preview={true}
                          />
                      </div>
                  )}
                  {isImgRefType(node.ref_type) && !readOnly && (
                      <Upload {...uploadProps} className="node-pic">
                          <Button size="small" icon={<UploadOutlined />}>
                              {node.img_url ? "重新上传" : ts("select_file")}
                          </Button>
                      </Upload>
                  )}
                  {node.ref_type === 'srs_reqds' && onOpenReqList && (
                      <Button type="primary" size="small" className="node-srsreq-btn" onClick={onOpenReqList}>
                          {ts('srs_doc.req_detailed_list')}
                      </Button>
                  )}
                  {/* {node.ref_type === 'srs_reqds' && (
                      <Tag color="geekblue" style={{padding: '5px'}}>{ts('srs_doc.req_list')}</Tag>
                  )} */}
                  {!readOnly && !disableHierarchyActions && (
                    <Tooltip title={ts('srs_doc.add_sibling_after') || '在后面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'after', node.title)}
                      />
                    </Tooltip>
                  )}
                  {!readOnly && !disableHierarchyActions && (
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
                      {!(node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2')) && (
                      <Button
                          size="small"
                          icon={<TableOutlined />}
                          onClick={() => onAddTable(node.id)}>
                          {ts('srs_doc.table')}
                      </Button>
                      )}
                      {!(node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2')) && (
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
              {hasTable && !(node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2')) && (
                  <div className="node-table">
                      <div className="node-table-header">
                          <Table
                              columns={buildTableColumns()}
                              dataSource={buildTableDataSource()}
                              pagination={false}
                              size="small"
                              bordered
                              tableLayout="fixed"
                              showHeader={!(displayTable?.show_header === 0 || isFunctionalKvTable(displayTable))}
                          />
                          {!readOnly && (
                          <Space className="node-table-actions" size={8}>
                              <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => onEditTable(tableOwnerNodeId)}>
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
              {showReqExtraTables && embeddedOtherReqTableNodes.map((subNode, idx) => (
                  <div className="node-table" key={`embedded_sub_table_${subNode.id || idx}`}>
                      <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span>{isReqOtherTable(subNode.table) ? (ts("srs_doc.other_req_list") || "其他需求列表") : (subNode.title || `表格${idx + 1}`)}</span>
                          {!readOnly && (
                              <Button size="small" icon={<EditOutlined />} onClick={() => onEditTable(Number(subNode.id || subNode.n_id || node.id))}>
                                  {ts("edit")}
                              </Button>
                          )}
                      </div>
                      <div className="node-table-header">
                          <Table
                              columns={buildTableColumns(subNode.table)}
                              dataSource={buildTableDataSource(subNode.table)}
                              pagination={false}
                              size="small"
                              bordered
                              tableLayout="fixed"
                              showHeader={!(subNode.table?.show_header === 0 || isFunctionalKvTable(subNode.table))}
                          />
                      </div>
                  </div>
              ))}
              {showReqExtraTables && (srsReqPreview?.changes || []).map((table) => (
                  <div className="node-table" key={`srs_change_${table.id}`}>
                      <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span>{table.title || "变更表格"}</span>
                          {!readOnly && (
                              <Button
                                  size="small"
                                  type="default"
                                  icon={<EditOutlined />}
                                  onClick={() => onEditSrsChangeTable?.(table as any)}
                              >
                                  {ts("edit")}
                              </Button>
                          )}
                      </div>
                      <div className="node-table-header">
                          <Table
                              columns={[
                                  { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", key: "srs_code" },
                                  { title: ts("srs_doc.module") || "模块", dataIndex: "module", key: "module" },
                                  { title: ts("srs_doc.function") || "功能", dataIndex: "function", key: "function", render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                  { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", key: "sub_function", render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                              ]}
                              dataSource={table.data || []}
                              pagination={false}
                              size="small"
                              bordered
                              tableLayout="fixed"
                              rowKey="key"
                          />
                      </div>
                  </div>
              ))}
              {node.ref_type === "srs_reqs" && srsReqPreview && (
                  <div className="node-table">
                      <div style={{ marginBottom: 8, fontWeight: 600 }}>{ts("srs_doc.srs_table") || "产品需求列表"}</div>
                      <Table
                          size="small"
                          bordered
                          pagination={false}
                          rowKey="key"
                          loading={!!srsReqLoading}
                          locale={{ emptyText: "暂无数据" }}
                          dataSource={srsReqPreview.main || []}
                          columns={[
                              { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 180 },
                              { title: ts("srs_doc.module") || "模块", dataIndex: "module", width: 180 },
                              { title: ts("srs_doc.function") || "功能", dataIndex: "function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                              { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                          ]}
                          scroll={{ x: 1060 }}
                      />

                      <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>{ts("srs_doc.other_req_list") || "其他需求列表"}</div>
                      <Table
                          size="small"
                          bordered
                          pagination={false}
                          rowKey="key"
                          loading={!!srsReqLoading}
                          locale={{ emptyText: "暂无数据" }}
                          dataSource={srsReqPreview.other || []}
                          columns={[
                              { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 180 },
                              { title: ts("srs_doc.module") || "需求模块", dataIndex: "module", width: 320 },
                              { title: ts("srs_doc.chapter_number") || "对应的章节号", dataIndex: "location", width: 320 },
                          ]}
                          scroll={{ x: 820 }}
                      />

                      {(srsReqPreview.changes || []).map((table) => (
                          <div key={`srs_preview_change_${table.id}`} style={{ marginTop: 16 }}>
                              <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  <span>{table.title || "变更表格"}</span>
                                  {!readOnly && (
                                      <Button
                                          size="small"
                                          type="default"
                                          icon={<EditOutlined />}
                                          onClick={() => onEditSrsChangeTable?.(table as any)}
                                      >
                                          {ts("edit")}
                                      </Button>
                                  )}
                              </div>
                              <Table
                                  size="small"
                                  bordered
                                  pagination={false}
                                  rowKey="key"
                                  loading={!!srsReqLoading}
                                  locale={{ emptyText: "暂无数据" }}
                                  dataSource={table.data || []}
                                  columns={[
                                      { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 180 },
                                      { title: ts("srs_doc.module") || "模块", dataIndex: "module", width: 180 },
                                      { title: ts("srs_doc.function") || "功能", dataIndex: "function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                      { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                  ]}
                                  scroll={{ x: 1060 }}
                              />
                          </div>
                      ))}
                  </div>
              )}
          </div>
            {expanded && visibleChildren.map((child) => (
                <TreeNodeItem
                    key={child.id}
                    node={child}
                    level={level + 1}
                    docId={docId}
                    readOnly={readOnly}
                    rcmOptions={rcmOptions}
                    onRcmSelectChange={onRcmSelectChange}
                    onAdd={onAdd}
                    onAddSibling={onAddSibling}
                    onDelete={onDelete}
                    onTitleChange={onTitleChange}
                    onSrsCodeChange={onSrsCodeChange}
                    onImageChange={onImageChange}
                    onContentChange={onContentChange}
                    onAddTable={onAddTable}
                    onImportTable={onImportTable}
                    onEditTable={onEditTable}
                    onDeleteTable={onDeleteTable}
                    onOpenSrsTable={onOpenSrsTable}
                    onOpenReqList={onOpenReqList}
                    onEditSrsChangeTable={onEditSrsChangeTable}
                    srsReqPreview={srsReqPreview}
                    srsReqLoading={srsReqLoading}
                />
            ))}
        </div>
    );
};

interface TreeStructureProps {
    value?: TreeNode[];
    onChange?: (value: TreeNode[]) => void;
    docId?: number;
    hiddenNodeIds?: number[];
    readOnly?: boolean;
    rcmOptions: Array<{ value: number; label: string; description?: string }>;
    onNodeDelete?: (docId: number, nodeId: number) => Promise<boolean>; // 删除节点回调
    onOpenSrsTable?: () => void;  // 打开 SRS 表弹框
    onOpenReqList?: () => void;  // 打开需求列表弹框
    onEditSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    srsReqPreview?: {
        main: any[];
        other: any[];
        changes: Array<{ id: number | string; title: string; data: any[] }>;
    };
    srsReqLoading?: boolean;
    onNodesSnapshot?: (nodes: TreeNode[]) => void;
}

export default ({ value = [], onChange, docId, hiddenNodeIds = [], readOnly, rcmOptions, onNodeDelete, onOpenSrsTable, onOpenReqList, onEditSrsChangeTable, srsReqPreview, srsReqLoading, onNodesSnapshot }: TreeStructureProps) => {
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
    // 把组件内部“最新树状态”实时回传给父组件，避免保存时拿到滞后值
    useEffect(() => {
        onNodesSnapshot?.(nodes);
    }, [nodes, onNodesSnapshot]);

    const updateNodes = (newNodes: TreeNode[]) => {
        // 同步回传最新树，避免“刚编辑后立刻保存”拿到旧值
        onNodesSnapshot?.(newNodes);
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
                    srs_code: '',
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

    const handleSrsCodeChange = (id: number, srs_code: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            srs_code
        }));
        updateNodes(newNodes);
    };

    const handleContentChange = (id: number, text: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            text
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

    // 选择章节 RCM 后，自动拼接“RCM编号 + 详细描述”写入当前节点 text
    const handleRcmSelectChange = (nodeId: number, selectedRcmIds: number[]) => {
        const selectedOptions = (selectedRcmIds || [])
            .map((id) => rcmOptions.find((o) => o.value === id))
            .filter((o): o is { value: number; label: string; description?: string } => !!o);

        const nextRcmCodes = selectedOptions.map((o) => o.label);
        const nextText = selectedOptions
            // 只写详细描述
            .map((o) => o.description ?? "")
            .join("\n");

        const newNodes = findNodeAndUpdate(nodes, nodeId, (node) => ({
            ...node,
            rcm_codes: nextRcmCodes,
            text: nextText,
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
                        ...(("srs_code" in target) ? { srs_code: target.srs_code ?? "" } : {}),
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

    const hiddenSet = new Set(hiddenNodeIds.map((id) => String(id)));
    const getVisibleNodes = (list: TreeNode[]): TreeNode[] => {
        return list
            .filter((node) => !hiddenSet.has(String(node.id)) && !hiddenSet.has(String(node.n_id || "")))
            .map((node) => ({
                ...node,
                children: getVisibleNodes(node.children || []),
            }));
    };
    const visibleNodes = getVisibleNodes(nodes);

    return (
        <>
            <div className="tree-structure-container">
                {visibleNodes.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={ts("srs_doc.empty_directory_structure")}
                        className="tree-structure-empty"
                    />
                ) : visibleNodes.map((node) => (
                  <div key={`content-node-${node.id}`}>
                      <div className="tree-node-item-wrapper" key={node.id}>
                        <TreeNodeItem
                            node={node}
                            level={0}
                            docId={docId}
                            readOnly={readOnly}
                            rcmOptions={rcmOptions}
                            onRcmSelectChange={handleRcmSelectChange}
                            onAdd={handleAdd}
                            onAddSibling={handleAddSibling}
                            onDelete={handleDelete}
                            onTitleChange={handleTitleChange}
                            onSrsCodeChange={handleSrsCodeChange}
                            onImageChange={handleImageChange}
                            onContentChange={handleContentChange}
                            onAddTable={handleAddTable}
                            onImportTable={handleImportTable}
                            onEditTable={handleEditTable}
                            onDeleteTable={handleDeleteTable}
                            onOpenSrsTable={onOpenSrsTable}
                            onOpenReqList={onOpenReqList}
                            onEditSrsChangeTable={onEditSrsChangeTable}
                            srsReqPreview={srsReqPreview}
                            srsReqLoading={srsReqLoading}
                        />
                      </div>
                  </div>
                ))}
            </div>

            {/* 添加/编辑表格弹框 */}
            <EditableTableGenerator
                open={tableModalVisible}
                initialData={initialTableData}
                rcmOptions={rcmOptions}
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
