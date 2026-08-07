/**
 * 纯前端交错渲染：把 body + tables + images 按"见下表/见下图"关键词切分，
 * 正文→表格/图→正文→表格/图交错展示。
 * 参考自研软件研究报告的实现：blocks 不持久化，渲染时动态切分，编辑写回 body。
 * 完全不影响后端 autofill/replace_name/rebind_product 等功能。
 */

// 把 body + tables + images 切分为交错序列（纯渲染用，不修改原数据）
// 返回 [{type:"text", text:"..."}, {type:"table", tableIndex:0}, {type:"image", imageIndex:0}, ...]
export const splitBodyTables = (body: string, tables: any[], images?: any[]): any[] => {
    const text = String(body || "");
    const tablesArr = Array.isArray(tables) ? tables : [];
    const imagesArr = Array.isArray(images) ? images : [];
    if (!text.trim() && tablesArr.length === 0 && imagesArr.length === 0) return [];
    const lines = text.split("\n");
    const segments: any[] = [];
    let tableIdx = 0;
    let imgIdx = 0;
    let buf: string[] = [];

    const flushText = () => {
        const t = buf.join("\n").trim();
        if (t) segments.push({ type: "text", text: t });
        buf = [];
    };

    for (const ln of lines) {
        const s = ln.trim();
        // 遇到"见下表/如下表/下表"行，先加入正文再 flush，然后插入表格
        if (/见下表|如下表|下表/.test(s) && tableIdx < tablesArr.length) {
            buf.push(ln);  // 保留"见下表"行作为正文
            flushText();
            segments.push({ type: "table", tableIndex: tableIdx });
            tableIdx++;
            continue;
        }
        // 遇到"见表N"行，把"见表N"替换为"见下表"保留在正文，然后插入表格
        if (/见表\s*\d/.test(s) && tableIdx < tablesArr.length) {
            buf.push(ln.replace(/见表\s*\d+/, "见下表"));
            flushText();
            segments.push({ type: "table", tableIndex: tableIdx });
            tableIdx++;
            continue;
        }
        // 遇到"表N xxx"行，提取为 caption，不加入正文
        if (/^表\s*\d/.test(s) && tableIdx < tablesArr.length) {
            flushText();
            segments.push({ type: "table", tableIndex: tableIdx, caption: s });
            tableIdx++;
            continue;
        }
        // 遇到"见下图/如下图/下图"行，先加入正文再 flush，然后插入图片
        if (/见下图|如下图|下图/.test(s) && imgIdx < imagesArr.length) {
            buf.push(ln);  // 保留"见下图"行作为正文
            flushText();
            segments.push({ type: "image", imageIndex: imgIdx });
            imgIdx++;
            continue;
        }
        // 遇到"图N xxx"行，提取为 caption，不加入正文
        if (/^图\s*\d/.test(s) && imgIdx < imagesArr.length) {
            flushText();
            segments.push({ type: "image", imageIndex: imgIdx, caption: s });
            imgIdx++;
            continue;
        }
        buf.push(ln);
    }
    flushText();
    // 剩余未匹配的表格追加到末尾
    for (; tableIdx < tablesArr.length; tableIdx++) {
        segments.push({ type: "table", tableIndex: tableIdx });
    }
    // 剩余未匹配的图片追加到末尾
    for (; imgIdx < imagesArr.length; imgIdx++) {
        segments.push({ type: "image", imageIndex: imgIdx });
    }
    return segments;
};

// 编辑某段正文后，重组回 body（表格位置用"见下表"占位，图片位置用"见下图"占位）
export const reassembleBody = (segments: any[], editedIndex: number, newText: string): string => {
    const parts: string[] = [];
    segments.forEach((seg, i) => {
        if (seg.type === "text") {
            parts.push(i === editedIndex ? newText : seg.text);
        } else if (seg.type === "table") {
            const last = parts[parts.length - 1];
            if (!last || !/见下表|如下表|下表/.test(last)) {
                parts.push("见下表");
            }
        } else if (seg.type === "image") {
            const last = parts[parts.length - 1];
            if (!last || !/见下图|如下图|下图/.test(last)) {
                parts.push("见下图");
            }
        }
    });
    return parts.join("\n");
};