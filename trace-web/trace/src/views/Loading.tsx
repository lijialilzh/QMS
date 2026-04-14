import "./Loading.less";
import { Spin } from "antd";
import { useTranslation } from "react-i18next";

export default () => {
    const { t: ts } = useTranslation();
    return (
        <div className="page div-h center">
            <Spin></Spin>
            <div className="loading">{ts("loading")}</div>
        </div>
    );
};
