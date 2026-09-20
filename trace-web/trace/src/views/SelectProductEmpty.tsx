import { Empty } from "antd";
import "./SelectProductEmpty.less";

export default () => (
    <div className="select-product-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择产品" />
    </div>
);
