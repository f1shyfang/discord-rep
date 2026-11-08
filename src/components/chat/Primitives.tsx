import { useEffect, useRef, type ReactNode } from "react";

export function ErrorNotice({ error }: { error?: { message: string } | null }) {
  return error ? (
    <p className="error-notice" role="alert">
      {error.message}
    </p>
  ) : null;
}
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  let hue = 0;
  for (const c of name) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden="true"
      className={`avatar ${small ? "small" : ""}`}
      style={{ backgroundColor: `hsl(${hue} 35% 38%)` }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="chat-dialog"
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        #
      </span>
      <h1>{title}</h1>
      {children}
    </div>
  );
}
