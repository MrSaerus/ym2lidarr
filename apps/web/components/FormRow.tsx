import React, { ReactNode } from 'react';

type Props = {
    label: ReactNode;
    help?: ReactNode;
    children: ReactNode;
};

export default function FormRow({ label, help, children }: Props) {
    return (
        <div className="form-row">
            <div className="form-row-label">{label}</div>
            <div className="form-row-control">
                <div className="control">{children}</div>
                {help ? <div className="form-row-help">{help}</div> : null}
            </div>
        </div>
    );
}
