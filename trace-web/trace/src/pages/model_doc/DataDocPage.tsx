import { useParams } from "react-router-dom";
import DataDocDetail from "./DataDocDetail";
import DataEnvDocDetail from "./DataEnvDocDetail";

const ENV_DOC_TYPES = new Set(["dd_016", "dd_017"]);

export default () => {
    const { type } = useParams();
    if (ENV_DOC_TYPES.has(type || "")) return <DataEnvDocDetail />;
    return <DataDocDetail />;
};
