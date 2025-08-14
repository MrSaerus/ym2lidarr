import React from 'react';

type Props = {
    label: React.ReactNode;
    help?: React.ReactNode;
    children: React.ReactNode;
};

export default function FormRow({ label, help, children }: Props) {
    return (
        <div className="form-row">
            <div className="label">
                <div className="label-text">{label}</div>
            </div>
            <div className="control">
                {children}
                {help ? <div className="help mt-1">{help}</div> : null}
            </div>
        </div>
    );
}
