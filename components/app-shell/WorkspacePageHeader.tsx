import type { ReactNode } from "react";

export function WorkspacePageHeader({ title, description, actions }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-section-header">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="workspace-section-actions">{actions}</div> : null}
    </header>
  );
}
