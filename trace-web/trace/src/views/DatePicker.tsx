import { DatePicker } from "antd";
import { useState } from "react";

export default ({ disabled, onClick, onChange, ...props }: any) => {
    const [open, updateOpen] = useState(false);

    return (
        <DatePicker
            {...props}
            open={open}
            disabled={disabled}
            onChange={(...attrs) => {
                onChange(...attrs);
                updateOpen(!open);
            }}
            onOpenChange={(open) => {
                // fix flash issue
                if (!disabled) {
                    updateOpen(open);
                }
            }}
            onClick={(evt) => {
                // fix flash issue
                if (!disabled) {
                    updateOpen(!open);
                    onClick && onClick(evt);
                }
            }}
        />
    );
};
