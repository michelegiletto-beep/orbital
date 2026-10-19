import { useEffect, useRef, type ReactNode } from "react";
export function Modal({
  children,
  label,
  onClose,
  className,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className={className ?? "side-dialog"}
      ref={dialog}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      {children}
    </dialog>
  );
}
